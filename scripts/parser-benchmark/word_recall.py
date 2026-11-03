import collections
import re

from corpus import norm
from fidelity_metrics import ordered_text, prf, strict_features
from literal_features import literal_anchors
from semantic_audit import ordered_pairs
from word_structured import VERSION, word_text


def metric(matched, expected, found, unit):
    return {'matched': matched, 'expected': expected, 'found': found, 'unit': unit,
            **prf(matched, expected, found)}


def anchors(expected, found, values=False):
    def key(item):
        text = norm(word_text(item.get('text', '')))
        return (text, item.get('value')) if values else text
    left = collections.Counter(key(x) for x in expected if key(x))
    right = collections.Counter(key(x) for x in found if key(x))
    return metric(sum((left & right).values()), sum(left.values()), sum(right.values()),
                  'one-to-one normalized text anchors' + (' and exact value' if values else ''))


def native_paragraphs(native):
    result = []
    offset = 0
    for p in native['paragraphs']:
        text = norm(word_text(p['text']))
        if not text:
            continue
        value = {'text': text, 'story': 'body', 'flags': {'bold': [], 'italic': []}}
        for run in p.get('runs', []):
            size = len(norm(word_text(run[0])))
            for key, index in [('bold', 3), ('italic', 4)]:
                value['flags'][key].extend([run[index]] * size)
        if 'formatted_spans' in native:
            for key in ['bold', 'italic']:
                flags = [False] * len(text)
                for span in native['formatted_spans'][key]:
                    start = max(0, span['offset'] - offset)
                    end = min(len(text), span['offset'] + len(span['text']) - offset)
                    if end > start:
                        flags[start:end] = [True] * (end - start)
                value['flags'][key] = flags
        offset += len(text)
        match = re.fullmatch(r'outline level([1-9])', p.get('outline', ''))
        if match:
            value['heading'] = int(match[1])
        value['list'] = p.get('list_type', 'list no numbering') != 'list no numbering'
        result.append(value)
    return result


def score(reference, actual):
    if reference.get('version') != VERSION:
        raise ValueError('Unsupported Word reference version')
    native = reference['native']
    unavailable = native.get('unavailable', {})
    expected = native_paragraphs(native)
    body = [p for p in actual['paragraphs'] if p['story'] == 'body' and not p.get('textbox')]
    actual_features = {name: [v for v in values if v['story'] == 'body']
                       for name, values in actual.get('features', {}).items()}
    result = {'version': VERSION, 'body': ordered_text(expected, body), 'native_features': {},
              'export_features': strict_features(reference['exported'], actual),
              'unavailable': dict(unavailable)}
    features = result['native_features']
    if all('outline' in p and 'list_type' in p for p in native['paragraphs']):
        features['headings'] = anchors([{'text': p['text'], 'value': p['heading']} for p in expected if p.get('heading')],
                                       actual_features.get('headings', []), True)
        features['list_paragraphs'] = anchors([p for p in expected if p['list']], actual_features.get('lists', []))
    if 'resolved_formatting' not in unavailable:
        target = []
        for p in body:
            runs = p.get('runs', [])
            if norm(p['text']) != ''.join(r['text'] for r in runs):
                runs = [{'text': norm(p['text'])}]
            target.append({'text': norm(p['text']),
                           'flags': {key: [bool(r.get(key)) for r in runs for _ in r['text']]
                                     for key in ['bold', 'italic']}})
        matched = collections.Counter()
        for p, aligned in ordered_pairs(expected, target):
            if aligned is None:
                continue
            other, positions = aligned
            for key in ['bold', 'italic']:
                matched[key] += sum(flag and other['flags'][key][positions[i]]
                                    for i, flag in enumerate(p['flags'][key]))
        for key in ['bold', 'italic']:
            features['resolved_' + key] = metric(matched[key], sum(sum(p['flags'][key]) for p in expected),
                                                sum(sum(p['flags'][key]) for p in target),
                                                'Word-resolved formatted characters at ordered literal paragraph offsets')
    if 'tables' not in unavailable:
        top = [dict(story='body', text=norm(word_text(t['text']))) for t in native['tables'] if t['nesting_level'] == 1]
        nested = collections.Counter(v['text'] for v in actual_features.get('nested_tables', []))
        found = []
        for item in actual_features.get('tables', []):
            if nested[item['text']]:
                nested[item['text']] -= 1
            else:
                found.append(item)
        features['top_level_table_text'] = anchors(top, found)
    if 'hyperlinks' not in unavailable:
        features['hyperlink_text'] = anchors([{'text': v[0]} for v in native['hyperlinks']],
                                              actual_features.get('hyperlinks', []))
    exported = reference['exported']['features']
    result['export_features']['horizontal_spans_literal'] = literal_anchors(
        exported.get('horizontal_merges', []), actual.get('features', {}).get('horizontal_merges', []), True)
    result['export_features']['table_text_literal'] = literal_anchors(
        exported.get('tables', []), actual.get('features', {}).get('tables', []))
    for value in result['export_features'].values():
        value.update(prf(value['matched'], value['expected'], value['found']))
    return result
