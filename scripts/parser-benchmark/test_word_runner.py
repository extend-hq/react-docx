import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from test_word_reference import output, reference
from word_reference_benchmark import run
from word_structured import save, sha


class WordRunnerTests(unittest.TestCase):
    def execute(self, directory, native_failure=False, parser_failure=False):
        out = Path(directory)
        (out / 'bin').mkdir()
        binary = out / 'bin/current-parser-benchmark'
        binary.write_bytes(b'binary')
        source = out / 'input.docx'
        source.write_bytes(b'input')
        entry = {'id': sha(source), 'path': str(source), 'bytes': 5}
        save(out / 'manifest.json', {'entries': [entry]})
        save(out / 'capture-environment.json', {'exporter_sha256': {}})
        save(out / 'capture-summary.json', {'total': 1, 'exporter_sha256': {},
                                           'manifest_sha256': sha(out / 'manifest.json')})
        save(out / 'build-environment.json', {'binary_sha256': sha(binary), 'source_sha256': {}})

        def process(args, **kwargs):
            failed = parser_failure and args[1] == 'docx-core'
            return subprocess.CompletedProcess(args, int(failed),
                json.dumps({'status': 'ok', 'samples': [{'total_ms': 1.0}]}), 'parser failed' if failed else '')

        def native(engine, *args, **kwargs):
            if native_failure and engine == 'docx-core':
                raise ValueError('Native output could not be decoded')
            return {}

        with patch('word_reference_benchmark.source_identity', return_value={}), \
             patch('word_reference_benchmark.platform.platform', return_value='test'), \
             patch('word_reference_benchmark.subprocess.run', side_effect=process), \
             patch('word_reference_benchmark.subprocess.check_output', return_value='revision'), \
             patch('word_reference_benchmark.load_native', side_effect=native), \
             patch('word_reference_benchmark.normalize', return_value=output()), \
             patch('word_reference_benchmark.sha', side_effect=lambda p: 'native' if str(p).endswith('native.json.gz') else sha(p)), \
             patch('word_reference_benchmark.reference_for', return_value=(reference(), 'reference')), \
             patch('word_reference_benchmark.score_image_occurrences', return_value={'matched': 0, 'expected': 0, 'found': 0}), \
             patch('word_reference_benchmark.publish'), \
             patch('word_reference_benchmark.status'):
            run(out, out, None, 5, 180)
        rows = json.loads((out / 'scores.json').read_text())
        return next(r for r in rows if r['engine'] == 'docx-core')

    def test_decode_failure_preserves_valid_latency_without_zero_recall(self):
        with tempfile.TemporaryDirectory() as directory:
            row = self.execute(directory, native_failure=True)
        self.assertEqual(row['status'], 'ok')
        self.assertEqual(row['median_total_ms'], 1.0)
        self.assertIn('accuracy_error', row)
        self.assertNotIn('word', row)

    def test_parser_failure_receives_zero_word_recall(self):
        with tempfile.TemporaryDirectory() as directory:
            row = self.execute(directory, parser_failure=True)
        self.assertEqual(row['status'], 'process_error')
        self.assertEqual(row['word']['body']['recall'], 0)
        self.assertNotIn('median_total_ms', row)


if __name__ == '__main__':
    unittest.main()
