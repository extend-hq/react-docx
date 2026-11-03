import unittest
import xml.etree.ElementTree as ET
import zipfile

from word_recall import score
from word_structured import PKG, VERSION, flat_package, validate_collections, validate_native, word_text


def reference(text='AB', spans=None):
    native = {'status': 'ok', 'body_text': text + '\r', 'tables': [], 'hyperlinks': [],
              'unavailable': {}, 'formatted_spans': spans or {'bold': [], 'italic': []}}
    return {'version': VERSION, 'native': validate_native(native),
            'exported': {'paragraphs': [{'text': text, 'story': 'body'}], 'features': {}}}


def output(text='AB', bold=False, italic=False):
    return {'paragraphs': [{'text': text, 'story': 'body',
                            'runs': [{'text': text, 'bold': bold, 'italic': italic}]}], 'features': {}}


class WordReferenceTests(unittest.TestCase):
    def test_control_markers_and_hyphens(self):
        self.assertEqual(word_text('A\x01\x07\rB\x1eC\x1fD'), 'A\rB\u2011C\u00adD')

    def test_resolved_formatting_is_independent_of_explicit_markup(self):
        expected = reference(spans={'bold': [['AB', None, 0, 2]], 'italic': []})
        missed = score(expected, output())['native_features']['resolved_bold']
        retained = score(expected, output(bold=True))['native_features']['resolved_bold']
        self.assertEqual((missed['matched'], missed['expected']), (0, 2))
        self.assertEqual(retained['recall'], 1)

    def test_extra_bold_lowers_precision(self):
        expected = reference(spans={'bold': [['B', 'A', 1, 2]], 'italic': []})
        value = score(expected, output(bold=True))['native_features']['resolved_bold']
        self.assertEqual((value['matched'], value['expected'], value['found']), (1, 1, 2))
        self.assertEqual(value['precision'], .5)

    def test_missing_word_formatting_is_unscored(self):
        expected = reference()
        expected['native']['unavailable']['resolved_formatting'] = 'missing'
        self.assertNotIn('resolved_bold', score(expected, output())['native_features'])

    def test_missing_collection_is_unscored(self):
        expected = reference()
        del expected['native']['hyperlinks']
        validate_native(expected['native'])
        self.assertNotIn('hyperlink_text', score(expected, output())['native_features'])

    def test_empty_collection_conflicting_with_export_is_unscored(self):
        expected = reference()
        expected['exported']['features']['hyperlinks'] = [{'story': 'body', 'text': 'AB'}]
        validate_collections(expected['native'], expected['exported'])
        self.assertNotIn('hyperlink_text', score(expected, output())['native_features'])

    def test_unaligned_span_is_unscored(self):
        expected = reference(spans={'bold': [['B', 'X', 1, 2]], 'italic': []})
        self.assertIn('resolved_formatting', expected['native']['unavailable'])
        self.assertNotIn('resolved_bold', score(expected, output(bold=True))['native_features'])

    def test_missing_span_text_is_not_treated_as_empty(self):
        expected = reference(spans={'bold': [[None, '', 0, 2]], 'italic': []})
        self.assertIn('resolved_formatting', expected['native']['unavailable'])

    def test_unicode_offsets_use_normalized_characters(self):
        expected = reference('😀e\u0301Z', {'bold': [['Z', '😀e\u0301', 4, 5]], 'italic': []})
        value = score(expected, output('😀éZ', bold=True))['native_features']['resolved_bold']
        self.assertEqual((value['matched'], value['expected'], value['found']), (1, 1, 3))

    def test_failed_parser_receives_zero_recall(self):
        result = score(reference(), {'paragraphs': [], 'features': {}})
        self.assertEqual(result['body']['recall'], 0)
        self.assertEqual(result['body']['expected'], 2)

    def test_textboxes_do_not_inflate_main_story(self):
        actual = output()
        actual['paragraphs'].append({'text': 'EXTRA', 'story': 'body', 'textbox': True, 'runs': []})
        self.assertEqual(score(reference(), actual)['body']['precision'], 1)

    def test_invalid_capture_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_native({'status': 'error', 'error_code': -1})

    def test_truncated_whole_range_uses_complete_word_paragraphs(self):
        native = {'status': 'ok', 'body_text': 'A', 'reported_paragraph_count': 2,
                  'paragraph_texts': ['AB\r', 'CD\r'], 'formatted_spans': {'bold': [], 'italic': []}}
        value = validate_native(native)
        self.assertEqual(value['body_text'], 'AB\rCD\r')
        self.assertFalse(value['body_range_agrees_with_paragraphs'])

    def test_incomplete_paragraph_fallback_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_native({'status': 'ok', 'body_text': 'A', 'reported_paragraph_count': 2,
                             'paragraph_texts': ['AB\r']})

    def test_unrepaired_body_count_mismatch_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_native({'status': 'ok', 'body_text': 'A', 'reported_paragraph_count': 2})

    def test_body_and_paragraph_mismatch_is_rejected(self):
        native = reference()['native']
        native['paragraphs'][0]['text'] = 'X'
        with self.assertRaises(ValueError):
            validate_native(native)

    def test_flat_opc_rejects_duplicate_or_escaping_parts(self):
        for names in [('a.xml', 'a.xml'), ('../a.xml',)]:
            root = ET.Element(PKG + 'package')
            for name in names:
                part = ET.SubElement(root, PKG + 'part', {PKG + 'name': '/' + name, PKG + 'contentType': 'application/xml'})
                data = ET.SubElement(part, PKG + 'xmlData')
                ET.SubElement(data, 'value')
            with self.assertRaises(ValueError):
                flat_package(ET.tostring(root))

    def test_flat_opc_preserves_payload_and_declares_content_type(self):
        root = ET.Element(PKG + 'package')
        part = ET.SubElement(root, PKG + 'part', {PKG + 'name': '/media/data.bin', PKG + 'contentType': 'application/octet-stream'})
        ET.SubElement(part, PKG + 'binaryData').text = 'AQID'
        with zipfile.ZipFile(flat_package(ET.tostring(root))) as package:
            self.assertEqual(package.read('media/data.bin'), b'\x01\x02\x03')
            self.assertIn(b'application/octet-stream', package.read('[Content_Types].xml'))


if __name__ == '__main__':
    unittest.main()
