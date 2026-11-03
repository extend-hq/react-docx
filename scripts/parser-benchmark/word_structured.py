import argparse
import base64
import collections
from contextlib import contextmanager
import fcntl
import gzip
import hashlib
import io
import json
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

from corpus import oracle, norm


VERSION = 'microsoft-word-structured-v1'
CAPTURE = Path(__file__).with_name('word_structured_capture.applescript')
PKG = '{http://schemas.microsoft.com/office/2006/xmlPackage}'


class CaptureBlocked(RuntimeError):
    pass


def check_capture_state(native):
    if native.get('status') != 'ok':
        raise CaptureBlocked('Word capture failed at ' + str(native.get('error_stage'))
                             + ': ' + str(native.get('error_code')))
    unavailable = native.get('unavailable', {})
    if 'close' in unavailable:
        raise CaptureBlocked('Word document cleanup failed')
    for value in unavailable.values():
        code = value[0] if isinstance(value, list) and value else value
        if code == -1712 or (isinstance(code, str) and code.startswith('-1712:')):
            raise CaptureBlocked('Word scripting timed out during capture')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False))
    temporary.replace(path)


def save_gzip(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    with gzip.open(temporary, 'wt', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, allow_nan=False)
    temporary.replace(path)


def read_gzip(path):
    with gzip.open(path, 'rt', encoding='utf-8') as stream:
        return json.load(stream)


def word_text(value):
    value = value.replace('\x1e', '\u2011').replace('\x1f', '\u00ad')
    return ''.join(c for c in value if ord(c) >= 32 or c in '\t\n\r\v\f')


def flat_package(payload):
    root = ET.fromstring(payload)
    if root.tag != PKG + 'package':
        raise ValueError('Not a Word Flat OPC package')
    stream = io.BytesIO()
    types = ET.Element('{http://schemas.openxmlformats.org/package/2006/content-types}Types')
    seen = set()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as target:
        for part in root.findall(PKG + 'part'):
            name = part.attrib[PKG + 'name'].lstrip('/')
            if not name or '..' in Path(name).parts or name in seen:
                raise ValueError('Invalid or duplicate package part')
            seen.add(name)
            xml = part.find(PKG + 'xmlData')
            binary = part.find(PKG + 'binaryData')
            if xml is not None and len(xml) == 1:
                data = ET.tostring(xml[0], encoding='utf-8', xml_declaration=True)
            elif binary is not None:
                data = base64.b64decode(''.join((binary.text or '').split()), validate=True)
            else:
                raise ValueError('Missing package part content')
            target.writestr(name, data)
            ET.SubElement(types, '{http://schemas.openxmlformats.org/package/2006/content-types}Override',
                          PartName='/' + name, ContentType=part.attrib[PKG + 'contentType'])
        if '[Content_Types].xml' not in seen:
            target.writestr('[Content_Types].xml', ET.tostring(types, encoding='utf-8'))
    stream.seek(0)
    return stream


def validate_native(native):
    if native.get('status') != 'ok':
        raise ValueError('Word capture failed at ' + str(native.get('error_stage')) + ': ' + str(native.get('error_code')))
    if 'close' in native.get('unavailable', {}):
        raise ValueError('Word document cleanup failed')
    for key in ['tables', 'hyperlinks']:
        if not isinstance(native.get(key), list):
            native.setdefault('unavailable', {}).setdefault(key, 'missing_collection')
    if 'paragraph_texts' in native:
        texts = native['paragraph_texts']
        if (len(texts) != native['reported_paragraph_count']
                or any(not isinstance(value, str) for value in texts)):
            raise ValueError('Incomplete Word paragraph capture')
        native['body_range_text'] = native['body_text']
        native['body_text'] = ''.join(texts)
        native['body_range_agrees_with_paragraphs'] = norm(word_text(native['body_range_text'])) == norm(word_text(native['body_text']))
        native['body_extraction'] = 'Word paragraph collection after whole-range count mismatch'
    elif 'reported_paragraph_count' in native:
        if native['body_text'].count('\r') != native['reported_paragraph_count']:
            raise ValueError('Word body paragraph count mismatch')
        native['body_extraction'] = 'Word main-story range with paragraph-count check'
    if isinstance(native.get('body_text'), str) and 'paragraphs' not in native:
        native['paragraphs'] = [{'text': text} for text in native['body_text'].split('\r')]
        body = norm(word_text(native['body_text']))
        spans = native.get('formatted_spans', {})
        resolved = {}
        for key in ['bold', 'italic']:
            if key not in spans:
                native.setdefault('unavailable', {}).setdefault('resolved_formatting', 'missing_spans')
            values = []
            previous = 0
            for text, prefix, start, end in spans.get(key, []):
                if prefix is None and start == 0:
                    prefix = ''
                if not isinstance(text, str) or not isinstance(prefix, str):
                    native.setdefault('unavailable', {}).setdefault('resolved_formatting', 'missing_span_text')
                    continue
                text, prefix = norm(word_text(text)), norm(word_text(prefix))
                offset = len(prefix)
                if not body.startswith(prefix) or body[offset:offset + len(text)] != text or offset < previous:
                    native.setdefault('unavailable', {})['resolved_formatting'] = 'text_alignment'
                previous = offset + len(text)
                values.append({'text': text, 'offset': offset, 'start': start, 'end': end})
            resolved[key] = values
        native['formatted_spans'] = resolved
    paragraphs = native.get('paragraphs')
    if not isinstance(paragraphs, list) or not isinstance(native.get('body_text'), str):
        raise ValueError('Missing Word text output')
    if norm(word_text(native['body_text'])) != norm(''.join(word_text(p['text']) for p in paragraphs)):
        raise ValueError('Word body and paragraph text disagree')
    previous = -1
    for p in paragraphs:
        if 'start' in p:
            if p['start'] < previous or p['end'] < p['start']:
                raise ValueError('Invalid Word paragraph positions')
            previous = p['start']
        if 'formatted_spans' in native:
            continue
        if 'runs' not in p:
            native.setdefault('unavailable', {})['resolved_formatting'] = 'missing_runs'
            continue
        if norm(word_text(p['text'])) != norm(''.join(word_text(r[0]) for r in p['runs'])):
            native.setdefault('unavailable', {})['resolved_formatting'] = 'text_alignment'
        for run in p['runs']:
            if len(run) != 5 or type(run[3]) is not bool or type(run[4]) is not bool:
                raise ValueError('Unresolved Word formatting was emitted as a value')
    return native


def validate_collections(native, exported):
    for key in ['tables', 'hyperlinks']:
        expected = [v for v in exported['features'].get(key, []) if v.get('story') == 'body' and v.get('text')]
        if expected and not native.get(key):
            native.setdefault('unavailable', {})[key] = 'empty_collection_conflicts_with_word_export'
    if any(not isinstance(v[0], str) for v in native.get('hyperlinks', [])):
        native.setdefault('unavailable', {})['hyperlinks'] = 'missing_link_text'
    return native


def exporter_identity():
    return {CAPTURE.name: sha(CAPTURE), Path(__file__).name: sha(__file__)}


@contextmanager
def staging(out):
    directory = (out / 'staging').resolve()
    directory.mkdir(exist_ok=True)
    with (directory / '.capture.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield directory


def prepare(out, manifest, binary, formatting_budget=3):
    out.mkdir(parents=True, exist_ok=True)
    source = json.loads(manifest.read_text())
    entries = source['entries']
    if any(e['format'] != 'docx' for e in entries):
        raise ValueError('This capture profile accepts OOXML documents only')
    if len({e['id'] for e in entries}) != len(entries):
        raise ValueError('Duplicate source identity')
    for entry in entries:
        if sha(entry['path']) != entry['id']:
            raise ValueError('Source identity mismatch')
    save(out / 'manifest.json', {'entries': entries, 'source_manifest_sha256': sha(manifest),
                                'selection': source.get('selection'), 'reference_version': VERSION})
    (out / 'bin').mkdir(exist_ok=True)
    shutil.copy2(binary, out / 'bin/parser-benchmark')
    info = plistlib.loads(Path('/Applications/Microsoft Word.app/Contents/Info.plist').read_bytes())
    save(out / 'capture-environment.json', {
        'reference_version': VERSION, 'provider': 'microsoft-word-desktop-macos',
        'word_version': info['CFBundleShortVersionString'], 'word_build': info['CFBundleVersion'],
        'platform': platform.platform(), 'timezone': time.tzname, 'exporter_sha256': exporter_identity(),
        'manifest_sha256': sha(out / 'manifest.json'), 'binary_sha256': sha(binary),
        'policy': {'source': 'hash-verified disposable local copies, opened read-only',
                   'revisions': 'accepted on disposable copy before capture',
                   'macros': 'force disabled', 'external_link_updates': False,
                   'fields': 'no explicit update; Word default range text retrieval',
                   'body': 'whole-range paragraph count verified; paragraph collection fallback on mismatch',
                   'font_environment': 'installed desktop fonts; no visual-layout claim',
                   'resolved_formatting_budget_seconds': formatting_budget,
                   'export': 'Word object model JSON and Word-saved Flat OPC'},
    })


def status(out, site, **updates):
    path = out / 'status.json'
    value = json.loads(path.read_text()) if path.exists() else {}
    value.update(updates, updated_at=time.time())
    save(path, value)
    if site:
        save(site / 'status.json', value)
    return value


def capture(out, site, limit=None, timeout=180):
    env = json.loads((out / 'capture-environment.json').read_text())
    if env['exporter_sha256'] != exporter_identity():
        raise ValueError('Exporter changed after preparation; prepare a new reference run')
    entries = json.loads((out / 'manifest.json').read_text())['entries']
    if limit:
        entries = entries[:limit]
    references = out / 'references'
    references.mkdir(exist_ok=True)
    receipts = {}
    started = time.time()
    for index, entry in enumerate(entries):
        key = entry['id']
        receipt_path = references / (key + '.receipt.json')
        existing = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
        reference_path = references / (key + '.json.gz')
        if (existing.get('status') == 'ok' and existing.get('exporter_sha256') == env['exporter_sha256']
                and reference_path.exists() and existing.get('reference_sha256') == sha(reference_path)):
            receipts[key] = existing
        else:
            receipt = {'id': key, 'started_at': time.time(), 'exporter_sha256': env['exporter_sha256']}
            save(receipt_path, {**receipt, 'status': 'capturing'})
            try:
                if sha(entry['path']) != key:
                    raise ValueError('Source identity mismatch')
                if shutil.disk_usage(out).free < 2 * 2**30:
                    raise RuntimeError('Insufficient free space for reference capture')
                with staging(out) as directory:
                    source = directory / ('input.' + entry.get('extension', 'docx').lstrip('.'))
                    shutil.copy2(entry['path'], source)
                    exported = directory / 'word.xml'
                    exported.unlink(missing_ok=True)
                    result = subprocess.run(['osascript', str(CAPTURE), str(source), str(exported),
                                             str(env['policy']['resolved_formatting_budget_seconds'])],
                                            text=True, capture_output=True, timeout=timeout)
                    if result.returncode:
                        raise CaptureBlocked('Word scripting error: ' + result.stderr.strip()[-300:])
                    try:
                        native = json.loads(result.stdout)
                    except json.JSONDecodeError as error:
                        raise CaptureBlocked('Word returned incomplete capture output') from error
                    if not isinstance(native, dict):
                        raise CaptureBlocked('Word returned invalid capture output')
                    save_gzip(references / (key + '.native.json.gz'), native)
                    if native.get('status') != 'ok':
                        save_gzip(references / (key + '.failed-native.json.gz'), native)
                    check_capture_state(native)
                    native = validate_native(native)
                    if native['word_version'] != env['word_version']:
                        raise ValueError('Word version changed during capture')
                    payload = exported.read_bytes()
                    exported_reference = oracle(flat_package(payload))
                    validate_collections(native, exported_reference)
                    exported_reference['reference'] = 'microsoft_word_saved_flat_opc'
                    reference = {'version': VERSION, 'source_sha256': key, 'native': native,
                                 'exported': exported_reference, 'provider': env['provider'],
                                 'word_version': env['word_version'], 'word_build': env['word_build'],
                                 'flat_opc_sha256': hashlib.sha256(payload).hexdigest(),
                                 'exporter_sha256': env['exporter_sha256']}
                    save_gzip(reference_path, reference)
                    with gzip.open(references / (key + '.flat-opc.xml.gz'), 'wb', compresslevel=6) as stream:
                        stream.write(payload)
                    if sha(source) != key or sha(entry['path']) != key:
                        raise ValueError('Source input changed during capture')
                    receipt.update(status='ok', reference_sha256=sha(reference_path),
                                   flat_opc_sha256=reference['flat_opc_sha256'],
                                   unavailable=native.get('unavailable', {}))
            except subprocess.TimeoutExpired:
                receipt.update(status='timeout', error='Word capture timed out; desktop state requires inspection')
            except CaptureBlocked as exc:
                receipt.update(status='blocked', error=str(exc))
            except Exception as exc:
                receipt.update(status='error', error=str(exc))
            receipt['completed_at'] = time.time()
            save(receipt_path, receipt)
            receipts[key] = receipt
            if receipt['status'] in {'timeout', 'blocked'}:
                status(out, site, stage='capture_blocked', completed=index + 1, total=len(entries),
                       message='Word capture stopped: ' + receipt['error']
                               + '. Inspect the desktop state before resuming. Existing references and measurements are preserved.')
                raise RuntimeError(receipt['error'])
        counts = collections.Counter(r['status'] for r in receipts.values())
        status(out, site, stage='capturing', completed=index + 1, total=len(entries), references_ok=counts['ok'],
               reference_errors=len(receipts) - counts['ok'],
               message=f"Word references: {index + 1:,}/{len(entries):,} attempted; {counts['ok']:,} captured. Fresh parser timings follow capture.")
        if (index + 1) % 10 == 0 or index + 1 == len(entries):
            print(json.dumps({'captured': index + 1, 'total': len(entries), 'status': counts,
                              'elapsed_s': round(time.time() - started, 1)}), flush=True)
    save(out / 'capture-summary.json', {'total': len(entries), 'status': dict(collections.Counter(r['status'] for r in receipts.values())),
                                     'completed_at': time.time(), 'manifest_sha256': env['manifest_sha256'],
                                     'exporter_sha256': env['exporter_sha256']})
    status(out, site, stage='capture_complete', message=f"Word capture complete: {len(entries):,} attempted. Preparing fresh accuracy and latency measurements.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['prepare', 'capture'])
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--binary', type=Path)
    parser.add_argument('--site', type=Path)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--timeout', type=int, default=180)
    parser.add_argument('--formatting-budget', type=int, default=3)
    args = parser.parse_args()
    if args.phase == 'prepare':
        if args.formatting_budget < 0:
            parser.error('--formatting-budget must be nonnegative; zero means unlimited')
        prepare(args.out.resolve(), args.manifest, args.binary, args.formatting_budget)
    else:
        capture(args.out.resolve(), args.site, args.limit, args.timeout)


if __name__ == '__main__':
    main()
