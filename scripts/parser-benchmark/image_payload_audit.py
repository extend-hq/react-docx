import argparse,subprocess,tempfile,base64,collections,gzip,hashlib,json,posixpath,time,urllib.parse,xml.etree.ElementTree as ET,zipfile
from pathlib import Path
from corpus import attr,tag,descendants

def sha(data):return hashlib.sha256(data).hexdigest()
def uri_bytes(value):
    if not isinstance(value,str) or not value.startswith('data:'):return None
    header,body=value.split(',',1)
    return base64.b64decode(body)if ';base64'in header else urllib.parse.unquote_to_bytes(body)
def source_images(path):
    with zipfile.ZipFile(path)as archive:
        names=set(archive.namelist())
        def relationships(part):
            name=posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')if part else'_rels/.rels'
            if name not in names:return {}
            return {attr(r,'Id'):{'target':attr(r,'Target',''),'type':attr(r,'Type','').split('/')[-1],'external':attr(r,'TargetMode')=='External'}for r in ET.fromstring(archive.read(name))}
        def resolve(part,target):return posixpath.normpath(posixpath.join(posixpath.dirname(part),urllib.parse.unquote(urllib.parse.urlsplit(target).path))).lstrip('/')
        main=next((resolve('',r['target'])for r in relationships('').values()if r['type']=='officeDocument'),'word/document.xml')
        rels=relationships(main);root=ET.fromstring(archive.read(main));images=[]
        for node in descendants(root):
            if tag(node)not in {'blip','imagedata'}:continue
            rid=attr(node,'embed')or attr(node,'id')or attr(node,'link');rel=rels.get(rid,{})
            target=resolve(main,rel['target'])if rel.get('target')and not rel.get('external')else None
            data=archive.read(target)if target in names else None
            images.append({'rid':rid,'target':target,'sha256':sha(data)if data is not None else None,'external':rel.get('external',False)})
        return images

def native_payloads(model,expected):
    counts=collections.Counter();seen=set();nodes=0;composites=0;errors=[]
    def walk(value,path):
        nonlocal nodes,composites
        if isinstance(value,list):
            for i,child in enumerate(value):walk(child,path+'/'+str(i))
        elif isinstance(value,dict):
            if value.get('type')=='image':
                identity=value.get('blockId')or path
                if identity in seen:return
                seen.add(identity);nodes+=1
                try:
                    payload=None
                    if value.get('data'):
                        data=value['data'];original=bytes(data)if isinstance(data,list)else base64.b64decode(data)
                        if sha(original)in expected:payload=original
                    if payload is None:payload=uri_bytes(value.get('src'))
                    if payload is not None:
                        digest=sha(payload)
                        if digest in expected:counts[digest]+=1
                        elif b'<svg' in payload[:1000]:
                            svg=ET.fromstring(payload);placements=0
                            for image in svg.iter():
                                if tag(image)!='image':continue
                                data=uri_bytes(attr(image,'href',''))
                                if data is not None:counts[sha(data)]+=1;placements+=1
                            composites+=bool(placements)
                except Exception as error:errors.append({'path':path,'error':str(error)})
            for key,child in value.items():
                if key not in {'src','data','sourceXml','sourceParts','sourceRunProvenance'}:walk(child,path+'/'+key)
    walk(model.get('nodes',[]),'nodes')
    return counts,nodes,composites,errors

def main():
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--scores',type=Path,required=True);p.add_argument('--binary',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(exist_ok=True)
    binary_sha=sha(a.binary.read_bytes());scores={r['id']:r for r in json.loads(a.scores.read_text())if r['engine']=='docx-core'}
    result={'status':'running','binary_sha256':binary_sha,'manifest_sha256':sha(a.manifest.read_bytes()),'scores_sha256':sha(a.scores.read_bytes()),'script_sha256':sha(Path(__file__).read_bytes()),'started_at':time.time(),'scope':'Body image relationship payload multiplicity versus direct native image payloads or embedded SVG image payloads. Original native data is preferred when it matches a source asset, including converted metafiles; otherwise direct src or composite SVG image payloads are matched. Duplicate src/data representations count once. Source XML and preserved package parts receive no credit. This checks payload retention, not rendering, layout, crop, or pixel equivalence. The original occurrence-count scorer is unchanged.','records':[]}
    def save():
        temp=a.out/'summary.tmp';temp.write_text(json.dumps(result,indent=2)+'\n');temp.replace(a.out/'summary.json')
    for i,entry in enumerate(json.loads(a.manifest.read_text())['entries'],1):
        raw=scores[entry['id']];assert raw['cache_identity']['binary_sha256']==binary_sha;assert sha(Path(entry['path']).read_bytes())==entry['id']
        source=source_images(entry['path']);expected=collections.Counter(x['sha256']for x in source if x['sha256']);row={'id':entry['id'],'expected':sum(expected.values()),'unresolved_source_relationships':sum(x['sha256']is None for x in source),'matched':0,'composites':0}
        if expected:
            with tempfile.TemporaryDirectory(dir=a.out,prefix='native-image-')as temporary:
                prefix=Path(temporary)/'native'
                parsed=json.loads(subprocess.check_output([str(a.binary.resolve()),'docx-core',entry['path'],entry['format'],str(prefix),'0'],text=True,timeout=600))
                assert parsed['status']=='ok' and parsed.get('compact_output') is False
                with gzip.open(str(prefix)+'.json.gz','rt')as stream:model=json.load(stream)
                actual,nodes,composites,errors=native_payloads(model,expected);del model
                row['fresh_full_native_output']=True
            row.update(matched=sum((expected&actual).values()),composites=composites,native_image_nodes=nodes,missing_payloads=[{**image,'missing_multiplicity':(expected-actual)[image['sha256']]}for image in source if image['sha256']in expected-actual],errors=errors)
        result['records'].append(row)
        if i%25==0:
            result['totals']={key:sum(r.get(key,0)for r in result['records'])for key in ['expected','matched','composites','unresolved_source_relationships']};save();print('AUDITED',i,'/',1000,result['totals'],flush=True)
    result['status']='complete';result['finished_at']=time.time();save()
if __name__=='__main__':main()
