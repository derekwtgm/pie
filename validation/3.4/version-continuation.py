"""Usage: python version-continuation.py mwcli-3.3 mwcli-3.4 result.json"""
from pathlib import Path
import sys, json, hashlib, subprocess, tempfile
fixtures=Path(__file__).resolve().parents[2]/'source/tests/fixtures'
rows=[]
with tempfile.TemporaryDirectory() as directory:
    tmp=Path(directory)
    for name in ['es-six-weighted','es-dcfr-six','es-grouped-six','es-preflop8','device-turn']:
        spec=fixtures/(name+'.json')
        def train(cli,it,threads,out,prior=None):
            args=[cli,str(spec),str(it),str(threads),str(tmp/out),'512']
            if prior:args.append(str(tmp/prior))
            return json.loads(subprocess.check_output(args))
        train(sys.argv[1],17,1,'base')
        train(sys.argv[2],13,2,'resumed','base')
        ref=train(sys.argv[2],30,1,'ref')
        def snap(name):
            data=(tmp/name).read_bytes()
            h=int.from_bytes(data[8:12],'little')
            return json.loads(data[12:12+h]),data[12+h:]
        a,x=snap('resumed');b,y=snap('ref')
        assert x==y and all(a.get(k)==b.get(k) for k in ['iterations','rng','actionRng','trainingDeals','stateVisits'])
        rows.append(dict(fixture=name,iterations=ref['iterations'],bodySHA256=hashlib.sha256(x).hexdigest(),equalCountersAndRows=True))
Path(sys.argv[3]).write_text(json.dumps(rows,indent=2))
