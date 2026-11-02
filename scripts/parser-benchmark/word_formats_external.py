import argparse
import collections
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import zipfile

from corpus import oracle
from word_formats import MIMES, save, sha


def inventory(out):
    sys.path.insert(0, str(out / 'python-deps'))
    import olefile
    entries, excluded = {}, []
    for path in sorted((out / 'downloads').rglob('*')):
        if path.suffix.lower().lstrip('.') not in MIMES:
            continue
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest in entries:
            entries[digest]['aliases'].append(str(path))
            continue
        ext, eligibility, reason, macros = None, True, None, False
        metadata = {}
        try:
            if data.startswith(bytes.fromhex('d0cf11e0a1b11ae1')):
                with olefile.OleFileIO(path) as compound:
                    if not compound.exists('WordDocument'):
                        raise ValueError('Compound file without a WordDocument stream')
                    fib = compound.openstream('WordDocument').read(32)
                    identity = int.from_bytes(fib[:2], 'little')
                    version = int.from_bytes(fib[2:4], 'little')
                    flags = int.from_bytes(fib[10:12], 'little')
                    ext = 'dot' if flags & 1 else 'doc'
                    metadata = {'n_fib': version, 'w_ident': identity, 'encrypted': bool(flags & 256)}
                    if identity not in (0xA5EC, 0xA5DC, 0xA699):
                        ext = path.suffix.lower().lstrip('.') if path.suffix.lower() in ('.doc', '.dot') else 'doc'
                        metadata['classification_warning'] = 'Invalid FIB identity; original extension retained, template bit not trusted'
                    if flags & 256:
                        eligibility, reason = False, 'encrypted_binary'
                    elif version < 193:
                        eligibility, reason = False, 'pre_word_97'
                    macros = any('VBA' in part.upper() or 'MACROS' in part.upper()
                                 for stream in compound.listdir() for part in stream)
            elif data.startswith(b'PK'):
                with zipfile.ZipFile(path) as archive:
                    types = archive.read('[Content_Types].xml')
                    if b'macroEnabledTemplate.main+xml' in types:
                        ext = 'dotm'
                    elif b'word.document.macroEnabled.main+xml' in types:
                        ext = 'docm'
                    elif b'wordprocessingml.template.main+xml' in types:
                        ext = 'dotx'
                    elif b'wordprocessingml.document.main+xml' in types:
                        ext = 'docx'
                    else:
                        raise ValueError('No recognized Word main content type')
                    macros = any(name.lower().endswith('vbaproject.bin') for name in archive.namelist())
            else:
                raise ValueError('Not a recognized Word container')
        except Exception as exc:
            excluded.append({'id': digest, 'path': str(path), 'reason': str(exc)})
            continue
        entry = {'id': digest, 'path': str(path), 'bytes': len(data), 'extension': ext,
                 'format': 'doc' if ext in ('doc', 'dot') else 'docx',
                 'source_extension': path.suffix.lower(), 'aliases': [str(path)],
                 'cohort': 'external_existing_input', 'source_group': path.parent.name,
                 'scope_eligible': eligibility, 'scope_reason': reason, 'contains_vba': macros,
                 **metadata}
        entry['reference_path'] = str(out / 'references' / (digest + '.docx')) if entry['format'] == 'doc' else str(path)
        entries[digest] = entry
    manifest = {'entries': list(entries.values()), 'excluded': excluded, 'mimetypes': MIMES,
                'selection': 'New external inputs only: 53 Embrace records, seeded public Apache POI and LibreOffice regression samples, Apache Tika fixtures, and publicly linked templates. Content-hash deduplicated and classified using independent OLE inspection or OOXML content types. No generated format variants.',
                'external': True}
    save(out / 'format-manifest.json', manifest)
    print('Formats', dict(collections.Counter(e['extension'] for e in entries.values())), flush=True)
    print('Outside declared scope', dict(collections.Counter(e['scope_reason'] for e in entries.values() if not e['scope_eligible'])), flush=True)
    print('Excluded', len(excluded), 'VBA-bearing', sum(e['contains_vba'] for e in entries.values()), flush=True)


def references(out):
    entries = json.loads((out / 'format-manifest.json').read_text())['entries']
    needed = [e for e in entries if e['format'] == 'doc' and not e.get('encrypted')
              and not Path(e['reference_path']).exists()]
    directory = out / 'references'
    inputs = directory / 'inputs'
    inputs.mkdir(parents=True, exist_ok=True)
    for entry in needed:
        path = inputs / (entry['id'] + '.' + entry['extension'])
        if not path.exists():
            path.symlink_to(entry['path'])

    def convert(batch):
        name = batch[0]['id'][:16]
        profile = directory / 'profiles' / name
        user = profile / 'user'
        user.mkdir(parents=True, exist_ok=True)
        (user / 'registrymodifications.xcu').write_text(
            '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry">'
            '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
            '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>'
            '</item></oor:items>')
        command = ['soffice', '-env:UserInstallation=' + profile.as_uri(), '--headless', '--norestore',
                   '--convert-to', 'docx:Office Open XML Text', '--outdir', str(directory),
                   *[str(inputs / (e['id'] + '.' + e['extension'])) for e in batch]]
        start = time.time()
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, start_new_session=True)
        status = 'complete'
        try:
            stdout, stderr = process.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            stdout, stderr = process.communicate()
            status = 'timeout'
        record = {'ids': [e['id'] for e in batch], 'status': status, 'returncode': process.returncode,
                  'seconds': time.time() - start, 'stdout': stdout, 'stderr': stderr,
                  'converted': [e['id'] for e in batch if Path(e['reference_path']).exists()]}
        save(directory / 'receipts' / (name + '.json'), record)
        print('References', len(record['converted']), '/', len(batch), status, flush=True)
        return record

    batches = [needed[i:i + 8] for i in range(0, len(needed), 8)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(convert, batches))


def oracles(out):
    manifest = json.loads((out / 'format-manifest.json').read_text())
    for index, entry in enumerate(manifest['entries']):
        try:
            truth = oracle(Path(entry['reference_path']))
            truth['reference'] = 'libreoffice_conversion_proxy' if entry['format'] == 'doc' else 'source_ooxml'
            truth['reference_sha256'] = sha(entry['reference_path'])
            entry['paragraphs'] = len(truth['paragraphs'])
            entry['feature_occurrences'] = sum(len(v) for v in truth['features'].values())
            entry['reference_available'] = True
        except Exception as exc:
            truth = {'error': str(exc)}
            entry['reference_available'] = False
        save(out / 'format-oracle' / (entry['id'] + '.json'), truth)
        if (index + 1) % 40 == 0:
            print('Oracles', index + 1, '/', len(manifest['entries']), flush=True)
    save(out / 'format-manifest.json', manifest)
    print('References available', sum(e['reference_available'] for e in manifest['entries']), '/', len(manifest['entries']), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['inventory', 'references', 'oracles'])
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    globals()[args.phase](args.out.resolve())
