import collections

from corpus import norm


VERSION = 'ordered-lcs-and-feature-prf-v2'


def prf(matched, expected, found):
    recall = matched / expected if expected else 1.0
    precision = matched / found if found else 1.0
    return {'recall': recall, 'precision': precision,
            'f1': 2 * matched / (expected + found) if expected + found else 1.0}


def lcs_length(left, right):
    if left == right:
        return len(left)
    if len(right) > len(left):
        left, right = right, left
    positions = collections.defaultdict(int)
    for index, character in enumerate(right):
        positions[character] |= 1 << index
    state = 0
    for character in left:
        overlap = positions[character] | state
        state = overlap & ~(overlap - ((state << 1) | 1))
    return state.bit_count()


def ordered_text(reference, actual):
    left = [norm(p['text']) for p in reference if norm(p['text'])]
    right = [norm(p['text']) for p in actual if norm(p['text'])]
    expected, found = ''.join(left), ''.join(right)
    matched = lcs_length(expected, found)
    return {'version': VERSION, 'expected': len(expected), 'found': len(found), 'matched': matched,
            'exact_ordered_text': expected == found, 'exact_ordered_paragraphs': left == right,
            'unit': 'longest common subsequence of NFC body characters, ignoring whitespace and soft breaks',
            **prf(matched, len(expected), len(found))}


def strict_features(reference, actual):
    result = {}
    for name in set(reference.get('features', {})) | set(actual.get('features', {})):
        expected = [x for x in reference.get('features', {}).get(name, []) if x['story'] == 'body']
        found = [x for x in actual.get('features', {}).get(name, []) if x['story'] == 'body']
        if name == 'textbox_text':
            expected = [p for p in reference['paragraphs'] if p['story'] == 'body' and p.get('textbox')]
            found = [p for p in actual['paragraphs'] if p['story'] == 'body' and p.get('textbox')]
        if name in ('images', 'equations'):
            matched = min(len(expected), len(found))
            a, b = len(expected), len(found)
            unit = 'occurrence count proxy; identity and geometry are not established'
        else:
            def key(item):
                return (norm(item.get('text', '')), item.get('value'))
            a_counts = collections.Counter(key(x) for x in expected if norm(x.get('text', '')))
            b_counts = collections.Counter(key(x) for x in found if norm(x.get('text', '')))
            matched, a, b = sum((a_counts & b_counts).values()), sum(a_counts.values()), sum(b_counts.values())
            unit = 'exact normalized feature anchors and values; source-explicit styling and run segmentation may differ'
        if a or b:
            result[name] = {'matched': matched, 'expected': a, 'found': b, 'unit': unit, **prf(matched, a, b)}
    for story in ('header', 'footer', 'footnotes', 'endnotes', 'comments'):
        expected = [p for p in reference['paragraphs'] if p['story'] == story]
        found = [p for p in actual['paragraphs'] if p['story'] == story]
        if expected or found:
            result[story + '_ordered_text'] = ordered_text(expected, found)
    return result
