import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile


def source_xml_values(value, path=()):
    result = {}
    if isinstance(value, dict):
        for key, item in value.items():
            if key.endswith('Xml') or key.endswith('OpenTag'):
                result['/'.join(map(str, (*path, key)))] = item
            else:
                result.update(source_xml_values(item, (*path, key)))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            result.update(source_xml_values(item, (*path, index)))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    cases = [
        ('ampersand', 'https://example.invalid/?a=1&amp;b=2', 'External', 'https://example.invalid/?a=1&b=2'),
        ('decimal', 'https://example.invalid/?a=1&#38;b=2', 'External', 'https://example.invalid/?a=1&b=2'),
        ('hexadecimal', 'https://example.invalid/?a=1&#x26;b=2', 'External', 'https://example.invalid/?a=1&b=2'),
        ('one_layer', 'https://example.invalid/?a=1&amp;amp;b=2', 'External', 'https://example.invalid/?a=1&amp;b=2'),
        ('numeric_literal', 'https://example.invalid/?a=&amp;#38;', 'External', 'https://example.invalid/?a=&#38;'),
        ('percent_escape', 'https://example.invalid/?a=%26', 'External', 'https://example.invalid/?a=%26'),
        ('quotes', 'https://example.invalid/?a=&quot;x&quot;&amp;b=&apos;y&apos;', 'External', 'https://example.invalid/?a="x"&b=\'y\''),
        ('external_relative', 'linked.docx', 'External', 'linked.docx'),
        ('external_parent', '../linked.docx', 'External', '../linked.docx'),
        ('external_root', '/linked.docx', 'External', '/linked.docx'),
        ('internal_relative', 'linked.xml', 'Internal', 'word/linked.xml'),
        ('internal_escaped', 'linked&amp;part.xml', 'Internal', 'word/linked&part.xml'),
    ]
    rows = []
    for name, target, mode, expected in cases:
        document = args.out / (name + '.docx')
        with zipfile.ZipFile(document, 'w', compression=zipfile.ZIP_DEFLATED) as package:
            package.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
            package.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
            package.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="r2"><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p></w:body></w:document>')
            package.writestr('word/_rels/document.xml.rels', f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{target}" TargetMode="{mode}"/></Relationships>')
        row = {'case': name, 'expected': expected, 'input_sha256': hashlib.sha256(document.read_bytes()).hexdigest()}
        models = {}
        for label, binary in [('baseline', args.baseline), ('candidate', args.candidate)]:
            prefix = args.out / (name + '.' + label)
            process = subprocess.run([str(binary.resolve()), 'docx-core', str(document), 'docx', str(prefix), '0'],
                                     capture_output=True, text=True, timeout=30, check=True)
            status = json.loads(process.stdout)
            if status['status'] != 'ok':
                row[label] = {'status': status['status']}
                continue
            model = json.load(gzip.open(str(prefix) + '.json.gz'))
            models[label] = model
            actual = model['nodes'][0]['children'][0].get('link')
            row[label] = {'status': 'ok', 'actual': actual, 'matched': actual == expected}
        if set(models) == {'baseline', 'candidate'}:
            before = source_xml_values(models['baseline'])
            after = source_xml_values(models['candidate'])
            row['source_xml_preserved'] = before == after
            row['source_xml_fields'] = len(before)
        rows.append(row)
    result = {'binary_sha256': {key: hashlib.sha256(path.read_bytes()).hexdigest()
                               for key, path in [('baseline', args.baseline), ('candidate', args.candidate)]},
              'cases': len(rows), 'baseline_matched': sum(row.get('baseline', {}).get('matched', False) for row in rows),
              'candidate_matched': sum(row.get('candidate', {}).get('matched', False) for row in rows),
              'source_xml_preserved': all(row.get('source_xml_preserved', False) for row in rows), 'rows': rows}
    (args.out / 'summary.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({key: value for key, value in result.items() if key != 'rows'}, indent=2))
    if result['candidate_matched'] != result['cases'] or not result['source_xml_preserved']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
