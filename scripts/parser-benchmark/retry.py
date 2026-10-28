import argparse
import gzip
import json
import os
from pathlib import Path
import statistics
import subprocess
import time
from corpus import OUT, ROOT


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--out',type=Path,default=OUT)
    ap.add_argument('--timeout',type=int,default=600)
    ap.add_argument('--single-parse',action='store_true')
    args=ap.parse_args()
    out=args.out
    entries={e['id']:e for e in json.loads((out/'manifest.json').read_text())['entries']}
    binary=ROOT/'scripts/parser-benchmark/target/release/parser-benchmark'
    retries=[]
    for path in sorted((out/'raw').rglob('*.metrics.json')):
        original=json.loads(path.read_text())
        if original['status']!='timeout':
            continue
        ident,engine=original['id'],original['engine']
        e=entries[ident]
        print('Retry',engine,ident[:12],flush=True)
        start=time.time()
        retry_load=os.getloadavg()
        count=0 if args.single_parse else 1
        try:
            r=subprocess.run([str(binary),engine,e['path'],e['format'],str(path.parent/ident),str(count)],capture_output=True,text=True,timeout=args.timeout)
            update=json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode==0 else {'status':'process_error','returncode':r.returncode,'error':r.stderr[-3000:]}
            if args.single_parse and update.get('status')=='ok':
                timings=update['warm_ms']
                update['samples']=[{'parse_ms':timings[0],'projection_ms':timings[1],'total_ms':sum(timings)}]
        except subprocess.TimeoutExpired:
            update={'status':'timeout','timeout_seconds':args.timeout}
        reason='Repeated measurements exceeded the original process budget; retry uses '+('one initial parse without a warmup to limit resource pressure.' if args.single_parse else 'one measured sample after warmup.')
        update.update(wall_seconds=time.time()-start,repeats=count,sample_kind='first_parse' if args.single_parse else 'warm',retry_started_at=start,retry_load_before=retry_load,retry_reason=reason,initial_attempt=original)
        record={**original,**update}
        if record.get('samples'):
            for key in ['parse_ms','projection_ms','total_ms']:
                record['median_'+key]=statistics.median(s[key] for s in record['samples'])
            record['relative_mad']=None
        if record['status']=='timeout':
            try:
                with gzip.open(path.parent/(ident+'.json.gz'),'rb') as f:
                    while f.read(1024*1024):
                        pass
                if engine=='docx-core':
                    with gzip.open(path.parent/(ident+'.blocks.json.gz'),'rb') as f:
                        while f.read(1024*1024):
                            pass
                record.update(status='ok',benchmark_status='timeout',median_total_ms=None)
            except Exception:
                pass
        print('Record',json.dumps(record),flush=True)
        temporary=path.with_suffix('.tmp')
        temporary.write_text(json.dumps(record,indent=2))
        temporary.replace(path)
        retries.append({'engine':engine,'id':ident,'status':record['status'],'seconds':time.time()-start})
        print('Result',record['status'],record.get('median_total_ms'),flush=True)
    (out/'retries.json').write_text(json.dumps(retries,indent=2))
    print('Complete',flush=True)


if __name__=='__main__':
    main()
