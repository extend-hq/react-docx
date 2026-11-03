import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import time

from corpus import norm
from literal_features import literal_anchors
from run import ENGINES
from semantic_audit import ordered_pairs, source_body
from word_structured import flat_package, read_gzip, save, sha


HERE = Path(__file__).resolve().parent


def positive_formatting(source, actual):
    target = []
    unaligned = 0
    for paragraph in actual.get('paragraphs', []):
        if paragraph['story'] != 'body':
            continue
        text = norm(paragraph['text'])
        if not text:
            continue
        runs = paragraph.get('runs', [])
        if ''.join(run['text'] for run in runs) != text:
            unaligned += 1
            runs = [{'text': text}]
        target.append({'text': text, 'flags': {
            key: [bool(run.get(key)) for run in runs for _ in run['text']]
            for key in ['bold', 'italic']}})
    counts = collections.Counter()
    for paragraph, match in ordered_pairs(source['paragraphs'], target):
        for key in ['bold', 'italic']:
            required = paragraph['required'][key]
            counts[key + '_expected'] += sum(required)
            if match is not None:
                other, positions = match
                counts[key + '_matched'] += sum(
                    other['flags'][key][positions[index]]
                    for index, flag in enumerate(required) if flag)
    return {key: {'matched': counts[key + '_matched'], 'expected': counts[key + '_expected'],
                  'unaligned_output_paragraphs': unaligned}
            for key in ['bold', 'italic']}


def story_presence(reference, actual, story):
    def paragraphs(document):
        return [norm(p['text']) for p in document.get('paragraphs', [])
                if p['story'] == story and norm(p['text'])]
    expected, found = paragraphs(reference), paragraphs(actual)
    left, right = collections.Counter(expected), collections.Counter(found)
    return {'matched': sum((left & right).values()), 'expected': len(expected), 'found': len(found),
            'same_content_different_order': int(left == right and expected != found)}


def diagnostic_metrics(source, reference, actual):
    result = {'explicit_' + key + '_characters': value
              for key, value in positive_formatting(source, actual).items()}
    for story in ['header', 'footer']:
        result[story + '_paragraph_presence'] = story_presence(reference, actual, story)
    result['textbox_literal_content'] = literal_anchors(
        reference.get('features', {}).get('textbox_text', []),
        actual.get('features', {}).get('textbox_text', []))
    return result


def aggregate(rows):
    result = {}
    for engine in ENGINES:
        group = [r['metrics'] for r in rows if r['engine'] == engine]
        names = sorted(set().union(*(g.keys() for g in group)))
        result[engine] = {}
        for name in names:
            values = [g[name] for g in group]
            counts = {key: sum(v.get(key, 0) for v in values)
                      for key in ['matched', 'expected', 'found', 'unaligned_output_paragraphs',
                                  'same_content_different_order', 'inserted_characters']
                      if any(key in v for v in values)}
            result[engine][name] = {**counts, 'scored': len(values),
                                   'recall': counts['matched'] / counts['expected'] if counts['expected'] else None}
    return result


def verify(path, digest):
    if not digest or sha(path) != digest:
        raise ValueError('Diagnostic input hash mismatch: ' + str(path))


def run(out, site=None):
    baseline_hashes = {name: sha(out / name) for name in ['manifest.json', 'scores.json', 'benchmark.json']}
    benchmark = json.loads((out / 'benchmark.json').read_text())
    if benchmark['stage'] != 'complete':
        raise ValueError('Diagnostics require a completed benchmark')
    entries = json.loads((out / 'manifest.json').read_text())['entries']
    scores = json.loads((out / 'scores.json').read_text())
    lookup = {(row['id'], row['engine']): row for row in scores}
    required = {(entry['id'], engine) for entry in entries for engine in ENGINES}
    if set(lookup) != required or len(lookup) != len(scores):
        raise ValueError('Incomplete or duplicate benchmark jobs')
    rows = []
    artifacts = {}
    for entry in entries:
        key = entry['id']
        verify(Path(entry['path']), key)
        receipt = json.loads((out / 'references' / (key + '.receipt.json')).read_text())
        if receipt.get('status') != 'ok':
            raise ValueError('Incomplete reference receipt')
        reference_path = out / 'references' / (key + '.json.gz')
        flat_path = out / 'references' / (key + '.flat-opc.xml.gz')
        verify(reference_path, receipt['reference_sha256'])
        with gzip.open(flat_path, 'rb') as stream:
            payload = stream.read()
        if hashlib.sha256(payload).hexdigest() != receipt['flat_opc_sha256']:
            raise ValueError('Diagnostic export hash mismatch')
        reference = read_gzip(reference_path)
        if reference['source_sha256'] != key or reference['flat_opc_sha256'] != receipt['flat_opc_sha256']:
            raise ValueError('Reference source or export identity mismatch')
        source = source_body(flat_package(payload))
        artifacts[key] = {'reference_sha256': receipt['reference_sha256'],
                          'flat_opc_sha256': receipt['flat_opc_sha256'], 'normalized_sha256': {}}
        for engine in ENGINES:
            row = lookup[key, engine]
            if (row['reference_sha256'] != receipt['reference_sha256']
                    or row['manifest_sha256'] != baseline_hashes['manifest.json']
                    or row['binary_sha256'] != benchmark['receipt']['timing']['binary_sha256']):
                raise ValueError('Score belongs to a different reference, manifest, or executable')
            actual = {'paragraphs': [], 'features': {}}
            if row['status'] == 'ok':
                path = out / 'normalized' / engine / (key + '.json.gz')
                verify(path, row['normalized_sha256'])
                actual = read_gzip(path)
                artifacts[key]['normalized_sha256'][engine] = row['normalized_sha256']
            rows.append({'id': key, 'engine': engine,
                         'metrics': diagnostic_metrics(source, reference['exported'], actual)})
    dependencies = ['word_metric_diagnostics.py', 'semantic_audit.py', 'literal_features.py',
                    'word_structured.py', 'corpus.py', 'run.py']
    data = {'version': 'word-metric-diagnostics-v1', 'updated_at': time.time(),
            'benchmark_updated_at': benchmark['updated_at'], 'inputs': len(entries),
            'comparison': aggregate(rows),
            'scope': 'Offline diagnostics from the same saved Word exports and normalized parser outputs. '
                     'Original scores and timings are unchanged; no new Word capture or parser run.',
            'receipt': {'baseline_sha256': baseline_hashes,
                        'binary_sha256': benchmark['receipt']['timing']['binary_sha256'],
                        'source_sha256': {name: sha(HERE / name) for name in dependencies},
                        'source_reference_and_output_hashes_verified': True}}
    for name, digest in baseline_hashes.items():
        verify(out / name, digest)
    save(out / 'diagnostics' / 'verified-metrics.json', {'rows': rows, 'artifacts': artifacts, **data})
    save(out / 'diagnostics.json', data)
    if site:
        verify(site / 'benchmark.json', baseline_hashes['benchmark.json'])
        save(site / 'diagnostics.json', data)
        shutil.copy2(HERE / 'word_structured_report.html', site / 'report.html')
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--site', type=Path)
    args = parser.parse_args()
    result = run(args.out, args.site)
    print(json.dumps({'inputs': result['inputs'], 'comparison': result['comparison']}))
