import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
import posixpath
import xml.etree.ElementTree as ET
import zipfile

from corpus import W, attr, child, descendants, norm, ns, p_text, selected, tag


def metric(matched, expected, **details):
    return {'matched': matched, 'expected': expected,
            'recall': matched / expected if expected else None, **details}


def subsequence_positions(expected, actual):
    if expected == actual:
        return list(range(len(expected)))
    positions = []
    cursor = 0
    for character in expected:
        cursor = actual.find(character, cursor)
        if cursor < 0:
            return None
        positions.append(cursor)
        cursor += 1
    return positions


def source_body(path):
    with zipfile.ZipFile(path) as package:
        names = set(package.namelist())

        def xml(name):
            return ET.fromstring(package.read(name))

        def rels(part):
            name = posixpath.join(posixpath.dirname(part), '_rels',
                                  posixpath.basename(part) + '.rels') if part else '_rels/.rels'
            if name not in names:
                return {}
            return {attr(item, 'Id'): {'type': attr(item, 'Type', '').split('/')[-1],
                                      'target': attr(item, 'Target', ''),
                                      'external': attr(item, 'TargetMode') == 'External'}
                    for item in xml(name)}

        main = next((item['target'] for item in rels('').values()
                     if item['type'] == 'officeDocument'), 'word/document.xml').lstrip('/')
        relationships = rels(main)
        root = xml(main)
        paragraphs = []
        cells = []
        image_occurrences = 0
        for element in descendants(root):
            if tag(element) in {'blip', 'imagedata'}:
                image_occurrences += 1
            if ns(element) not in W:
                continue
            if tag(element) == 'tc':
                merge = child(child(element, 'tcPr'), 'vMerge')
                text = norm(''.join(p_text(item) for item in descendants(element)
                                    if ns(item) in W and tag(item) == 'p'))
                cells.append({'text': text, 'restart': merge is not None
                              and attr(merge, 'val') == 'restart'})
            if tag(element) != 'p':
                continue
            pieces = []
            required = {'bold': [], 'italic': [], 'link': []}
            unresolved_links = 0

            def walk(node, bold=False, italic=False, link=None):
                nonlocal unresolved_links
                if node is not element and ns(node) in W and tag(node) == 'p':
                    return
                if ns(node) in W:
                    if tag(node) == 'hyperlink':
                        relationship = relationships.get(attr(node, 'id'), {})
                        target = relationship.get('target')
                        if target and not relationship.get('external') and not target.startswith('#'):
                            target = posixpath.normpath(posixpath.join(posixpath.dirname(main), target)).lstrip('/')
                        anchor = attr(node, 'anchor')
                        if target is not None:
                            link = target.split('#')[0] + '#' + anchor if anchor else target
                        elif anchor:
                            link = '#' + anchor
                        else:
                            link = None
                            unresolved_links += 1
                    if tag(node) == 'r':
                        properties = child(node, 'rPr')
                        explicit_bold = child(properties, 'b')
                        explicit_italic = child(properties, 'i')
                        bold = explicit_bold is not None and attr(explicit_bold, 'val', '1') not in {'0', 'false', 'off'}
                        italic = explicit_italic is not None and attr(explicit_italic, 'val', '1') not in {'0', 'false', 'off'}
                    value = node.text or '' if tag(node) == 't' else '\u2011' if tag(node) == 'noBreakHyphen' else ''
                    if value:
                        value = norm(value)
                        pieces.append(value)
                        required['bold'].extend([bold] * len(value))
                        required['italic'].extend([italic] * len(value))
                        required['link'].extend([link] * len(value))
                for item in selected(node):
                    walk(item, bold, italic, link)

            walk(element)
            text = ''.join(pieces)
            if text:
                paragraphs.append({'text': text, 'required': required,
                                   'unresolved_links': unresolved_links})
        return {'paragraphs': paragraphs, 'cells': cells, 'image_occurrences': image_occurrences}


def model_body(model):
    paragraphs = []
    cells = []
    images = 0
    composites = 0
    checkboxes = 0

    def walk(nodes):
        nonlocal images, composites, checkboxes
        for node in nodes or []:
            if node.get('type') == 'table':
                for row in node.get('rows', []):
                    for cell in row.get('cells', []):
                        record = {'style': cell.get('style') or {}}
                        cells.append(record)
                        first = len(paragraphs)
                        walk(cell.get('nodes'))
                        record['text'] = ''.join(item['text'] for item in paragraphs[first:])
            elif node.get('type') == 'paragraph':
                pieces = []
                flags = {'bold': [], 'italic': [], 'link': []}
                nested = []
                for run in node.get('children', []):
                    kind = run.get('type')
                    value = ''
                    if kind == 'text':
                        value = run.get('text', '')
                    elif kind == 'form-field':
                        if run.get('fieldType') == 'checkbox':
                            checkboxes += 1
                            symbol_key = 'checkedSymbol' if run.get('checked') else 'uncheckedSymbol'
                            value = run.get(symbol_key, '')
                            if not value and run.get('sourceKind') == 'sdt':
                                value = '\u2612' if run.get('checked') else '\u2610'
                        else:
                            value = run.get('displayValue', run.get('value', ''))
                    elif kind == 'image':
                        if not run.get('mathMl') and (run.get('src') or run.get('data') or run.get('partName')):
                            images += 1
                            composites += bool(run.get('contentNodes'))
                        nested.extend(run.get('contentNodes') or [])
                        if not run.get('contentNodes') and run.get('syntheticTextBox') and run.get('textBoxText'):
                            nested.append({'type': 'paragraph', 'children': [{'type': 'text', 'text': run['textBoxText']}]})
                    value = norm(value)
                    pieces.append(value)
                    style = run.get('style') or {}
                    flags['bold'].extend([bool(style.get('bold'))] * len(value))
                    flags['italic'].extend([bool(style.get('italic'))] * len(value))
                    flags['link'].extend([run.get('link')] * len(value))
                text = ''.join(pieces)
                if text:
                    paragraphs.append({'text': text, 'flags': flags})
                walk(nested)

    walk(model.get('nodes'))
    return {'paragraphs': paragraphs, 'cells': cells, 'image_nodes_with_payload': images,
            'image_nodes_with_payload_and_textbox_content': composites,
            'semantic_checkbox_fields': checkboxes}


def ordered_pairs(expected, actual):
    cursor = 0
    for source in expected:
        match = None
        for index in range(cursor, len(actual)):
            target = actual[index]
            positions = subsequence_positions(source['text'], target['text'])
            if positions is not None:
                match = (target, positions)
                cursor = index + 1
                break
        yield source, match


def audit(source, actual):
    counts = collections.Counter()
    for expected, match in ordered_pairs(source['paragraphs'], actual['paragraphs']):
        counts['paragraphs_expected'] += 1
        counts['literal_characters_expected'] += len(expected['text'])
        counts['unresolved_source_hyperlinks'] += expected['unresolved_links']
        for key in ['bold', 'italic', 'link']:
            counts[key + '_expected'] += sum(bool(value) for value in expected['required'][key])
        if match is None:
            continue
        target, positions = match
        counts['paragraphs_matched'] += 1
        counts['literal_characters_matched'] += len(expected['text'])
        counts['inserted_characters_in_matched_paragraphs'] += len(target['text']) - len(expected['text'])
        for key in ['bold', 'italic', 'link']:
            for index, position in enumerate(positions):
                required = expected['required'][key][index]
                if required:
                    value = target['flags'][key][position]
                    counts[key + '_matched'] += value == required
                    if key == 'link':
                        counts['link_presence_matched'] += bool(value)
    restart_anchors = [item for item in source['cells'] if item['restart'] and item['text']]
    anchors_matched = 0
    one_row_anchors = 0
    for _, match in ordered_pairs(restart_anchors, [item for item in actual['cells'] if item['text']]):
        if match is not None:
            anchors_matched += 1
            one_row_anchors += (match[0]['style'].get('rowSpan') or 1) == 1
    return {
        'ordered_literal_paragraphs': metric(counts['paragraphs_matched'], counts['paragraphs_expected']),
        'literal_characters_in_matched_paragraphs': metric(counts['literal_characters_matched'], counts['literal_characters_expected']),
        'explicit_bold_characters_at_literal_offsets': metric(counts['bold_matched'], counts['bold_expected']),
        'explicit_italic_characters_at_literal_offsets': metric(counts['italic_matched'], counts['italic_expected']),
        'hyperlink_target_characters_at_literal_offsets': metric(counts['link_matched'], counts['link_expected']),
        'hyperlink_presence_characters_at_literal_offsets': metric(counts['link_presence_matched'], counts['link_expected']),
        'vertical_restart_content_anchors': metric(anchors_matched, len(restart_anchors), matched_with_single_row=one_row_anchors),
        'diagnostics': {'inserted_characters_in_matched_paragraphs': counts['inserted_characters_in_matched_paragraphs'],
                        'unresolved_source_hyperlinks': counts['unresolved_source_hyperlinks'],
                        'source_image_occurrences': source['image_occurrences'],
                        **{key: value for key, value in actual.items() if key not in {'paragraphs', 'cells'}}},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    entries = [entry for entry in json.loads(args.manifest.read_text())['entries'] if entry['format'] == 'docx']
    if args.limit:
        entries = entries[:args.limit]
    rows = []
    for index, entry in enumerate(entries):
        row = {'id': entry['id']}
        try:
            model_path = args.models / (entry['id'] + '.json.gz')
            model_bytes = model_path.read_bytes()
            row['model_artifact_sha256'] = hashlib.sha256(model_bytes).hexdigest()
            model = json.loads(gzip.decompress(model_bytes))
            row.update(status='ok', checks=audit(source_body(entry['path']), model_body(model)))
        except Exception as error:
            row.update(status='audit_error', error=str(error))
        rows.append(row)
        if (index + 1) % 50 == 0:
            print('AUDITED', index + 1, '/', len(entries), flush=True)
    totals = collections.defaultdict(collections.Counter)
    diagnostics = collections.Counter()
    for row in rows:
        for key, value in row.get('checks', {}).items():
            if key == 'diagnostics':
                diagnostics.update(value)
            else:
                totals[key].update({field: number for field, number in value.items() if field != 'recall'})
    summary = {key: metric(value.pop('matched'), value.pop('expected'), **value) for key, value in totals.items()}
    result = {
        'scope': 'Additive body-only audit of retained native model output; original benchmark scoring is unchanged.',
        'method': 'Source literal text is aligned in paragraph order to model text with multiplicity. The model projection includes stored checkbox symbols selected using parsed checked state. Explicit formatting and resolved markup hyperlink destinations are checked on mapped characters. Output source XML is not read.',
        'limitations': ['Addition-only matching diagnoses literal preservation, not precision or generated-content correctness.',
                        'Greedy ordered paragraph alignment can leave ambiguous or missing paragraphs unmatched; source/target identity is not established.',
                        'Normalization is per inline text segment; cross-segment Unicode normalization is outside this check.',
                        'The source uses the existing reference policy for deletions and AlternateContent selection, not an independent Word execution.',
                        'Only explicit positive bold/italic and markup hyperlinks are checked; inherited formatting and field-code links are outside this check.',
                        'Unresolved source hyperlink relationships are counted separately and excluded from destination denominators.',
                        'Vertical restart content anchors do not verify source merge interpretation or table geometry.',
                        'Image and checkbox diagnostics are separate counts, not interchangeable recall credit or pixel fidelity.',
                        'Metric denominators cover completed audits only; audit failures remain in the status counts and per-input rows.'],
        'attempted': len(entries),
        'statuses': dict(collections.Counter(row['status'] for row in rows)),
        'summary': summary, 'diagnostics': dict(diagnostics), 'rows': rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2))
    print(json.dumps({'statuses': result['statuses'], 'summary': summary, 'diagnostics': dict(diagnostics)}, indent=2))


if __name__ == '__main__':
    main()
