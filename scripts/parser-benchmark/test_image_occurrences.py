import base64
import collections
import gzip
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from image_occurrences import match_occurrences, retained_payloads, score_image_occurrences
from image_payload_audit import sha
from assess import load_native


def uri(data, mime='image/png'):
    return f'data:{mime};base64,' + base64.b64encode(data).decode()


def image(payload, **fields):
    return {'type': 'image', 'src': uri(payload), **fields}


class OccurrenceTests(unittest.TestCase):
    def test_oxide_counts_body_placements_not_notes_or_headers(self):
        data = b'bitmap'
        node = {'type': 'image', 'data': base64.b64encode(data).decode()}
        model = {'sections': [{'elements': [node, {'type': 'paragraph', 'content': [node]},
                                             {'type': 'footnote', 'content': [node]}],
                               'header': {'content': [node]}}]}
        self.assertEqual(retained_payloads(model, {sha(data)}, 'office_oxide')[0], {sha(data): 2})

    def test_docx_rs_requires_image_placement_and_retained_resource(self):
        data = b'bitmap'
        pic = {'type': 'pic', 'data': {'id': 'r1'}}
        shape = {'type': 'shape', 'data': {'imageData': {'id': 'r1'}}}
        model = {'images': [['r1', 'media/image.png', base64.b64encode(data).decode()],
                            ['unused', 'media/unused.png', base64.b64encode(data).decode()]],
                 'document': {'children': [pic, shape, {'type': 'pic', 'data': {'id': 'missing'}},
                                           {'type': 'delete', 'data': {'children': [pic]}}]}}
        self.assertEqual(retained_payloads(model, {sha(data)}, 'docx-rs')[0], {sha(data): 2})

    def test_undoc_uses_native_bytes_for_each_body_reference(self):
        digest = sha(b'bitmap')
        model = {'resource_payload_sha256': {'r1': digest, 'unused': digest},
                 'sections': [{'content': [{'type': 'Paragraph', 'images': [{'resource_id': 'r1'}]},
                                          {'type': 'Image', 'resource_id': 'r1'},
                                          {'type': 'Note', 'content': [{'images': [{'resource_id': 'r1'}]}]}],
                               'header': [{'images': [{'resource_id': 'r1'}]}]}]}
        self.assertEqual(retained_payloads(model, {digest}, 'undoc')[0], {digest: 2})

    def test_undoc_missing_export_is_not_scored_as_zero(self):
        with self.assertRaisesRegex(ValueError, 'not exported'):
            retained_payloads({'resources': {'r1': {'size': 10}}}, {sha(b'bitmap')}, 'undoc')

    def test_repeated_placements_preserve_multiplicity(self):
        data = b'bitmap'
        digest = sha(data)
        svg = f'<svg><image href="{uri(data)}"/><image href="{uri(data)}"/></svg>'.encode()
        node = image(svg, contentNodes=[image(data)])
        actual, errors = retained_payloads({'nodes': [node]}, {digest})
        self.assertEqual(actual, {digest: 2})
        self.assertFalse(errors)
        self.assertEqual(len(match_occurrences([{'representations': [digest]}] * 3, actual)), 2)

    def test_raw_and_rendered_copies_count_once(self):
        data = b'bitmap'
        actual, errors = retained_payloads({'nodes': [image(data, data=list(data))]}, {sha(data)})
        self.assertEqual(actual, {sha(data): 1})
        self.assertFalse(errors)

    def test_preserved_source_and_unrelated_payload_receive_no_credit(self):
        data = b'bitmap'
        model = {'nodes': [{'sourceParts': [image(data)], 'sourceXml': uri(data)}, image(b'other')]}
        self.assertEqual(retained_payloads(model, {sha(data)})[0], {})

    def test_declared_alternatives_use_one_to_one_matching(self):
        source = [{'representations': ['png', 'svg']}, {'representations': ['png']}]
        self.assertEqual(len(match_occurrences(source, collections.Counter(png=1, svg=1))), 2)
        self.assertEqual(len(match_occurrences(source, collections.Counter(svg=1))), 1)

    def test_malformed_composites_report_an_error(self):
        actual, errors = retained_payloads({'nodes': [image(b'<svg>')]}, {sha(b'bitmap')})
        self.assertFalse(actual)
        self.assertEqual(len(errors), 1)

    def test_nested_composite_payload(self):
        data = b'bitmap'
        inner = f'<svg><image href="{uri(data)}"/></svg>'.encode()
        outer = f'<svg><image href="{uri(inner, "image/svg+xml")}"/></svg>'.encode()
        self.assertEqual(retained_payloads({'nodes': [image(outer)]}, {sha(data)})[0], {sha(data): 1})

    def test_streaming_loader_retains_payloads_when_requested(self):
        data = b'bitmap'
        composite = f'<svg><image href="{uri(data)}"/></svg>'.encode()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'model.json.gz'
            with gzip.open(path, 'wt') as stream:
                json.dump({'nodes': [image(composite)], 'sourceXml': 'preserved source'}, stream)
            lightweight = load_native('docx-core', path)
            full = load_native('docx-core', path, preserve_image_payloads=True)
            self.assertEqual(lightweight['nodes'][0]['src'], '[present]')
            self.assertNotIn('sourceXml', full)
            self.assertEqual(retained_payloads(full, {sha(data)})[0], {sha(data): 1})

    def test_source_alternative_and_missing_occurrence(self):
        png, svg = b'fallback bitmap', b'<svg><path d="M0 0"/></svg>'
        document = '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main">
          <w:body><a:blip r:embed="r1"><a:extLst><a:ext><asvg:svgBlip r:embed="r2"/></a:ext></a:extLst></a:blip>
          <a:blip r:embed="r1"/></w:body></w:document>'''
        rels = '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="r1" Target="media/bitmap.png" Type="image"/>
          <Relationship Id="r2" Target="media/vector.svg" Type="image"/></Relationships>'''
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'input.docx'
            with zipfile.ZipFile(path, 'w') as archive:
                for name, value in [('word/document.xml', document), ('word/_rels/document.xml.rels', rels),
                                    ('word/media/bitmap.png', png), ('word/media/vector.svg', svg)]:
                    archive.writestr(name, value)
            score = score_image_occurrences(path, {'nodes': [image(svg)]})
            self.assertEqual((score['matched'], score['expected'], score['svg_alternatives']), (1, 2, 1))
            score = score_image_occurrences(path, {'nodes': [image(svg), image(png)]})
            self.assertEqual((score['matched'], score['expected']), (2, 2))


if __name__ == '__main__':
    unittest.main()
