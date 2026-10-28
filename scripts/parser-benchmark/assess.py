import argparse
import collections
import gc
import gzip
import html
import json
from pathlib import Path
import statistics
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent/'.python-deps'))
import ijson
from ijson.common import ObjectBuilder
from corpus import OUT, norm
from normalize import normalize, core_block_paragraphs
from run import ENGINES


def load_native(engine,path):
    if engine!='docx-core':
        with gzip.open(path) as f:
            return json.load(f)
    builder=ObjectBuilder()
    omit=False
    depth=0
    shrink=False
    with gzip.open(path) as f:
        for event,value in ijson.basic_parse(f,use_float=True):
            if depth:
                depth+=(event in ['start_map','start_array'])-(event in ['end_map','end_array'])
                continue
            if omit:
                depth=int(event in ['start_map','start_array'])
                omit=False
                continue
            if event=='map_key' and (value.endswith('Xml') or value.endswith('OpenTag')):
                omit=True
                continue
            if shrink and event=='string':
                value='[present]' if value else ''
            shrink=event=='map_key' and value in ['data','src']
            builder.event(event,value)
    return builder.value


def ratio(a,b):
    return a/b if b else 1.0


def grams(paragraphs):
    result=collections.Counter()
    for p in paragraphs:
        s=norm(p['text'])
        if s:
            if len(s)<5:
                result[s]+=1
            else:
                result.update(s[i:i+5] for i in range(len(s)-4))
    return result


def text_score(reference,actual):
    reference_text = [s for p in reference if (s := norm(p['text']))]
    actual_text = [s for p in actual if (s := norm(p['text']))]
    if reference_text == actual_text:
        count = sum(max(1, len(s) - 4) for s in reference_text)
        paragraphs = len(reference_text)
        return {'recall':1.0,'precision':1.0,'f1':1.0,'expected_grams':count,'found_grams':count,'matched_grams':count,
                'expected_paragraphs':paragraphs,'found_paragraphs':paragraphs,'matched_paragraphs':paragraphs,
                'paragraph_recall':1.0,'exact_text':True,'missing_paragraphs':[],'extra_paragraphs':[]}
    a,b=grams(reference),grams(actual)
    overlap=sum((a&b).values())
    expected,found=sum(a.values()),sum(b.values())
    r,p=ratio(overlap,expected),ratio(overlap,found)
    ra=collections.Counter(norm(x['text']) for x in reference if norm(x['text']))
    rb=collections.Counter(norm(x['text']) for x in actual if norm(x['text']))
    matches=sum((ra&rb).values())
    return {'recall':r,'precision':p,'f1':2*r*p/(r+p) if r+p else 0.0,'expected_grams':expected,'found_grams':found,'matched_grams':overlap,'expected_paragraphs':sum(ra.values()),'found_paragraphs':sum(rb.values()),'matched_paragraphs':matches,'paragraph_recall':ratio(matches,sum(ra.values())),'exact_text':''.join(norm(x['text']) for x in reference)==''.join(norm(x['text']) for x in actual),'missing_paragraphs':list((ra-rb).items())[:12],'extra_paragraphs':list((rb-ra).items())[:12]}


def feature_score(reference,actual):
    result={}
    for name,items in reference.get('features',{}).items():
        items=[x for x in items if x['story']=='body']
        got=[x for x in actual.get('features',{}).get(name,[]) if x['story']=='body']
        if not items:
            continue
        if name in ['explicit_bold','explicit_italic','hyperlinks']:
            a,b=grams(items),grams(got)
            matched=sum((a&b).values())
            expected=sum(a.values())
            result[name]={'matched':matched,'expected':expected,'found':sum(b.values()),'recall':ratio(matched,expected),'unit':'normalized character 5-grams in explicitly marked source text; segmentation-sensitive'}
        elif name in ['images','equations']:
            result[name]={'matched':min(len(items),len(got)),'expected':len(items),'found':len(got),'recall':ratio(min(len(items),len(got)),len(items)),'exact_count':len(items)==len(got),'unit':'occurrence count only'}
        else:
            def key(x):
                return (x['text'],x.get('value')) if name in ['headings','horizontal_merges'] else x['text']
            a=collections.Counter(key(x) for x in items if x['text'])
            if name=='textbox_text':
                b=collections.Counter(norm(p['text']) for p in actual['paragraphs'] if p['story']=='body')
            else:
                b=collections.Counter(key(x) for x in got if x['text'])
            matched=sum((a&b).values())
            result[name]={'matched':matched,'expected':sum(a.values()),'found':sum(b.values()),'recall':ratio(matched,sum(a.values())),'unit':'exact normalized content anchor'+(' and value' if name in ['headings','horizontal_merges'] else '')}
    for story in ['header','footer','footnotes','endnotes','comments']:
        a={norm(p['text']) for p in reference['paragraphs'] if p['story']==story and norm(p['text'])}
        b={norm(p['text']) for p in actual['paragraphs'] if p['story']==story and norm(p['text'])}
        if a:
            result[story+'_text']={'matched':len(a&b),'expected':len(a),'found':len(b),'recall':ratio(len(a&b),len(a)),'unit':'distinct exact normalized paragraphs in matching story'}
    return result


def percentile(xs,q):
    if not xs:
        return None
    xs=sorted(xs)
    x=(len(xs)-1)*q
    i=int(x)
    return xs[i]+(xs[min(i+1,len(xs)-1)]-xs[i])*(x-i)


def aggregate(rows,fmt):
    result={}
    matching=[r for r in rows if r['format']==fmt]
    common={r['id'] for r in matching if r['status']=='ok' and r.get('median_total_ms') is not None and r.get('sample_kind')!='first_parse'}
    for engine in ENGINES:
        common&={r['id'] for r in matching if r['engine']==engine and r['status']=='ok' and r.get('median_total_ms') is not None and r.get('sample_kind')!='first_parse'}
    baseline={r['id']:r['median_total_ms'] for r in matching if r['engine']=='docx-core' and r['id'] in common}
    for engine in ENGINES:
        rs=[r for r in matching if r['engine']==engine]
        ok=[r for r in rs if r['status']=='ok']
        expected=sum(r['body']['expected_grams'] for r in rs if 'body' in r)
        matched=sum(r['body']['matched_grams'] for r in rs if 'body' in r)
        found=sum(r['body']['found_grams'] for r in rs if 'body' in r)
        recall,precision=ratio(matched,expected),ratio(matched,found)
        features={}
        for name in sorted({k for r in rs for k in r.get('features',{})}):
            fs=[r['features'][name] for r in rs if name in r.get('features',{})]
            features[name]={'matched':sum(f['matched'] for f in fs),'expected':sum(f['expected'] for f in fs),'found':sum(f['found'] for f in fs),'documents':len(fs),'unit':fs[0]['unit']}
            features[name]['recall']=ratio(features[name]['matched'],features[name]['expected'])
        values=[r['median_total_ms'] for r in ok if r.get('median_total_ms') is not None and r.get('sample_kind')!='first_parse']
        common_values=[r['median_total_ms'] for r in ok if r['id'] in common and r.get('median_total_ms') is not None]
        mads=[r['relative_mad'] for r in ok if r.get('relative_mad') is not None]
        result[engine]={'attempted':len(rs),'success':len(ok),'statuses':dict(collections.Counter(r['status'] for r in rs)),'text_recall_micro':recall,'text_precision_micro':precision,'text_f1_micro':2*recall*precision/(recall+precision) if recall+precision else 0,'text_f1_macro':statistics.mean(r['body']['f1'] for r in rs) if rs else 0,'exact_text_documents':sum(r['body']['exact_text'] for r in rs),'paragraph_recall':ratio(sum(r['body']['matched_paragraphs'] for r in rs),sum(r['body']['expected_paragraphs'] for r in rs)),'median_ms':percentile(values,.5),'p95_ms':percentile(values,.95),'total_median_seconds':sum(values)/1000,'common_success':len(common),'common_total_seconds':sum(common_values)/1000,'common_median_ms':percentile(common_values,.5),'features':features,'median_relative_mad':statistics.median(mads) if mads else None}
        result[engine]['median_paired_speedup_vs_core']=percentile([baseline[r['id']]/r['median_total_ms'] for r in ok if r['id'] in common],.5)
        result[engine]['common_parse_seconds']=sum(r.get('median_parse_ms',0) for r in ok if r['id'] in common)/1000
        result[engine]['common_projection_seconds']=sum(r.get('median_projection_ms',0) for r in ok if r['id'] in common)/1000
        result[engine]['warm_timed_documents']=len(values)
        result[engine]['first_parse_timings']=[{'id':r['id'],'ms':r['median_total_ms']} for r in ok if r.get('sample_kind')=='first_parse' and r.get('median_total_ms') is not None]
        result[engine]['text_f1_macro_success']=statistics.mean(r['body']['f1'] for r in ok) if ok else None
    return result


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--out',type=Path,default=OUT)
    ap.add_argument('--limit',type=int)
    ap.add_argument('--ids',nargs='+')
    ap.add_argument('--refresh',action='store_true')
    args=ap.parse_args()
    out=args.out
    entries=json.loads((out/'manifest.json').read_text())['entries']
    rows=[]
    if args.ids:
        selected=set(args.ids)
        entries=[e for e in entries if e['id'] in selected]
        if (out/'scores.json').exists():
            rows=[r for r in json.loads((out/'scores.json').read_text()) if r['id'] not in selected]
    if args.limit:
        entries=entries[:args.limit]
    for i,e in enumerate(entries):
        truth=json.loads((out/'oracle'/(e['id']+'.json')).read_text())
        if 'error' in truth:
            continue
        reference=[p for p in truth['paragraphs'] if p['story']=='body']
        for engine in ENGINES:
            metric=out/'raw'/engine/(e['id']+'.metrics.json')
            if not metric.exists():
                continue
            raw=json.loads(metric.read_text())
            row={**raw,'format':e['format'],'reference':truth['reference']}
            cache=out/'normalized'/engine/(e['id']+'.json.gz')
            actual={'paragraphs':[],'features':{}}
            if row['status']=='ok':
                if cache.exists() and not args.refresh:
                    actual=json.load(gzip.open(cache))
                else:
                    try:
                        data=load_native(engine,out/'raw'/engine/(e['id']+'.json.gz'))
                        actual=normalize(engine,data)
                        del data
                        cache.parent.mkdir(parents=True,exist_ok=True)
                        with gzip.open(cache,'wt',encoding='utf-8') as f:
                            json.dump(actual,f,ensure_ascii=False)
                        gc.collect()
                    except Exception as exc:
                        row['status']='normalization_error'
                        row['normalization_error']=repr(exc)
            body=[p for p in actual['paragraphs'] if p['story']=='body']
            row['body']=text_score(reference,body)
            if row['status']!='ok':
                row['body'].update(recall=0.0,precision=0.0,f1=0.0,paragraph_recall=0.0,exact_text=False)
            if engine=='docx-core' and row['status']=='ok':
                block_cache=out/'normalized'/engine/(e['id']+'.blocks.json.gz')
                if block_cache.exists() and not args.refresh:
                    cached=json.load(gzip.open(block_cache))
                    block_paragraphs,audit=cached['paragraphs'],cached['audit']
                else:
                    block_data=load_native(engine,out/'raw'/engine/(e['id']+'.blocks.json.gz'))
                    block_paragraphs,audit=core_block_paragraphs(block_data)
                    del block_data
                    with gzip.open(block_cache,'wt',encoding='utf-8') as f:
                        json.dump({'paragraphs':block_paragraphs,'audit':audit},f,ensure_ascii=False)
                row['model_body']=row['body']
                row['body']=text_score(reference,[p for p in block_paragraphs if p['story']=='body'])
                row['source_reference_audit']=audit
            row['features']=feature_score(truth,actual)
            row['hazards']=truth.get('hazards',{})
            rows.append(row)
        if (i+1)%20==0:
            print('Scored',i+1,'/',len(entries),flush=True)
            (out/'scores.json').write_text(json.dumps(rows,ensure_ascii=False))
    (out/'scores.json').write_text(json.dumps(rows,ensure_ascii=False))
    summary={fmt:aggregate(rows,fmt) for fmt in ['docx','doc']}
    (out/'summary.json').write_text(json.dumps(summary,indent=2))
    for fmt,engines in summary.items():
        print(fmt)
        for engine,r in engines.items():
            print(engine,json.dumps({k:v for k,v in r.items() if k!='features'}),flush=True)


if __name__=='__main__':
    main()
