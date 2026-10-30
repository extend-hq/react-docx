import argparse
import json
from pathlib import Path
import zipfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=Path('output/parser-frontier'))
    parser.add_argument('--manifest', type=Path, default=Path('output/parser-benchmark/manifest.json'))
    parser.add_argument('--oracle', type=Path, default=Path('output/parser-benchmark/oracle'))
    args = parser.parse_args()
    rows = {}
    for entry in json.loads(args.manifest.read_text())['entries']:
        if entry['format'] != 'docx':
            continue
        source = json.loads((args.oracle / (entry['id'] + '.json')).read_text())
        with zipfile.ZipFile(entry['path']) as package:
            xml_bytes = sum(item.file_size for item in package.infolist()
                            if item.filename.lower().endswith(('.xml', '.rels')))
        paragraphs = source.get('paragraphs', [])
        features = source.get('features', {})
        rows[entry['id']] = {
            'input_bytes': entry['bytes'], 'xml_bytes': xml_bytes,
            'paragraphs': len(paragraphs),
            'reference_characters': sum(len(value.get('text', '')) for value in paragraphs),
            'table_cells': len(features.get('table_cells', [])),
            'images': len(features.get('images', [])),
        }
    result = {
        'scope': 'Input bytes from corpus manifest; XML/.rels uncompressed byte sizes from ZIP directory; reference paragraph/text/image/table-cell counts from unchanged source OOXML oracle, across stories. No extracted document text or filenames included.',
        'rows': rows,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'chart-metrics.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({'documents': len(rows)}))


if __name__ == '__main__':
    main()
