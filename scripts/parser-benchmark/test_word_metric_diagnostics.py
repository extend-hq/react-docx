import tempfile
import unittest
from pathlib import Path

from word_metric_diagnostics import positive_formatting, story_presence, verify


def source(text, bold, italic=None):
    return {'paragraphs': [{'text': text, 'required': {'bold': bold, 'italic': italic or [False] * len(text)}}]}


def output(runs, text=None):
    return {'paragraphs': [{'story': 'body', 'text': text or ''.join(r['text'] for r in runs), 'runs': runs}]}


class DiagnosticTests(unittest.TestCase):
    def test_run_boundaries_do_not_change_positive_recall(self):
        expected = source('ABC', [True] * 3, [True, False, True])
        merged = output([{'text': 'ABC', 'bold': True, 'italic': True}])
        split = output([{'text': c, 'bold': True, 'italic': True} for c in 'ABC'])
        self.assertEqual(positive_formatting(expected, merged), positive_formatting(expected, split))
        self.assertEqual(positive_formatting(expected, merged)['italic']['matched'], 2)
        self.assertNotIn('precision', positive_formatting(expected, merged)['italic'])
        self.assertNotIn('found', positive_formatting(expected, merged)['italic'])

    def test_matching_flag_counts_at_wrong_positions_get_no_credit(self):
        expected = source('AB', [True, False])
        actual = output([{'text': 'A'}, {'text': 'B', 'bold': True}])
        self.assertEqual(positive_formatting(expected, actual)['bold']['matched'], 0)

    def test_missing_paragraph_loses_credit(self):
        value = positive_formatting(source('AB', [True, True]), output([{'text': 'A', 'bold': True}]))['bold']
        self.assertEqual((value['matched'], value['expected']), (0, 2))

    def test_duplicate_paragraphs_cannot_reuse_output(self):
        expected = source('A', [True])
        expected['paragraphs'] *= 2
        value = positive_formatting(expected, output([{'text': 'A', 'bold': True}]))['bold']
        self.assertEqual((value['matched'], value['expected']), (1, 2))

    def test_insertions_preserve_literal_offsets(self):
        actual = output([{'text': 'X'}, {'text': 'A', 'bold': True}, {'text': 'B'}])
        self.assertEqual(positive_formatting(source('AB', [True, False]), actual)['bold']['matched'], 1)

    def test_inconsistent_run_text_does_not_earn_credit(self):
        value = positive_formatting(source('AB', [True, True]),
                                    output([{'text': 'A', 'bold': True}], text='AB'))['bold']
        self.assertEqual(value['matched'], 0)
        self.assertEqual(value['unaligned_output_paragraphs'], 1)

    def test_story_presence_detects_order_and_preserves_multiplicity(self):
        def story(texts):
            return {'paragraphs': [{'text': text, 'story': 'header'} for text in texts]}
        value = story_presence(story(['A', 'B']), story(['B', 'A']), 'header')
        self.assertEqual((value['matched'], value['same_content_different_order']), (2, 1))
        value = story_presence(story(['A', 'A']), story(['A']), 'header')
        self.assertEqual((value['matched'], value['expected'], value['found']), (1, 2, 1))

    def test_changed_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input'
            path.write_bytes(b'changed')
            with self.assertRaises(ValueError):
                verify(path, '0' * 64)


if __name__ == '__main__':
    unittest.main()
