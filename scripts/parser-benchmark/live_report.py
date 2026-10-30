import argparse
import collections
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import time
import zipfile

from assess import percentile
from expanded_benchmark import ENGINES, sha256, write_json
from expanded_report import LABELS, body_mean, features, latency, legacy_update, semantic_receipt, fidelity_findings
from frontier_report import CHART_METRICS


class Reader:
    def __init__(self):
        self.values = {}

    def read(self, path, default=None):
        try:
            stat = path.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
            previous = self.values.get(path)
            if previous and previous[0] == stamp:
                return previous[1]
            value = json.loads(path.read_text())
            self.values[path] = (stamp, value)
            return value
        except (OSError, ValueError):
            return default


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def process_commands():
    try:
        return subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True, timeout=5).splitlines()
    except (OSError, subprocess.SubprocessError):
        return []


class Publisher:
    def __init__(self, run, site):
        self.run = run.resolve()
        self.site = site.resolve()
        self.expanded = self.run / 'expanded'
        self.reader = Reader()
        self.manifest_path = self.run / 'corpus-1k' / 'manifest.json'
        self.manifest = self.reader.read(self.manifest_path)
        if not self.manifest:
            raise ValueError('Corpus manifest is unavailable')
        self.entries = {entry['id']: entry for entry in self.manifest['entries']}
        self.ids = set(self.entries)
        self.ordinals = {key: ordinal for ordinal, key in enumerate(sorted(self.ids), 1)}
        self.binary_hash = sha256(self.run / 'final-parser-benchmark')
        self.baseline_hash = sha256(self.run / 'baseline-parser-benchmark')
        self.manifest_hash = sha256(self.manifest_path)
        self.dimensions = {}
        self.persisted_snapshot = None
        self.last_optional_stamp = None
        self.optional = {'legacy_update': None, 'semantic_audits': [], 'fidelity_changes': []}
        self.site.mkdir(parents=True, exist_ok=True)
        for name in ['report.html', 'report-data.json']:
            source, backup = self.site / name, self.site / ('saved-' + name)
            if source.exists() and not backup.exists():
                shutil.copy2(source, backup)
        link = self.site / 'current'
        if not link.exists() and not link.is_symlink():
            link.symlink_to(self.run, target_is_directory=True)
        elif not link.is_symlink() or link.resolve() != self.run:
            raise ValueError('Live evidence link belongs to another location')
        self.previous = self.reader.read(self.site / 'saved-report-data.json', {})

    def records(self, phase, environment):
        rows = []
        ignored = 0
        if not environment or environment.get('binary_sha256') != self.binary_hash or environment.get('manifest_sha256') != self.manifest_hash:
            return rows, ignored
        engines = ENGINES + (['docx-core-baseline'] if phase == 'timing' else [])
        for engine in engines:
            for path in (self.expanded / phase / engine).glob('*.json'):
                row = self.reader.read(path)
                if not row:
                    continue
                identity = row.get('cache_identity', {})
                expected_hash = self.baseline_hash if engine == 'docx-core-baseline' else self.binary_hash
                if (row.get('id') not in self.ids or row.get('engine') != engine
                        or identity.get('input_sha256') != row['id']
                        or identity.get('binary_sha256') != expected_hash
                        or identity.get('scorer_sha256') != environment.get('scorer_sha256')
                        or identity.get('phase') != phase
                        or (phase == 'timing' and identity.get('repeats') != environment.get('repeats'))):
                    ignored += 1
                    continue
                rows.append(row)
        return rows, ignored

    def dimension(self, key):
        if key not in self.dimensions:
            entry = self.entries[key]
            truth = self.reader.read(self.run / 'corpus-1k' / 'oracle' / (key + '.json'), {})
            if not truth or 'error' in truth:
                self.dimensions[key] = None
            else:
                with zipfile.ZipFile(entry['path']) as package:
                    xml_bytes = sum(item.file_size for item in package.infolist() if item.filename.lower().endswith(('.xml', '.rels')))
                paragraphs = truth.get('paragraphs', [])
                self.dimensions[key] = {'input_bytes': entry['bytes'], 'xml_bytes': xml_bytes,
                                        'paragraphs': len(paragraphs), 'reference_characters': sum(len(p.get('text', '')) for p in paragraphs),
                                        'table_cells': len(truth.get('features', {}).get('table_cells', [])),
                                        'images': len(truth.get('features', {}).get('images', []))}
        return self.dimensions[key]

    def optional_results(self, scorer):
        paths = [self.run / 'legacy' / 'accuracy-rows.json', self.expanded / 'semantic-audit.json',
                 self.run / 'legacy' / 'semantic-audit.json', self.run / 'symbol-findings.md',
                 self.run / 'table-findings.md', self.run / 'feature-audit-findings.md', self.run / 'word-rea.md']
        stamp = tuple((p.stat().st_mtime_ns, p.stat().st_size) if p.exists() else None for p in paths)
        if stamp == self.last_optional_stamp:
            return self.optional
        value = {'legacy_update': None, 'semantic_audits': [], 'fidelity_changes': []}
        if scorer and self.previous:
            cohort = self.site.parent / 'parser-rewrite' / 'comparison-full' / 'rows.json'
            try:
                update = legacy_update(paths[0], self.previous, cohort, self.binary_hash, scorer)
                if update:
                    update['url'] = 'current/legacy/accuracy-rows.json'
                    update.pop('receipt_path', None)
                    value['legacy_update'] = update
            except (ValueError, OSError, KeyError):
                pass
        for path, label, baseline in [(paths[1], 'Expanded sample', None),
                                       (paths[2], 'Original local corpus', self.run / 'semantic-audit-baseline.json')]:
            try:
                audit = semantic_receipt(path, self.binary_hash, label, baseline)
                if audit:
                    audit['receipt_url'] = 'current/' + str(path.relative_to(self.run))
                    audit.pop('receipt_path', None)
                    value['semantic_audits'].append(audit)
            except (ValueError, OSError, KeyError):
                pass
        value['fidelity_changes'] = fidelity_findings(self.run, self.site)
        for finding in value['fidelity_changes']:
            finding['evidence_url'] = 'current/' + Path(finding['evidence_url']).name
        self.last_optional_stamp = stamp
        self.optional = value
        return value

    def progress(self, timings, scores):
        commands = process_commands()
        run_text = str(self.run)
        pipeline_marker = 'output/' + self.run.name + '/run_final.py'
        pipeline_running = any(any(token == pipeline_marker or token.endswith('/' + pipeline_marker)
                                   for token in command.split()) for command in commands)
        run_marker = 'output/' + self.run.name
        def belongs(command):
            return any(token == run_text or token.startswith(run_text + '/')
                       or token == run_marker or token.startswith(run_marker + '/')
                       for token in command.split())
        accuracy_running = any('expanded_benchmark.py' in command and belongs(command) and '--phase accuracy' in command for command in commands)
        timing_running = any('expanded_benchmark.py' in command and belongs(command) and '--phase timing' in command for command in commands)
        semantic_running = any('semantic_audit.py' in command and belongs(command) for command in commands)
        steps = self.reader.read(self.run / 'run-steps.json', []) or []
        completed_steps = {value['step']: value for value in steps}
        audited = {value['label']: value for value in self.optional.get('semantic_audits', [])}
        semantic_expanded = audited.get('Expanded sample', {})
        semantic_legacy = audited.get('Original local corpus', {})
        legacy_count = sum(1 for p in (self.run / 'legacy' / 'accuracy' / 'docx-core').glob('*.json')
                           if (self.reader.read(p, {}) or {}).get('cache_identity', {}).get('binary_sha256') == self.binary_hash)
        stages = [{'key': 'corpus', 'label': 'Sample downloaded and reference extracted', 'completed': len(self.ids), 'total': len(self.ids)},
                  {'key': 'expanded-accuracy', 'label': 'Expanded extraction accuracy', 'completed': len(scores), 'total': len(self.ids) * len(ENGINES)},
                  {'key': 'legacy-accuracy', 'label': 'Original corpus accuracy', 'completed': legacy_count, 'total': 392},
                  {'key': 'expanded-semantic', 'label': 'Expanded semantic audit', 'completed': semantic_expanded.get('attempted', 0), 'total': len(self.ids)},
                  {'key': 'legacy-semantic', 'label': 'Original semantic audit', 'completed': semantic_legacy.get('attempted', 0), 'total': 390},
                  {'key': 'expanded-timing', 'label': 'Native latency comparison', 'completed': len(timings), 'total': len(self.ids) * (len(ENGINES) + 1)}]
        for stage in stages:
            stage['status'] = 'complete' if stage['completed'] >= stage['total'] else 'pending'
            if stage['key'] in completed_steps and completed_steps[stage['key']].get('exit_code'):
                stage['status'] = 'failed'
        active = next((stage for stage in stages if stage['status'] == 'failed'), None)
        if not active:
            if timing_running:
                active = stages[-1]
            elif accuracy_running or pipeline_running or semantic_running:
                active = next((stage for stage in stages[1:5] if stage['status'] != 'complete'), stages[-1])
        failed = bool(active and active['status'] == 'failed')
        complete = all(stage['status'] == 'complete' for stage in stages)
        running = pipeline_running or accuracy_running or timing_running or semantic_running
        status = 'failed' if failed else 'complete' if complete else 'running' if running else 'waiting'
        if active and status == 'running':
            active['status'] = 'running'
        selected = active or next((stage for stage in stages if stage['status'] != 'complete'), stages[-1])
        workflow = (self.reader.read(self.run / 'feature-backlog.json', {}) or {}).get('workflow', {})
        work_note = workflow.get('note', '') if workflow.get('measured_binary_sha256') == self.binary_hash else ''
        pending = self.pending_evaluation_note(workflow)
        result = {'stage': selected['label'], 'completed': selected['completed'], 'total': selected['total'],
                'status': status, 'updated_at': timestamp(), 'stages': stages,
                'note': (('The complete measured corpus is available. ' if complete else 'Results remain partial until all selected inputs finish. ') + 'Latency and accuracy are labeled by their measured build and cohort. ' + work_note + ' ' + (pending['note'] if pending else '')).strip()}
        if pending:
            result.update({key: pending[key] for key in ['stage', 'completed', 'total', 'status']})
            result['stages'] = []
        return result

    def pending_evaluation_note(self, workflow):
        pending = workflow.get('pending_evaluation', {})
        if not isinstance(pending, dict) or not isinstance(pending.get('directory'), str):
            return ''
        directory = (self.run / pending['directory']).resolve()
        if not directory.is_relative_to(self.run):
            return ''
        receipt = self.reader.read(directory / 'run-steps.json', {}) or {}
        binary_hash = receipt.get('binary_sha256')
        if not binary_hash or binary_hash != pending.get('binary_sha256'):
            return ''
        steps = receipt.get('steps', [])
        if not steps:
            return ''
        step = steps[-1]
        name = step.get('step', '')
        labels = {'expanded-accuracy': 'new-corpus accuracy', 'legacy-accuracy': 'original-corpus accuracy',
                  'expanded-semantic': 'new-corpus semantic audit', 'legacy-semantic': 'original-corpus semantic audit',
                  'expanded-timing': 'full native latency comparison', 'full-parity': 'complete-output validation',
                  'native-tests': 'native regression checks', 'wasm-tests': 'WASM regression checks'}
        if name not in labels:
            return ''
        completed, total = 0, step.get('total', 0)
        try:
            with (directory / (name + '.log')).open('rb') as stream:
                stream.seek(max(0, stream.seek(0, 2) - 4096))
                lines = stream.read().decode('utf-8', errors='replace').splitlines()
            for line in reversed(lines):
                fields = line.split()
                if len(fields) >= 4 and fields[0] in {'ACCURACY', 'AUDITED', 'TIMING'} and fields[1].isdigit() and fields[2] == '/' and fields[3].isdigit():
                    completed, total = int(fields[1]), int(fields[3])
                    break
        except OSError:
            pass
        status = 'complete' if receipt.get('finished_at') else step.get('status', 'pending')
        if step.get('status') == 'complete':
            completed = total
        if status == 'running' and isinstance(receipt.get('pid'), int):
            try:
                os.kill(receipt['pid'], 0)
            except ProcessLookupError:
                status = 'interrupted'
            except PermissionError:
                pass
        return {'stage': f'Candidate {binary_hash[:12]}: {labels[name]}',
                'completed': completed, 'total': total, 'status': status,
                'note': 'Candidate validation is separate from the published charts.'}

    def latency_comparison(self, summaries, points, common, baseline, timing_env, timings):
        completed_pairs = {(row['id'], row['engine']) for row in timings}
        complete = (len(timings) == len(self.ids) * 5 and bool(timing_env.get('finished_at'))
                    and all((key, engine) in completed_pairs
                            for key in self.ids for engine in ENGINES + ['docx-core-baseline']))
        current = {'engines': {engine: {key: value for key, value in summaries[engine].items()
                                      if key not in ['features', 'features_all', 'body_f1', 'body_f1_all',
                                                     'body_all_scored', 'accuracy_statuses', 'scored_attempted']}
                               for engine in ENGINES},
                   'fixed_common': len(common), 'points': points, 'metric_definitions': CHART_METRICS,
                   'baseline': baseline,
                   'scope': {'source': 'current_completed' if complete else 'current_partial',
                             'binary_sha256': self.binary_hash, 'manifest_sha256': self.manifest_hash,
                             'scorer_sha256': timing_env.get('scorer_sha256'),
                             'completed_at': timing_env.get('finished_at'), 'attempted': len(self.ids),
                             'common_success': len(common), 'repeats': timing_env.get('repeats', 5),
                             'label': 'Expanded sample: completed measurement' if complete else 'Expanded sample: provisional timing subset'}}
        snapshot_path = self.run / 'measured-latency.json'
        if complete and common:
            signature = (self.binary_hash, self.manifest_hash, timing_env.get('scorer_sha256'), timing_env.get('finished_at'))
            if self.persisted_snapshot != signature:
                result = {'version': 1, 'comparison': current,
                          'candidate_binary_sha256': self.binary_hash,
                          'baseline_binary_sha256': self.baseline_hash,
                          'manifest_sha256': self.manifest_hash,
                          'scorer_sha256': timing_env.get('scorer_sha256'),
                          'cohort_sha256': hashlib.sha256('\n'.join(sorted(common)).encode()).hexdigest(),
                          'timing_records': len(timings),
                          'timing_rows_sha256': hashlib.sha256(json.dumps(sorted(timings, key=lambda row: (row['id'], row['engine'])),
                                                                        sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                          'completed_at': timing_env['finished_at']}
                result['snapshot_sha256'] = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                write_json(snapshot_path, result)
                archive = self.run / 'latency-snapshots' / (self.binary_hash + '.json')
                if not archive.exists():
                    write_json(archive, result)
                self.persisted_snapshot = signature
            return current
        saved = self.reader.read(snapshot_path)
        if saved:
            expected = saved.get('snapshot_sha256')
            payload = {key: value for key, value in saved.items() if key != 'snapshot_sha256'}
            actual = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            if expected == actual and saved.get('manifest_sha256') == self.manifest_hash:
                retained = dict(saved['comparison'])
                retained['scope'] = {**retained['scope'], 'source': 'previous_completed',
                                     'label': 'Last completed expanded-sample measurement; current build timing pending'}
                return retained
        if common:
            return current
        previous = self.previous
        if previous.get('comparison') and previous.get('charts', {}).get('points'):
            values = {}
            for engine in ENGINES:
                old = previous['comparison']['engines'][engine]
                values[engine] = {'median_ms': old['median_ms'], 'p95_ms': old['p95_ms'],
                                  'all_median_ms': None, 'all_p95_ms': None,
                                  'statuses': old.get('statuses_all_docx', {}),
                                  'success': old.get('statuses_all_docx', {}).get('ok', 0),
                                  'attempted': previous['comparison']['docx_attempted'],
                                  'timed_attempted': previous['comparison']['docx_attempted']}
            return {'engines': values, 'fixed_common': previous['comparison']['fixed_common'],
                    'points': previous['charts']['points'], 'metric_definitions': previous['charts']['metric_definitions'],
                    'baseline': None, 'scope': {'source': 'legacy_completed',
                    'binary_sha256': previous['candidate_binary_sha256'], 'manifest_sha256': None,
                    'completed_at': previous['generated_at'], 'attempted': previous['comparison']['docx_attempted'],
                    'common_success': previous['comparison']['fixed_common'],
                    'repeats': previous['comparison']['repeats'],
                    'label': 'Previous local-corpus measurement; distinct build and corpus'}}
        return current

    def feature_backlog(self):
        source = self.reader.read(self.run / 'feature-backlog.json', {}) or {}
        result = {key: source[key] for key in ['target', 'policy', 'sample_documents', 'binary_sha256', 'wave1_binary', 'latest_completed_measurement', 'workflow'] if key in source}
        result['ranked_features'] = []
        for row in source.get('ranked_features', []):
            if (isinstance(row, dict) and isinstance(row.get('feature'), str)
                    and all(isinstance(row.get(key), (int, float)) and math.isfinite(row[key]) for key in ['matched', 'expected', 'recall'])):
                result['ranked_features'].append({key: row[key] for key in ['feature', 'matched', 'expected', 'recall']})
        result['ranked_features'].sort(key=lambda row: (row['recall'], row['feature']))
        for key in ['active_work', 'remaining_accuracy_limits']:
            result[key] = [value for value in source.get(key, []) if isinstance(value, str)]
        return result

    def image_payload_audit(self):
        audit = self.reader.read(self.run / 'image-payload-audit/summary.json', {}) or {}
        records = audit.get('records', [])
        if (audit.get('status') != 'complete' or audit.get('manifest_sha256') != self.manifest_hash
                or {row.get('id') for row in records} != self.ids
                or any(row.get('errors') for row in records)):
            return None
        equivalence_url = None
        if audit.get('binary_sha256') != self.binary_hash:
            for path in sorted(self.run.glob('*-evaluation/full-output.json')):
                proof = self.reader.read(path, {}) or {}
                if (proof.get('status') == 'passed' and proof.get('native_binary_sha256') == self.binary_hash
                        and proof.get('baseline_native_sha256') == audit.get('binary_sha256')
                        and self.ids <= {row.get('id') for row in proof.get('records', []) if row.get('equal')}):
                    equivalence_url = 'current/' + str(path.relative_to(self.run))
                    break
            if not equivalence_url:
                return None
        totals = {key: sum(row.get(key, 0) for row in records)
                  for key in ['expected', 'matched', 'composites', 'unresolved_source_relationships']}
        return {**totals, 'documents': len(records), 'audited_binary_sha256': audit['binary_sha256'],
                'current_binary_sha256': self.binary_hash, 'equivalence_url': equivalence_url,
                'scope': audit.get('scope', ''), 'receipt_url': 'current/image-payload-audit/summary.json'}

    def feedback_loop(self):
        value = self.reader.read(self.run / 'feedback-loop/latest.json', {}) or {}
        if not value:
            return None
        result = {key: value[key] for key in ['label', 'status', 'scope', 'rounds', 'count', 'build_seconds', 'error', 'decision'] if key in value}
        result['records'] = [{key: row[key] for key in ['ordinal', 'status', 'medians', 'speedup', 'candidate_to_oxide', 'full_output_parity', 'seconds', 'verdict', 'process_cpu_speedup', 'process_cpu_per_parse_ms', 'process_cpu_scope'] if key in row}
                             for row in value.get('records', [])]
        result['receipt_url'] = 'current/feedback-loop/latest.json'
        result['history'] = []
        for path in sorted((self.run / 'feedback-loop').glob('*/results.json')):
            prior = self.reader.read(path, {}) or {}
            result['history'].append({'label': prior.get('label', path.parent.name), 'status': prior.get('status'),
                                      'decision': prior.get('decision', prior.get('error', 'Diagnostic run; no promotion')),
                                      'documents': sum(row.get('status') == 'passed' for row in prior.get('records', [])),
                                      'url': 'current/feedback-loop/' + path.parent.name + '/results.json'})
        return result

    def experimental_tuning(self):
        directory = self.run / 'new64'
        source = self.reader.read(directory / 'performance-summary.json', {}) or {}
        selection = self.reader.read(directory / 'selection-receipt.json', {}) or {}
        raw = self.reader.read(directory / 'controlled-tuning.json', {}) or {}
        repeats = raw.get('repeats')
        rows = raw.get('rows', [])
        if (source.get('inputs') != 64 or selection.get('selected_count') != 64
                or selection.get('pool_count') != len(self.ids)
                or selection.get('source_manifest_sha256') != self.manifest_hash
                or source.get('selection_receipt') != 'selection-receipt.json'
                or type(repeats) is not int or repeats <= 0 or len(rows) != 64
                or len({row.get('id') for row in rows} & self.ids) != 64):
            return None
        def numeric(value):
            return type(value) in (int, float) and math.isfinite(value)
        builds = []
        for key, label in [('baseline', 'Baseline'), ('candidate', 'Candidate')]:
            identity = source.get('binaries', {}).get(key, {})
            digest = identity.get('sha256', '')
            values = source.get(key + '_subset_latency_ms', {})
            if (not isinstance(digest, str) or len(digest) != 64
                    or any(character not in '0123456789abcdef' for character in digest)
                    or raw.get('binaries', {}).get(key, {}).get('sha256') != digest
                    or not all(numeric(values.get(metric)) and values[metric] > 0
                               for metric in ['median', 'p95_nearest_rank'])):
                return None
            builds.append({'key': key, 'label': label, 'binary_sha256': digest,
                           'median_ms': values['median'], 'p95_ms': values['p95_nearest_rank']})
        speedup = source.get('median_paired_speedup')
        faster = source.get('inputs_faster')
        if not numeric(speedup) or speedup <= 0 or type(faster) is not int or not 0 <= faster <= 64:
            return None
        return {'label': 'Experimental tuning subset', 'inputs': 64, 'pool_inputs': len(self.ids),
                'seed': selection.get('seed'), 'builds': builds, 'repeats': repeats,
                'median_paired_speedup': speedup, 'inputs_faster': faster,
                'manifest_sha256': selection.get('selected_manifest_sha256'),
                'receipt_url': 'current/new64/performance-summary.json',
                'selection_url': 'current/new64/selection-receipt.json',
                'raw_url': 'current/new64/controlled-tuning.json'}

    def experimental_memory(self):
        metrics = []
        index = self.reader.read(self.run / 'memory-layout' / 'compact-index-receipt.json', {}) or {}
        census = self.reader.read(self.run / 'memory-layout' / 'index-layout-audit.json', {}) or {}
        storage = index.get('storage', {})
        documents = census.get('documents', [])
        if (census.get('manifest_sha256') == self.manifest_hash
                and len(documents) == len(self.ids)
                and {row.get('id') for row in documents} == self.ids):
            before = storage.get('baseline_metadata_requested_bytes')
            after = storage.get('candidate_metadata_requested_bytes')
            if (type(before) is int and type(after) is int and before > 0 and after >= 0
                    and census.get('totals', {}).get('baseline', {}).get('metadata_requested_bytes') == before
                    and census.get('totals', {}).get('candidate', {}).get('metadata_requested_bytes') == after):
                metrics.append({'id': 'index_metadata', 'label': 'Requested index metadata', 'unit': 'bytes',
                                'experiment': 'Compact XML index', 'baseline_label': 'Prior index',
                                'candidate_label': 'Compact index', 'baseline': before, 'candidate': after,
                                'reduction_percent': 100 * (before - after) / before,
                                'documents': len(documents), 'inspected_parts': census.get('raw_parts'),
                                'indexed_parts': sum(row.get('accepted_parts', 0) for row in documents),
                                'rejected_parts': census.get('rejected_raw_parts'),
                                'scope': 'Sum of requested index metadata storage across separately built raw XML/rels indices. Excludes allocator overhead, source-name strings, HashMap heap storage and query-cache allocations; not total parser memory or process RSS.',
                                'receipt_url': 'current/memory-layout/compact-index-receipt.json',
                                'measurement_url': 'current/memory-layout/index-layout-audit.json',
                                'timing_url': 'current/memory-layout/performance-summary.json',
                                'identity': {'census_binary_sha256': census.get('binary_sha256'),
                                             'candidate_binary_sha256': index.get('binaries', {}).get('parser-benchmark', {}).get('sha256')}})
        allocation = self.reader.read(self.run / 'allocation-audit' / 'mark-allocation-comparison.json', {}) or {}
        receipt = self.reader.read(self.run / 'allocation-audit' / 'mark-allocation-receipt.json', {}) or {}
        cohort = allocation.get('cohorts', {}).get('new1k', {})
        run = next((value for value in receipt.get('runs', []) if value.get('label') == 'mark-new1k'), {})
        if (cohort.get('documents') == len(self.ids) and run.get('documents') == len(self.ids)
                and run.get('success') == len(self.ids) and run.get('manifest_sha256') == self.manifest_hash
                and run.get('rows_sha256') == cohort.get('candidate_rows_sha256')
                and cohort.get('input_hash_and_status_match') is True):
            for key, label, unit, scope in [
                ('allocations', 'Rust model allocation calls', 'calls',
                 'Allocation calls summed across the Rust model-construction phase for every input. Reallocations are counted separately and are unchanged. Native C allocations are excluded.'),
                ('peak_additional_live_bytes', 'Sum of per-document live peaks', 'bytes',
                 'Sum of each document’s peak additional live bytes during Rust model construction. These peaks occur in separate parses; this sum is not a simultaneous process peak or RSS. Native C allocations are excluded.')]:
                value = cohort.get('model', {}).get(key, {})
                before, after = value.get('baseline'), value.get('candidate')
                if type(before) is int and type(after) is int and before > 0 and after >= 0:
                    metrics.append({'id': key, 'label': label, 'unit': unit,
                                    'experiment': 'Paragraph-mark sharing', 'baseline_label': 'Prior marks',
                                    'candidate_label': 'Shared marks', 'baseline': before, 'candidate': after,
                                    'reduction_percent': 100 * (before - after) / before,
                                    'documents': cohort['documents'], 'scope': scope,
                                    'instrumentation_note': 'The instrumented census includes bounded additional counter-key allocations in the candidate. Instrumented elapsed times are not used as benchmark latency.',
                                    'receipt_url': 'current/allocation-audit/mark-allocation-receipt.json',
                                    'measurement_url': 'current/allocation-audit/mark-allocation-comparison.json',
                                    'timing_url': 'current/allocation-audit/mark-repeat-summary.json',
                                    'identity': {'candidate_binary_sha256': run.get('binary_sha256'),
                                                 'baseline_rows_sha256': cohort.get('baseline_rows_sha256'),
                                                 'candidate_rows_sha256': cohort.get('candidate_rows_sha256')}})
        return {'metrics': metrics, 'manifest_sha256': self.manifest_hash}

    def build(self):
        timing_env = self.reader.read(self.expanded / 'timing-environment.json', {}) or {}
        accuracy_env = self.reader.read(self.expanded / 'accuracy-environment.json', {}) or {}
        timings, ignored_timing = self.records('timing', timing_env)
        scores, ignored_accuracy = self.records('accuracy', accuracy_env)
        by_timing = {(row['id'], row['engine']): row for row in timings}
        by_score = {(row['id'], row['engine']): row for row in scores}
        common = {key for key in self.ids if all(latency([by_timing.get((key, engine), {})]) for engine in ENGINES)}
        scored_common = {key for key in self.ids if all(by_score.get((key, engine), {}).get('status') == 'ok' and 'body' in by_score[(key, engine)] for engine in ENGINES)}
        timing_complete = len(timings) >= len(self.ids) * 5
        quality_common = common & scored_common if timing_complete else scored_common
        summaries, quality = {}, {}
        for engine in ENGINES:
            all_times = [row for row in timings if row['engine'] == engine]
            all_scores = [row for row in scores if row['engine'] == engine]
            shared_times = [by_timing[(key, engine)] for key in common]
            shared_scores = [by_score[(key, engine)] for key in quality_common]
            summary = {'attempted': len(self.ids), 'timed_attempted': len(all_times), 'scored_attempted': len(all_scores),
                       'statuses': dict(collections.Counter(row['status'] for row in all_times)),
                       'accuracy_statuses': dict(collections.Counter(row['status'] for row in all_scores)),
                       'success': sum(row['status'] == 'ok' for row in all_times),
                       'median_ms': percentile(latency(shared_times), .5), 'p95_ms': percentile(latency(shared_times), .95),
                       'all_median_ms': percentile(latency(all_times), .5), 'all_p95_ms': percentile(latency(all_times), .95),
                       'body_f1': body_mean(shared_scores), 'body_f1_all': body_mean(all_scores),
                       'body_all_scored': sum('body' in row for row in all_scores),
                       'features': features(shared_scores), 'features_all': features(all_scores)}
            summaries[engine] = summary
            quality[engine] = {'body_f1': summary['body_f1'], 'features': summary['features']}
        baseline = None
        paired = [key for key in self.ids if latency([by_timing.get((key, 'docx-core'), {})]) and latency([by_timing.get((key, 'docx-core-baseline'), {})])]
        if paired:
            before = [by_timing[(key, 'docx-core-baseline')]['medians']['total_ms'] for key in paired]
            after = [by_timing[(key, 'docx-core')]['medians']['total_ms'] for key in paired]
            baseline_rows = [row for row in timings if row['engine'] == 'docx-core-baseline']
            baseline = {'documents': len(paired), 'attempted': len(baseline_rows),
                        'statuses': dict(collections.Counter(row['status'] for row in baseline_rows)),
                        'median_paired_speedup': statistics.median(a/b for a,b in zip(before, after)),
                        'faster_documents': sum(a>b for a,b in zip(before, after)),
                        'baseline_median_ms': percentile(before, .5), 'candidate_median_ms': percentile(after, .5),
                        'baseline_p95_ms': percentile(before, .95), 'candidate_p95_ms': percentile(after, .95)}
        labels = {'body_f1': LABELS['body_f1']}
        labels.update({key: LABELS.get(key, key.replace('_', ' ').capitalize())
                       for key in sorted({name for value in summaries.values() for name in value['features_all']})})
        old_score = self.previous.get('quality_comparison', {}).get('docx-core', {}).get('features', {}).get('horizontal_merges')
        legacy = {'horizontal_recall': old_score['recall'], 'documents': self.previous['comparison']['docx_attempted'],
                  'common': self.previous['comparison']['fixed_common'], 'matched': old_score['matched'],
                  'expected': old_score['expected'], 'url': 'saved-report.html'} if old_score else None
        env = (timing_env if timing_env.get('binary_sha256') == self.binary_hash else
               accuracy_env if accuracy_env.get('binary_sha256') == self.binary_hash else {})
        sampling = self.reader.read(self.run / 'corpus-1k' / 'sampling.json', {}) or {}
        corpus = {key: value for key, value in sampling.items() if isinstance(value, (str, int, float, bool, type(None)))}
        optional = self.optional_results(env.get('scorer_sha256'))
        live = self.progress(timings, scores)
        live['ignored_stale_records'] = ignored_timing + ignored_accuracy
        points = [{'ordinal': self.ordinals[key], 'metrics': self.dimension(key),
                   'latency_ms': {engine: by_timing[(key, engine)]['medians']['total_ms'] for engine in ENGINES}}
                  for key in sorted(common)]
        measured = self.latency_comparison(summaries, points, common, baseline, timing_env, timings)
        measured_hash = measured['scope'].get('binary_sha256')
        archived_timing = self.run / 'waves' / str(measured_hash) / 'expanded' / 'timing-rows.json'
        timing_receipt_url = ('current/waves/' + str(measured_hash) + '/expanded/timing-rows.json'
                              if archived_timing.exists() else 'current/expanded/timing-rows.json')
        validation = self.reader.read(self.run / 'completion-receipt.json', {}) or {}
        validation_current = (validation.get('binary_sha256') == self.binary_hash
                              and validation.get('status') == 'passed')
        return {'generated_at': timestamp(), 'scope': {'attempted': len(self.ids), 'common_success': len(common),
                'quality_common': len(quality_common), 'cohort_name': 'Seeded DOCX corpus sample',
                'repeats': env.get('repeats', 5), 'complete': len(timings) >= len(self.ids)*5 and len(scores) == len(self.ids)*4,
                'scatter_documents': len(common), 'dimension_errors': 0,
                'quality_timing_same_cohort': quality_common == common},
                'engines': ENGINES, 'summaries': summaries, 'quality_comparison': quality, 'quality_labels': labels,
                'baseline': baseline, 'charts': {'metric_definitions': CHART_METRICS, 'points': points},
                'latency_comparison': measured, 'latency_snapshot': dict(measured['scope']),
                'feature_backlog': self.feature_backlog(),
                'experimental_tuning': self.experimental_tuning(),
                'feedback_loop': self.feedback_loop(),
                'table_property_optimization': self.reader.read(self.run / 'table-property-optimization.json', None),
                'normalization_optimization': self.reader.read(self.run / 'normalization-optimization.json', None),
                'instruction_analysis': self.reader.read(self.run / 'instruction-analysis' / 'summary.json', None),
                'single_document_trace': self.reader.read(self.run / 'single-document-trace/summary.json', None),
                'image_payload_audit': self.image_payload_audit(),
                'experimental_memory': self.experimental_memory(),
                'provenance': {'binary_sha256': self.binary_hash, 'baseline_binary_sha256': self.baseline_hash,
                               'manifest_sha256': self.manifest_hash, 'scorer_sha256': env.get('scorer_sha256'),
                               'seed': env.get('seed', 20261029), 'versions': env.get('versions', {})},
                'corpus': corpus, 'legacy': legacy, 'live': live,
                'validation_note': (validation.get('summary') if validation_current else
                                    'Measurements are tied to the displayed build and cohort. Candidate validation is reported separately. Original feature-recall rules remain unchanged; extraction and semantic checks do not establish Word-identical rendering.'),
                'timing_environment_note': validation.get('timing_environment_note', '') if validation_current else '',
                'timing_scope': env.get('scope', ''), 'quality_scope': 'Reference-bearing completed scores only; failures retain expected feature denominators in the all-attempt view. No latency measurements are inferred from accuracy runs.',
                'receipt_links': {'chart': 'live-data.json', 'timing': timing_receipt_url,
                                  'accuracy': 'current/expanded/accuracy-rows.json', 'corpus': 'current/corpus-1k/sampling.json',
                                  'backlog': 'current/feature-backlog.json', 'latency_snapshot': 'current/measured-latency.json',
                                  **({'validation': 'current/completion-receipt.json'} if validation_current else {}),
                                  **({'research': 'current/rust-optimization-research.md'}
                                     if (self.run / 'rust-optimization-research.md').is_file() else {})},
                **optional}

    def publish(self, rewrite_html=False):
        data = self.build()
        write_json(self.site / 'live-data.json', data)
        if rewrite_html or not (self.site / 'report.html').exists():
            template = Path(__file__).with_name('expanded_report.html').read_text()
            payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
            temporary = self.site / 'report.html.tmp'
            temporary.write_text(template.replace('REPORT_DATA', payload))
            temporary.replace(self.site / 'report.html')
        write_json(self.site / 'publisher-status.json', {'pid': os.getpid(), 'updated_at': timestamp(), 'status': 'running', 'stage': data['live']['stage']})
        return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', type=Path, default=Path('output/parser-next'))
    parser.add_argument('--site', type=Path, default=Path('output/parser-frontier'))
    parser.add_argument('--interval', type=float, default=5)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    publisher = Publisher(args.run, args.site)
    first = True
    try:
        while True:
            data = publisher.publish(rewrite_html=first)
            print(json.dumps({'updated_at': data['live']['updated_at'], 'status': data['live']['status'],
                              'stage': data['live']['stage'], 'completed': data['live']['completed'],
                              'total': data['live']['total']}), flush=True)
            first = False
            if args.once:
                break
            time.sleep(max(1, args.interval))
    except KeyboardInterrupt:
        pass
    finally:
        write_json(publisher.site / 'publisher-status.json', {'pid': os.getpid(), 'updated_at': timestamp(), 'status': 'stopped'})


if __name__ == '__main__':
    main()
