import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import posixpath
import re
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

from corpus import attr, descendants, tag


def style(value):
    return {key.strip(): content.strip() for item in value.split(';') if ':' in item for key, content in [item.split(':', 1)]}


def pair(value):
    return [float(item) for item in value.replace(',', ' ').split()]


def pixels(value):
    for suffix, factor in [('px', 1), ('pt', 96 / 72), ('in', 96), ('cm', 96 / 2.54), ('mm', 96 / 25.4)]:
        if value.endswith(suffix):
            return float(value[:-len(suffix)]) * factor
    raise ValueError('Unsupported physical unit')


def payload(uri):
    prefix, content = uri.split(',', 1)
    return base64.b64decode(content) if prefix.endswith(';base64') else urllib.parse.unquote_to_bytes(content)


def model_groups(value):
    if isinstance(value, dict):
        if value.get('type') == 'image' and '<v:group' in value.get('sourceXml', '') and '<v:imagedata' in value['sourceXml']:
            yield value
        for item in value.values():
            yield from model_groups(item)
    elif isinstance(value, list):
        for item in value:
            yield from model_groups(item)


def close(left, right):
    return len(left) == len(right) and all(abs(a - b) <= 1e-8 * max(1, abs(a), abs(b)) for a, b in zip(left, right))


def normalized_color(value):
    value = value.lower()
    if value in ['white', 'black']:
        return '#ffffff' if value == 'white' else '#000000'
    if len(value) == 4 and value.startswith('#'):
        return '#' + ''.join(character * 2 for character in value[1:])
    return value


def paint_matches(original, actual):
    filled = attr(original, 'filled', 'true') not in ['false', 'f', '0']
    stroked = attr(original, 'stroked', 'true') not in ['false', 'f', '0']
    expected_fill = normalized_color(attr(original, 'fillcolor', 'white')) if filled else 'none'
    expected_stroke = normalized_color(attr(original, 'strokecolor', 'black')) if stroked else 'none'
    weight = pixels(attr(original, 'strokeweight', '0.75pt'))
    source_stroke = next((child for child in original if tag(child) == 'stroke'), None)
    dotted = source_stroke is not None and attr(source_stroke, 'dashstyle') == 'dot'
    dash_matches = close(pair(actual.get('stroke-dasharray', '')), [weight, weight * 2]) if dotted else actual.get('stroke-dasharray') is None
    return (actual.get('fill') == expected_fill and actual.get('stroke') == expected_stroke
            and close([float(actual.get('stroke-width', 'nan'))], [weight])
            and actual.get('vector-effect') == 'non-scaling-stroke' and actual.get('stroke-linejoin') == 'round' and dash_matches)


def restore_group_nodes(value, originals):
    if isinstance(value, dict):
        if value.get('type') == 'image' and '<v:group' in value.get('sourceXml', '') and '<v:imagedata' in value['sourceXml']:
            return next(originals)
        return {key: restore_group_nodes(item, originals) for key, item in value.items()}
    if isinstance(value, list):
        return [restore_group_nodes(item, originals) for item in value]
    return value


def audit(document, before_path, after_path):
    before_model = json.load(gzip.open(before_path))
    after_model = json.load(gzip.open(after_path))
    before = list(model_groups(before_model['nodes']))
    after = list(model_groups(after_model['nodes']))
    other_model_fields_preserved = before_model == restore_group_nodes(after_model, iter(before))
    with zipfile.ZipFile(document) as package:
        root = ET.fromstring(package.read('word/document.xml'))
        relationships = {attr(item, 'Id'): posixpath.normpath(posixpath.join('word', attr(item, 'Target')))
                         for item in ET.fromstring(package.read('word/_rels/document.xml.rels'))}
        groups = [item for item in descendants(root) if tag(item) == 'group'
                  and any(tag(child) == 'imagedata' for child in descendants(item))]
        if len(groups) != len(before) or len(groups) != len(after):
            raise ValueError('Source and model group occurrence counts differ')
        rows = []
        for ordinal, (group, old, new) in enumerate(zip(groups, before, after), 1):
            pictures = [item for item in descendants(group) if tag(item) == 'imagedata']
            row = {'ordinal': ordinal, 'source_bitmap_occurrences': len(pictures),
                   'source_xml_preserved': old.get('sourceXml') == new.get('sourceXml')}
            if not new.get('src', '').startswith('data:image/svg+xml'):
                row.update(status='unchanged_fallback', model_equal=old == new)
                rows.append(row)
                continue
            svg = ET.fromstring(payload(new['src']))
            declarations = style(attr(group, 'style', ''))
            viewport = pair(attr(group, 'coordorigin', '0,0')) + pair(attr(group, 'coordsize', '1000,1000'))
            canvas = pair(svg.get('viewBox'))
            physical = [pixels(declarations['width']), pixels(declarations['height'])]
            row['viewport_matches'] = all(canvas[axis] <= viewport[axis] + 1e-8 and canvas[axis] + canvas[axis + 2] >= viewport[axis] + viewport[axis + 2] - 1e-8 for axis in [0, 1])
            row['physical_size_matches'] = close([float(svg.get('width')) / canvas[2], float(svg.get('height')) / canvas[3]],
                                                 [physical[0] / viewport[2], physical[1] / viewport[3]]) and close([float(svg.get('width')), float(svg.get('height'))], [new['widthPx'], new['heightPx']])
            anchor_expected = [pixels(declarations[key]) + (canvas[axis] - viewport[axis]) * physical[axis] / viewport[axis + 2] for axis, key in enumerate(['margin-left', 'margin-top'])] if all(key in declarations for key in ['margin-left', 'margin-top']) else None
            row['anchor_preserves_source_placement'] = anchor_expected is None or all(abs(new.get('floating', {}).get(key, float('inf')) - expected) <= 0.001 for key, expected in zip(['xPx', 'yPx'], anchor_expected))
            row['independent_axis_scaling'] = svg.get('preserveAspectRatio') == 'none'
            source_layers = [item for item in group if tag(item) in ['shape', 'rect', 'line']]
            source_layers.sort(key=lambda item: float(style(attr(item, 'style', '')).get('z-index', 0)))
            output_layers = list(svg)
            row['layer_count_matches'] = len(source_layers) == len(output_layers)
            bitmaps = []
            vectors = []
            for original, actual in zip(source_layers, output_layers):
                props = style(attr(original, 'style', ''))
                kind = tag(original)
                image = next((item for item in original if tag(item) == 'imagedata'), None)
                if image is not None:
                    original_data = package.read(relationships[attr(image, 'id')])
                    actual_data = payload(actual.get('href', '')) if tag(actual) == 'image' else b''
                    expected_coordinates = [float(props.get('left', 0)), float(props.get('top', 0)), float(props['width']), float(props['height'])]
                    actual_coordinates = [float(actual.get(key, 'nan')) for key in ['x', 'y', 'width', 'height']]
                    bitmaps.append({'payload_sha256_matches': hashlib.sha256(original_data).digest() == hashlib.sha256(actual_data).digest(),
                                    'coordinates_match': close(actual_coordinates, expected_coordinates),
                                    'unclipped_picture_shape': actual.get('preserveAspectRatio') == 'none' and all(actual_coordinates[axis] >= canvas[axis] - 1e-8 and actual_coordinates[axis] + actual_coordinates[axis + 2] <= canvas[axis] + canvas[axis + 2] + 1e-8 for axis in [0, 1])})
                elif kind == 'rect':
                    expected = [float(props.get('left', 0)), float(props.get('top', 0)), float(props['width']), float(props['height'])]
                    vectors.append(tag(actual) == 'rect' and close([float(actual.get(key, 'nan')) for key in ['x', 'y', 'width', 'height']], expected) and paint_matches(original, actual))
                elif kind == 'line':
                    expected = pair(attr(original, 'from')) + pair(attr(original, 'to'))
                    vectors.append(tag(actual) == 'line' and close([float(actual.get(key, 'nan')) for key in ['x1', 'y1', 'x2', 'y2']], expected) and paint_matches(original, actual))
                else:
                    expected = attr(original, 'path').translate(str.maketrans({'m': 'M', 'l': 'L', 'c': 'C', 'x': 'Z', 'e': ''}))
                    origin = pair(attr(original, 'coordorigin', '0,0'))
                    extent = pair(attr(original, 'coordsize'))
                    transform = [float(props.get('left', 0)), float(props.get('top', 0)), float(props['width']) / extent[0] if extent[0] else 1, float(props['height']) / extent[1] if extent[1] else 1, -origin[0], -origin[1]]
                    actual_transform = actual.get('transform', '')
                    transform_values = [float(item) for item in re.findall(r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?', actual_transform)]
                    transform_commands = re.findall(r'[a-zA-Z]+(?=\()', actual_transform)
                    vectors.append(tag(actual) == 'path' and ''.join(actual.get('d', '').split()) == ''.join(expected.split())
                                   and transform_commands == ['translate', 'scale', 'translate'] and close(transform_values, transform)
                                   and paint_matches(original, actual))
            row.update(status='composited', bitmap_occurrences=len(bitmaps),
                       bitmap_payloads_matched=sum(item['payload_sha256_matches'] for item in bitmaps),
                       bitmap_coordinates_matched=sum(item['coordinates_match'] for item in bitmaps),
                       bitmap_shapes_matched=sum(item['unclipped_picture_shape'] for item in bitmaps),
                       vector_layers=len(vectors), vector_geometry_matched=sum(vectors))
            row['passed'] = all(row[key] for key in ['source_xml_preserved', 'viewport_matches', 'physical_size_matches', 'anchor_preserves_source_placement', 'independent_axis_scaling', 'layer_count_matches']) and row['bitmap_occurrences'] == len(pictures) and all(all(item.values()) for item in bitmaps) and all(vectors)
            rows.append(row)
    return {'source_groups': len(groups), 'composited_groups': sum(row['status'] == 'composited' for row in rows),
            'composited_bitmap_occurrences': sum(row.get('bitmap_occurrences', 0) for row in rows),
            'bitmap_payloads_matched': sum(row.get('bitmap_payloads_matched', 0) for row in rows),
            'bitmap_coordinates_matched': sum(row.get('bitmap_coordinates_matched', 0) for row in rows),
            'newly_retained_bitmap_placements': sum(row.get('bitmap_occurrences', 1) - 1 for row in rows),
            'other_model_fields_preserved': other_model_fields_preserved,
            'passed': other_model_fields_preserved and all(row.get('passed', row.get('model_equal', False)) for row in rows), 'rows': rows}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--before-model', type=Path, required=True)
    parser.add_argument('--after-model', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.input, args.before_model, args.after_model)
    result['sha256'] = {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in [('input', args.input), ('before_model', args.before_model), ('after_model', args.after_model)]}
    result['scope'] = 'Independent source ZIP bitmap bytes and group/layer coordinates versus generated SVG, preserving paint order. This is a structural placement audit, not a Word-rendered pixel comparison. Original occurrence scorer is unchanged.'
    args.out.write_text(json.dumps(result, indent=2))
    print(json.dumps({key: value for key, value in result.items() if key != 'rows'}, indent=2))
    if not result['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
