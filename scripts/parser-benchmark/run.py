import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import statistics
import subprocess
import time
from corpus import OUT, ROOT

ENGINES = ['docx-core','docx-rs','office_oxide','undoc']


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--out',type=Path,default=OUT)
    ap.add_argument('--repeats',type=int,default=7)
    ap.add_argument('--timeout',type=int,default=180)
    ap.add_argument('--limit',type=int)
    args=ap.parse_args()
    out=args.out
    binary=ROOT/'scripts/parser-benchmark/target/release/parser-benchmark'
    binary_hash=hashlib.sha256(binary.read_bytes()).hexdigest()
    manifest=json.loads((out/'manifest.json').read_text())
    entries=manifest['entries']
    rng=random.Random(20261028)
    rng.shuffle(entries)
    if args.limit:
        entries=entries[:args.limit]
    receipt={'binary_sha256':binary_hash,'git_revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'rustc':subprocess.check_output(['rustc','--version'],text=True).strip(),'cpu':subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'],text=True).strip(),'os':subprocess.check_output(['sw_vers'],text=True),'start_time':time.time(),'versions':{'docx-core':'workspace','docx-rs':'0.4.22','office_oxide':'0.1.15','undoc':'0.27.1'},'repeats':args.repeats,'profile':'opt-level=3, thin LTO, codegen-units=1','seed':20261028,'input_bytes':sum(e['bytes'] for e in entries),'unique_inputs':len(entries),'load_at_start':os.getloadavg()}
    (out/'environment.json').write_text(json.dumps(receipt,indent=2))
    for i,e in enumerate(entries):
        engines=ENGINES.copy()
        rng.shuffle(engines)
        for engine in engines:
            directory=out/'raw'/engine
            directory.mkdir(parents=True,exist_ok=True)
            metrics=directory/(e['id']+'.metrics.json')
            if metrics.exists():
                old=json.loads(metrics.read_text())
                if old.get('binary_sha256')==binary_hash and old.get('repeats')==args.repeats:
                    continue
            start=time.time()
            record={'id':e['id'],'engine':engine,'format':e['format'],'binary_sha256':binary_hash,'repeats':args.repeats,'load_before':os.getloadavg(),'started_at':start}
            if e['format']=='doc' and engine=='docx-rs':
                record.update(status='unsupported',error='DOCX only')
            else:
                try:
                    r=subprocess.run([str(binary),engine,e['path'],e['format'],str(directory/e['id']),str(args.repeats)],capture_output=True,text=True,timeout=args.timeout)
                    if r.returncode:
                        record.update(status='process_error',returncode=r.returncode,error=r.stderr[-3000:])
                    else:
                        record.update(json.loads(r.stdout.strip().splitlines()[-1]))
                    if r.stderr:
                        record['stderr_tail']=r.stderr[-2000:]
                except subprocess.TimeoutExpired:
                    record.update(status='timeout',timeout_seconds=args.timeout)
                except Exception as exc:
                    record.update(status='harness_error',error=str(exc))
            record['wall_seconds']=time.time()-start
            samples=record.get('samples',[])
            if samples:
                for key in ['parse_ms','projection_ms','total_ms']:
                    values=[s[key] for s in samples]
                    record['median_'+key]=statistics.median(values)
                median=record['median_total_ms']
                record['relative_mad']=statistics.median(abs(s['total_ms']-median) for s in samples)/median if median else 0
            metrics.write_text(json.dumps(record,indent=2))
            if record['status']!='ok':
                print('RESULT',e['id'][:12],engine,record['status'],record.get('error','')[:140],flush=True)
        if (i+1)%10==0:
            print('PROGRESS',i+1,'/',len(entries),'elapsed_minutes',round((time.time()-receipt['start_time'])/60,1),flush=True)
    receipt['end_time']=time.time()
    receipt['load_at_end']=os.getloadavg()
    (out/'environment.json').write_text(json.dumps(receipt,indent=2))
    print('Complete',flush=True)


if __name__=='__main__':
    main()
