import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import zlib
import zipfile

from vml_group_diagnostics import audit


def png(red, green, blue):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes([0, red, green, blue]))) + chunk(b'IEND', b'')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    first = '<v:shape type="#_x0000_t75" style="position:absolute;left:5;top:7;width:40;height:80;z-index:2" stroked="f"><v:imagedata r:id="r2"/></v:shape>'
    second = '<v:shape type="#_x0000_t75" style="position:absolute;left:55;top:107;width:50;height:100;z-index:1" stroked="f"><v:imagedata r:id="r3"/></v:shape>'
    vector = '<v:shape coordorigin="3,4" coordsize="10,20" style="left:10;top:20;width:30;height:80" path="m3,4l13,4,13,24xe" fillcolor="#123456" strokecolor="#abcdef" strokeweight="0.5pt"><v:stroke dashstyle="dot"/></v:shape>'
    group = '<v:group style="position:absolute;margin-left:12pt;margin-top:18pt;width:30pt;height:20px" coordorigin="5,7" coordsize="100,200">{}</v:group>'
    flat = vector.replace('coordsize="10,20"', 'coordsize="10,0"').replace('path="m3,4l13,4,13,24xe"', 'path="m3,4l13,4e"').replace('fillcolor="#123456"', 'filled="f"')
    ordinary = group.format(first + second)
    cases = [
        ('coordinate_axes_and_z_order', ordinary, True),
        ('vector_transform_and_dash', group.format(first + second + vector), True),
        ('cropped_bitmap', group.format(first.replace('r:id="r2"', 'r:id="r2" cropleft="0.1"') + second), False),
        ('rectangle_bitmap', group.format(first.replace('v:shape', 'v:rect') + second), False),
        ('line_bitmap', group.format(first.replace('v:shape', 'v:line') + second), False),
        ('nested_groups', group.format(ordinary), False),
        ('textbox_group', group.format(first + second + '<v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>'), False),
        ('unsupported_path', group.format(first + second + vector.replace('m3,4l13,4,13,24xe', 'm3,4r10,20e')), False),
        ('rotated_group', ordinary.replace('position:absolute;margin', 'position:absolute;rotation:25;margin'), False),
        ('extra_picture_sibling', ordinary + first, False),
        ('inherited_paint', ordinary.replace('<v:group ', '<v:group fillcolor="#123456" '), False),
        ('stroke_effect', group.format(first + second + vector.replace('dashstyle="dot"', 'dashstyle="dot" opacity="0.5"')), False),
        ('unspecified_stroke_weight', group.format(first + second + vector.replace(' strokeweight="0.5pt"', '')), False),
        ('zero_height_origin', group.format(first + second + flat), True),
        ('zero_height_thin', group.format(first + second + flat.replace('height:80', 'height:2')), True),
        ('zero_width_origin', group.format(first + second + flat.replace('coordsize="10,0"', 'coordsize="0,20"').replace('m3,4l13,4e', 'm3,4l3,24e')), True),
        ('zero_height_off_origin', group.format(first + second + flat.replace('m3,4l13,4e', 'm3,5l13,5e')), False),
        ('zero_height_cubic_control', group.format(first + second + flat.replace('m3,4l13,4e', 'm3,4c3,4,10,5,13,4e')), False),
        ('zero_both_axes', group.format(first + second + flat.replace('coordsize="10,0"', 'coordsize="0,0"').replace('m3,4l13,4e', 'm3,4l3,4e')), False),
        ('zero_height_filled', group.format(first + second + flat.replace('filled="f"', 'filled="t"')), False),
        ('fractional_float_margins', ordinary.replace('margin-left:12pt;margin-top:18pt', 'margin-left:12.125pt;margin-top:18.375pt'), True),
        ('unsupported_float_margin', ordinary.replace('margin-left:12pt', 'margin-left:10%'), False),
        ('aligned_overflow', group.format(first.replace('left:5;top:7', 'left:4;top:6') + second).replace('position:absolute;', 'position:absolute;mso-position-horizontal:center;'), False),
        ('bitmap_overflow', group.format(first.replace('left:5;top:7', 'left:4;top:6') + second), True),
        ('vector_stroke_overflow', group.format(first + second + vector.replace('left:10;top:20', 'left:5;top:7')), True),
        ('unaligned_inline_overflow', group.format(first.replace('left:5;top:7', 'left:4;top:6') + second).replace('position:absolute;margin-left:12pt;margin-top:18pt;', ''), False),
    ]
    rows = []
    for name, pict, positive in cases:
        document = args.out / (name + '.docx')
        with zipfile.ZipFile(document, 'w', compression=zipfile.ZIP_DEFLATED) as package:
            package.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
            package.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
            package.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:pict>' + pict + '</w:pict></w:r></w:p></w:body></w:document>')
            package.writestr('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/><Relationship Id="r3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/b.png"/></Relationships>')
            package.writestr('word/media/a.png', png(255, 0, 0))
            package.writestr('word/media/b.png', png(0, 255, 0))
        paths = {}
        for label, binary in [('baseline', args.baseline), ('candidate', args.candidate)]:
            prefix = args.out / (name + '.' + label)
            process = subprocess.run([str(binary.resolve()), 'docx-core', str(document), 'docx', str(prefix), '0'], capture_output=True, text=True, check=True, timeout=30)
            receipt = json.loads(process.stdout)
            if receipt['status'] != 'ok':
                raise ValueError(receipt)
            paths[label] = Path(str(prefix) + '.json.gz')
        if positive:
            result = audit(document, paths['baseline'], paths['candidate'])
            passed = result['passed'] and result['composited_groups'] == 1 and result['composited_bitmap_occurrences'] == 2
        else:
            same = json.load(gzip.open(paths['baseline'])) == json.load(gzip.open(paths['candidate']))
            result = {'fallback_model_unchanged': same}
            passed = same
        rows.append({'case': name, 'expected_composite': positive, 'passed': passed, 'details': result})
    result = {'binary_sha256': {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in [('baseline', args.baseline), ('candidate', args.candidate)]}, 'cases': len(rows), 'passed': sum(row['passed'] for row in rows), 'rows': rows}
    (args.out / 'summary.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({key: value for key, value in result.items() if key != 'rows'}, indent=2))
    if result['passed'] != len(rows):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
