import collections
import xml.etree.ElementTree as ET

from corpus import attr, tag
from image_payload_audit import sha, source_images, uri_bytes


UNIT = 'source image occurrence matched to native payload bytes, allowing declared SVG alternatives'


def body_image_nodes(engine, model):
    if engine == 'docx-core':
        return model.get('nodes', [])
    images = []
    resources = {item[0]: item[2] for item in model.get('images', [])
                 if isinstance(item, list) and len(item) >= 3} if engine == 'docx-rs' else {}

    def picture(value):
        data = value.get('image') or resources.get(value.get('id'))
        images.append({'type': 'image', 'data': data})

    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            kind = value.get('type')
            if kind in {'delete', 'moveFrom', 'footnote', 'endnote', 'Note'}:
                return
            if engine == 'office_oxide' and kind == 'image':
                images.append({'type': 'image', 'data': value.get('data')})
                return
            if engine == 'docx-rs' and kind == 'pic':
                picture(value.get('data', value))
                return
            for key, item in value.items():
                if key in {'header', 'footer', 'sectionProperty', 'property', 'runProperty'}:
                    continue
                if engine == 'docx-rs' and key in {'pic', 'picture', 'imageData'} and isinstance(item, dict):
                    picture(item.get('data', item))
                else:
                    walk(item)

    if engine == 'office_oxide':
        for section in model.get('sections', []):
            walk(section.get('elements', []))
    elif engine == 'docx-rs':
        walk(model.get('document', {}).get('children', []))
    else:
        raise ValueError('Unsupported image adapter: ' + engine)
    return images


def undoc_payloads(model, expected_hashes):
    result = collections.Counter()
    digests = model.get('resource_payload_sha256')
    if not isinstance(digests, dict):
        raise ValueError('Native resource payload hashes were not exported')

    def occurrence(value):
        digest = digests.get(value.get('resource_id'))
        if digest in expected_hashes:
            result[digest] += 1

    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            if value.get('type') == 'Note':
                return
            if value.get('type') == 'Image':
                occurrence(value)
                return
            for item in value.get('images', []):
                occurrence(item)
            for key, item in value.items():
                if key not in {'images', 'header', 'footer', 'notes'}:
                    walk(item)

    for section in model.get('sections', []):
        walk(section.get('content', []))
    return result, []


def retained_payloads(model, expected_hashes, engine='docx-core'):
    if engine == 'undoc':
        return undoc_payloads(model, expected_hashes)
    errors = []
    seen = set()

    def payload(data, depth=0):
        result = collections.Counter()
        if data is None:
            return result
        digest = sha(data)
        if digest in expected_hashes:
            result[digest] += 1
        elif b'<svg' in data[:1000]:
            if depth >= 16:
                raise ValueError('Nested SVG limit exceeded')
            for element in ET.fromstring(data).iter():
                if tag(element) == 'image':
                    result.update(payload(uri_bytes(attr(element, 'href', '')), depth + 1))
        return result

    def walk(value):
        if isinstance(value, list):
            result = collections.Counter()
            for child in value:
                result.update(walk(child))
            return result
        if not isinstance(value, dict):
            return collections.Counter()
        if value.get('type') == 'image':
            identity = value.get('blockId')
            if identity and identity in seen:
                return collections.Counter()
            if identity:
                seen.add(identity)
            direct = collections.Counter()
            try:
                raw = value.get('data')
                if raw:
                    import base64
                    data = bytes(raw) if isinstance(raw, list) else base64.b64decode(raw)
                    if sha(data) in expected_hashes:
                        direct[sha(data)] += 1
                if not direct:
                    direct = payload(uri_bytes(value.get('src')))
            except (ValueError, TypeError, ET.ParseError) as error:
                errors.append(str(error))
            return direct | walk(value.get('contentNodes', []))
        result = collections.Counter()
        for key, child in value.items():
            if key not in {'sourceXml', 'sourceParts', 'sourceRunProvenance', 'metadata'}:
                result.update(walk(child))
        return result

    return walk(body_image_nodes(engine, model)), errors


def match_occurrences(source, actual):
    slots = {digest: [(digest, i) for i in range(min(count, len(source)))]
             for digest, count in actual.items()}
    owners = {}
    for start in range(len(source)):
        pending = collections.deque([start])
        parents = {start: None}
        found = False
        while pending and not found:
            left = pending.popleft()
            for digest in source[left].get('representations', []):
                for slot in slots.get(digest, []):
                    owner = owners.get(slot)
                    if owner is None:
                        while True:
                            owners[slot] = left
                            if parents[left] is None:
                                break
                            left, slot = parents[left]
                        found = True
                        break
                    if owner not in parents:
                        parents[owner] = (left, slot)
                        pending.append(owner)
                if found:
                    break
    return owners


def score_image_occurrences(path, model, engine='docx-core'):
    source = source_images(path)
    expected_hashes = {digest for item in source for digest in item['representations']}
    actual, errors = retained_payloads(model, expected_hashes, engine)
    matches = match_occurrences(source, actual)
    return {'matched': len(matches), 'expected': len(source), 'found': sum(actual.values()),
            'recall': len(matches) / len(source) if source else None,
            'exact_count': len(source) == sum(actual.values()), 'unit': UNIT,
            'unresolved_source_relationships': sum(not item['representations'] for item in source),
            'svg_alternatives': sum(digest != source[index]['sha256']
                                    for (digest, _), index in matches.items()),
            'errors': errors}
