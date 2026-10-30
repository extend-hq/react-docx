import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import posixpath
import subprocess
import time
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'parser-benchmark'
W = {'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'}
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'


def tag(e):
    return e.tag.split('}', 1)[-1]


def ns(e):
    return e.tag[1:].split('}', 1)[0] if e.tag.startswith('{') else ''


def attr(e, name, default=None):
    if e is None:
        return default
    return next((v for k, v in e.attrib.items() if k.split('}')[-1] == name), default)


def child(e, name):
    return next((c for c in e if tag(c) == name and ns(c) in W), None) if e is not None else None


def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFC', s or '') if not c.isspace() and c not in '\u00ad\u200b\ufeff')


def selected(e):
    for c in e:
        if ns(c) in W and tag(c) in {'del', 'moveFrom', 'pPrChange', 'rPrChange', 'tblPrChange', 'tcPrChange', 'trPrChange', 'sectPrChange', 'tblGridChange'}:
            continue
        if ns(c) == MC and tag(c) == 'AlternateContent':
            choices = [n for n in c if tag(n) == 'Choice']
            chosen = choices[0] if choices else next(iter(c), None)
            if chosen is not None:
                yield from selected(chosen)
        else:
            yield c


def descendants(e):
    yield e
    for c in selected(e):
        yield from descendants(c)


def p_text(e):
    result = []
    def walk(n):
        if n is not e and ns(n) in W and tag(n) == 'p':
            return
        if ns(n) in W and tag(n) == 't':
            result.append(n.text or '')
        if ns(n) in W and tag(n) in {'tab', 'br', 'cr'}:
            result.append(' ')
        if ns(n) in W and tag(n) == 'noBreakHyphen':
            result.append('\u2011')
        for c in selected(n):
            walk(c)
    walk(e)
    return ''.join(result)


def inventory(roots):
    entries = {}
    for root in roots:
        for path in sorted(root.rglob('*')):
            if not path.is_file() or path.suffix.lower() not in {'.doc', '.docx'} or path.name.startswith('~$'):
                continue
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            actual = 'docx' if data.startswith(b'PK') else 'doc' if data.startswith(bytes.fromhex('d0cf11e0a1b11ae1')) else 'other'
            if digest not in entries:
                entries[digest] = {'id': digest, 'path': str(path), 'bytes': len(data), 'format': actual, 'extension': path.suffix.lower(), 'aliases': []}
            entries[digest]['aliases'].append(str(path))
    return list(sorted(entries.values(), key=lambda x: x['id']))


def oracle(path):
    features = collections.defaultdict(list)
    paragraphs = []
    hazards = collections.Counter()
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        def xml(name):
            return ET.fromstring(z.read(name))
        def relationships(part):
            relpath = posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels') if part else '_rels/.rels'
            if relpath not in names:
                return {}
            return {attr(r, 'Id'): {'type':attr(r, 'Type', '').split('/')[-1], 'target':attr(r, 'Target', ''), 'external':attr(r, 'TargetMode') == 'External'} for r in xml(relpath)}
        def resolve(part, target):
            return posixpath.normpath(posixpath.join(posixpath.dirname(part), target)).lstrip('/')
        main_rel = next((r for r in relationships('').values() if r['type'] == 'officeDocument'), None)
        main = resolve('', main_rel['target']) if main_rel else 'word/document.xml'
        rels = relationships(main)
        main_xml = xml(main)
        styles_rel = next((r for r in rels.values() if r['type'] == 'styles'), None)
        styles = {}
        if styles_rel:
            for s in xml(resolve(main, styles_rel['target'])):
                if tag(s) == 'style':
                    styles[attr(s, 'styleId')] = s
        def para_props(p):
            direct = child(p, 'pPr')
            sid = attr(child(direct, 'pStyle'), 'val')
            chain = []
            seen = set()
            while sid in styles and sid not in seen:
                seen.add(sid)
                chain.append(child(styles[sid], 'pPr'))
                sid = attr(child(styles[sid], 'basedOn'), 'val')
            chain = [direct] + chain
            def prop(name):
                return next((child(x, name) for x in chain if child(x, name) is not None), None)
            return prop
        def visit(root, story, part):
            def walk(e, in_table=False, in_box=False):
                local, space = tag(e), ns(e)
                if space in W:
                    if local == 'txbxContent':
                        in_box = True
                    if local == 'tbl':
                        features['tables'].append({'story':story,'text':norm(''.join(p_text(p) for p in descendants(e) if ns(p) in W and tag(p) == 'p'))})
                        if in_table:
                            features['nested_tables'].append(features['tables'][-1])
                        in_table = True
                    if local == 'tc':
                        text = norm(''.join(p_text(p) for p in descendants(e) if ns(p) in W and tag(p) == 'p'))
                        if text:
                            features['table_cells'].append({'story':story,'text':text})
                        span = attr(child(child(e, 'tcPr'), 'gridSpan'), 'val', '1')
                        if int(span) > 1:
                            features['horizontal_merges'].append({'story':story,'text':text,'value':int(span)})
                        vm = child(child(e, 'tcPr'), 'vMerge')
                        if vm is not None and attr(vm, 'val') == 'restart':
                            features['vertical_merges'].append({'story':story,'text':text})
                    if local == 'p':
                        text = p_text(e)
                        if norm(text):
                            p = {'text':text,'story':story,'part':part,'table':in_table,'textbox':in_box}
                            paragraphs.append(p)
                            anchor = {'text':norm(text),'story':story}
                            if in_box:
                                features['textbox_text'].append(anchor)
                            prop = para_props(e)
                            outline = attr(prop('outlineLvl'), 'val')
                            if outline is not None and int(outline) < 9:
                                features['headings'].append(dict(anchor, value=int(outline)+1))
                            num = prop('numPr')
                            if num is not None and attr(child(num, 'numId'), 'val', '0') != '0':
                                features['lists'].append(anchor)
                    if local == 'hyperlink':
                        text = norm(''.join(n.text or '' for n in descendants(e) if ns(n) in W and tag(n) == 't'))
                        if text:
                            features['hyperlinks'].append({'story':story,'text':text})
                    if local == 'r':
                        text = norm(''.join(n.text or '' for n in selected(e) if ns(n) in W and tag(n) == 't'))
                        rp = child(e, 'rPr')
                        for name in ['b', 'i']:
                            el = child(rp, name)
                            if text and el is not None and attr(el, 'val', '1') not in {'0','false','off'}:
                                features[{'b':'explicit_bold','i':'explicit_italic'}[name]].append({'story':story,'text':text})
                    if local in {'sdt','ffData','sym','altChunk','object'}:
                        hazards[local] += 1
                if local == 'oMath' and space.endswith('/math'):
                    features['equations'].append({'story':story,'text':norm(''.join(n.text or '' for n in e.iter() if tag(n) == 't'))})
                if local in {'blip','imagedata'}:
                    features['images'].append({'story':story})
                for c in selected(e):
                    walk(c, in_table, in_box)
            walk(root)
        visit(main_xml, 'body', main)
        seen_parts = {main}
        referenced_ids = {attr(e, 'id') for e in descendants(main_xml) if ns(e) in W and tag(e) in {'headerReference','footerReference'}}
        for rid, r in rels.items():
            kind = r['type']
            if kind not in {'header','footer','footnotes','endnotes','comments'}:
                continue
            if kind in {'header','footer'} and rid not in referenced_ids:
                continue
            part = resolve(main, r['target'])
            if part in seen_parts or part not in names:
                continue
            seen_parts.add(part)
            root = xml(part)
            if kind in {'footnotes','endnotes'}:
                for item in list(root):
                    if attr(item, 'type') in {'separator','continuationSeparator','continuationNotice'} or int(attr(item, 'id', '0')) < 0:
                        root.remove(item)
            visit(root, kind, part)
        for e in main_xml.iter():
            if tag(e) in {'del','moveFrom','AlternateContent'}:
                hazards[tag(e)] += 1
    return {'paragraphs':paragraphs,'features':dict(features),'hazards':dict(hazards),'reference':'source_ooxml'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--roots', nargs='+', type=Path, required=True)
    ap.add_argument('--out', type=Path, default=OUT)
    args = ap.parse_args()
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    entries = inventory(args.roots)
    (out/'manifest.json').write_text(json.dumps({'roots':[str(p) for p in args.roots],'entries':entries},indent=2))
    print('Inventory:', len(entries), 'unique;', dict(collections.Counter(e['format'] for e in entries)), flush=True)
    refdir = out/'references'
    refdir.mkdir(exist_ok=True)
    legacy_in = refdir/'inputs'
    legacy_in.mkdir(exist_ok=True)
    docs = [e for e in entries if e['format'] == 'doc']
    conversions = json.loads((out/'conversions.json').read_text()) if (out/'conversions.json').exists() else []
    for index in range(0, len(docs), 10):
        batch = docs[index:index+10]
        inputs = []
        for e in batch:
            target = legacy_in/(e['id']+'.doc')
            if not target.exists():
                target.symlink_to(e['path'])
            if not (refdir/(e['id']+'.docx')).exists():
                inputs.append(str(target))
        if inputs:
            profile = refdir/'profile'
            start = time.time()
            try:
                r = subprocess.run(['soffice','-env:UserInstallation='+profile.as_uri(),'--headless','--convert-to','docx','--outdir',str(refdir),*inputs],capture_output=True,text=True,timeout=180)
                conversions.append({'ids':[e['id'] for e in batch],'code':r.returncode,'seconds':time.time()-start,'stdout':r.stdout,'stderr':r.stderr})
            except subprocess.TimeoutExpired:
                conversions.append({'ids':[e['id'] for e in batch],'status':'timeout'})
        print('Legacy references:', min(index+10,len(docs)), '/', len(docs), flush=True)
    (out/'conversions.json').write_text(json.dumps(conversions,indent=2))
    (out/'oracle').mkdir(exist_ok=True)
    for i,e in enumerate(entries):
        path = Path(e['path']) if e['format']=='docx' else refdir/(e['id']+'.docx')
        try:
            truth = oracle(path)
            if e['format']=='doc':
                truth['reference'] = 'libreoffice_docx_conversion'
            truth['id'] = e['id']
            (out/'oracle'/(e['id']+'.json')).write_text(json.dumps(truth,ensure_ascii=False))
        except Exception as exc:
            (out/'oracle'/(e['id']+'.json')).write_text(json.dumps({'id':e['id'],'error':str(exc)}))
        if (i+1)%50==0:
            print('Oracles:',i+1,'/',len(entries),flush=True)
    print('Complete',flush=True)


if __name__ == '__main__':
    main()
