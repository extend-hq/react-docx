import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from word_structured import capture, check_capture_state, save, sha


class WordCaptureTests(unittest.TestCase):
    def assert_capture_stops(self, result=None, error=None, expected='blocked'):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            entries = []
            for index in range(2):
                source = out / str(index)
                source.write_bytes(bytes([index]))
                entries.append({'id': sha(source), 'path': str(source)})
            save(out / 'manifest.json', {'entries': entries})
            save(out / 'capture-environment.json', {
                'exporter_sha256': {}, 'policy': {'resolved_formatting_budget_seconds': 3}})
            with patch('word_structured.exporter_identity', return_value={}), \
                 patch('word_structured.shutil.disk_usage', return_value=SimpleNamespace(free=2**40)), \
                 patch('word_structured.subprocess.run', return_value=result, side_effect=error) as invoked:
                with self.assertRaises(RuntimeError):
                    capture(out, None)
            self.assertEqual(invoked.call_count, 1)
            self.assertFalse((out / 'capture-summary.json').exists())
            status = json.loads((out / 'status.json').read_text())
            self.assertEqual(status['stage'], 'capture_blocked')
            receipt = json.loads((out / 'references' / (entries[0]['id'] + '.receipt.json')).read_text())
            self.assertEqual(receipt['status'], expected)
            self.assertFalse((out / 'references' / (entries[1]['id'] + '.receipt.json')).exists())

    def test_process_timeout_stops_before_next_input(self):
        self.assert_capture_stops(error=subprocess.TimeoutExpired('capture', 1), expected='timeout')

    def test_script_failure_stops_before_next_input(self):
        self.assert_capture_stops(subprocess.CompletedProcess([], 1, '', 'scripting failed'))

    def test_incomplete_output_stops_before_next_input(self):
        self.assert_capture_stops(subprocess.CompletedProcess([], 0, '{', ''))

    def test_non_object_output_stops_before_next_input(self):
        self.assert_capture_stops(subprocess.CompletedProcess([], 0, 'null', ''))

    def test_word_timeout_stops_before_next_input(self):
        native = {'status': 'error', 'error_stage': 'body', 'error_code': -1712}
        self.assert_capture_stops(subprocess.CompletedProcess([], 0, json.dumps(native), ''))

    def test_cleanup_failure_stops_before_next_input(self):
        native = {'status': 'ok', 'unavailable': {'close': -1}}
        self.assert_capture_stops(subprocess.CompletedProcess([], 0, json.dumps(native), ''))

    def test_optional_feature_scripting_timeout_stops_before_next_input(self):
        native = {'status': 'ok', 'unavailable': {'resolved_formatting': [-1712, ': ', 'timeout']}}
        self.assert_capture_stops(subprocess.CompletedProcess([], 0, json.dumps(native), ''))

    def test_formatting_budget_can_leave_only_formatting_unscored(self):
        check_capture_state({'status': 'ok', 'unavailable': {
            'resolved_formatting': [-2700, ': ', 'Resolved formatting time budget exceeded']}})


if __name__ == '__main__':
    unittest.main()
