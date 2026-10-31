import unittest
import tempfile
import zipfile
from pathlib import Path

from literal_features import literal_anchors, score_literal_features


def anchor(text, value=2):
    return {'text': text, 'value': value, 'story': 'body'}


class LiteralAnchorTests(unittest.TestCase):
    def test_bold_offsets_ignore_segmentation_and_require_correct_style(self):
        xml = '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r>
        <w:r><w:rPr><w:b/></w:rPr><w:t>B</w:t></w:r><w:r><w:t>C</w:t></w:r></w:p></w:body></w:document>'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.docx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('word/document.xml', xml)
            def score(runs):
                actual = {'paragraphs': [{'story': 'body', 'text': ''.join(run['text'] for run in runs), 'runs': runs}]}
                return score_literal_features(path, {'features': {}}, actual)['explicit_bold_characters']
            good = score([{'text': 'AB', 'bold': True}, {'text': 'C'}])
            self.assertEqual((good['matched'], good['expected']), (2, 2))
            wrong = score([{'text': 'A'}, {'text': 'BC', 'bold': True}])
            self.assertEqual((wrong['matched'], wrong['expected']), (1, 2))
            missing = score([{'text': 'A', 'bold': True}, {'text': 'C'}])
            self.assertEqual((missing['matched'], missing['expected']), (0, 2))

    def test_added_symbols_preserve_literal_text_and_span(self):
        score = literal_anchors([anchor('YesNo')], [anchor('□Yes□No')], True)
        self.assertEqual((score['matched'], score['expected'], score['inserted_characters']), (1, 1, 2))

    def test_span_mismatch_and_missing_literal_are_not_credited(self):
        self.assertEqual(literal_anchors([anchor('YesNo')], [anchor('YesNo', 3)], True)['matched'], 0)
        self.assertEqual(literal_anchors([anchor('YesNo')], [anchor('Yes')])['matched'], 0)
        self.assertEqual(literal_anchors([anchor('YesNo')], [anchor('NoYes')])['matched'], 0)

    def test_occurrences_are_one_to_one(self):
        self.assertEqual(literal_anchors([anchor('A'), anchor('A')], [anchor('□A')])['matched'], 1)

    def test_matching_preserves_exact_anchors_and_assigns_ambiguous_ones(self):
        self.assertEqual(literal_anchors([anchor('A'), anchor('B')], [anchor('AB'), anchor('AC')])['matched'], 2)
        self.assertEqual(literal_anchors([anchor('A'), anchor('AB')], [anchor('A'), anchor('AB')])['matched'], 2)


if __name__ == '__main__':
    unittest.main()
