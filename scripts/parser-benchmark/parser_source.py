import hashlib
import json
from pathlib import Path
import subprocess
import tomllib


BENCHMARK = Path(__file__).resolve().parent


def parser_version():
    with (BENCHMARK / 'Cargo.lock').open('rb') as lock:
        packages = tomllib.load(lock)['package']
    return next(package['version'] for package in packages if package['name'] == 'extend-docx')


def source_identity(harness=BENCHMARK):
    metadata = json.loads(subprocess.check_output(
        ['cargo', 'metadata', '--format-version', '1', '--locked',
         '--manifest-path', str(harness / 'Cargo.toml')]
    ))
    names = {'extend-docx', 'extend-office-charts', harness.name}
    hashes = {}
    for package in metadata['packages']:
        if package['name'] not in names:
            continue
        root = Path(package['manifest_path']).parent
        files = [root / 'Cargo.toml', *(root / 'src').rglob('*.rs')]
        if root == harness:
            files.append(root / 'Cargo.lock')
        for path in files:
            key = f"{package['name']}@{package['version']}/{path.relative_to(root)}"
            hashes[key] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes
