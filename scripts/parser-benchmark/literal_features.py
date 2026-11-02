import collections

from corpus import norm
from semantic_audit import ordered_pairs, source_body, subsequence_positions


def literal_anchors(reference, actual, with_value=False):
    source = [item for item in reference if item['story'] == 'body' and item['text']]
    targets = [item for item in actual if item['story'] == 'body' and item['text']]
    available = set(range(len(targets)))
    pending = []
    matched = 0
    extra_characters = 0
    for item in source:
        exact = next((index for index in sorted(available)
                      if item['text'] == targets[index]['text']
                      and (not with_value or item.get('value') == targets[index].get('value'))), None)
        if exact is None:
            pending.append(item)
        else:
            available.remove(exact)
            matched += 1
    options = []
    for item in pending:
        candidates = [index for index in sorted(available)
                      if (not with_value or item.get('value') == targets[index].get('value'))
                      and len(item['text']) <= len(targets[index]['text'])
                      and subsequence_positions(item['text'], targets[index]['text']) is not None]
        options.append(candidates)
    owners = {}
    for start in range(len(pending)):
        queue = collections.deque([start])
        parents = {start: None}
        found = False
        while queue and not found:
            left = queue.popleft()
            for right in options[left]:
                owner = owners.get(right)
                if owner is None:
                    while True:
                        owners[right] = left
                        if parents[left] is None:
                            break
                        left, right = parents[left]
                    found = True
                    break
                if owner not in parents:
                    parents[owner] = (left, right)
                    queue.append(owner)
    matched += len(owners)
    extra_characters = sum(len(targets[right]['text']) - len(pending[left]['text'])
                           for right, left in owners.items())
    return {'matched': matched, 'expected': len(source), 'found': len(targets),
            'recall': matched / len(source) if source else None,
            'inserted_characters': extra_characters,
            'unit': 'one-to-one literal-content subsequence anchor' + (' and exact span value' if with_value else '')}


def score_literal_features(path, reference, actual, native_model=None):
    source = source_body(path)
    paragraphs = []
    found = 0
    for paragraph in actual.get('paragraphs', []):
        if paragraph['story'] != 'body':
            continue
        runs = paragraph.get('runs') or [{'text': norm(paragraph['text'])}]
        text = ''.join(run['text'] for run in runs)
        flags = [bool(run.get('bold')) for run in runs for _ in run['text']]
        if text:
            paragraphs.append({'text': text, 'flags': flags})
            found += sum(flags)
    matched = expected = 0
    for paragraph, match in ordered_pairs(source['paragraphs'], paragraphs):
        required = paragraph['required']['bold']
        expected += sum(required)
        if match is not None:
            target, positions = match
            matched += sum(bool(target['flags'][position]) for index, position in enumerate(positions)
                           if required[index])
    result = {'explicit_bold_characters': {'matched': matched, 'expected': expected, 'found': found,
               'recall': matched / expected if expected else None,
               'unit': 'explicit source bold characters at aligned literal paragraph offsets'}}
    for key, original, span in [('horizontal_spans_literal', 'horizontal_merges', True),
                               ('table_text_literal', 'tables', False)]:
        if original in reference.get('features', {}):
            result[key] = literal_anchors(reference['features'][original],
                                           actual.get('features', {}).get(original, []), span)
    if native_model is not None:
        from semantic_audit import audit, model_body
        model = model_body(native_model)
        checked = audit(source, model)
        for name, key in [('hyperlink_target_characters', 'hyperlink_target_characters_at_literal_offsets'),
                          ('explicit_italic_characters', 'explicit_italic_characters_at_literal_offsets')]:
            value = checked[key]
            flag = 'link' if name.startswith('hyperlink') else 'italic'
            result[name] = {**value, 'found': sum(bool(v) for p in model['paragraphs'] for v in p['flags'][flag]),
                            'unit': 'explicit source markup at ordered literal character offsets; inherited styles and field links are outside reference scope'}
    return result
