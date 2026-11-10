"""Run against a 3.2 mwcli. Optional third argument names the 3.1 mwcli."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import platform

cli = str(Path(sys.argv[1]).resolve())
output = Path(sys.argv[2])
baseline = str(Path(sys.argv[3]).resolve()) if len(sys.argv)>3 else None
fixtures = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def body(data):
    return data[12+int.from_bytes(data[8:12],'little'):]

with tempfile.TemporaryDirectory() as tmp:
    directory=Path(tmp)
    def run(exe,spec,count,threads,cap,name,previous=None):
        dest=directory/name
        args=[exe,str(spec),str(count),str(threads),str(dest),str(cap)]
        if previous: args.append(str(directory/previous))
        result=subprocess.run(args,capture_output=True,check=True,timeout=120)
        return json.loads(result.stdout),dest.read_bytes()

    report={'platform':platform.platform(),'solverSHA256':digest(Path(cli).read_bytes()),'rows':[]}
    for fixture in ['es-six-weighted.json','es-preflop8.json']:
        spec=fixtures/fixture
        for cap in [1,2,4,8,16]:
            low,cut=run(cli,spec,20000,2,cap,'cut')
            assert low['limitReached']
            it=low['iterations']
            assert low['trainingDeals']==it*low['batchDeals']
            assert low['tablePeakBytes']<=cap*1048576
            assert low['scratchPeakBytes']<=cap*1048576
            ref,uninterrupted=run(cli,spec,it,1,256,'ref')
            assert cut==uninterrupted
            more,resumed=run(cli,spec,5,4,256,'resumed','cut')
            ref,uninterrupted=run(cli,spec,it+5,1,256,'ref')
            assert resumed==uninterrupted
            report['rows'].append({'fixture':fixture,'capMiB':cap,'stopped':low,'resumed':more,
                'reference':ref,'cutSHA256':digest(cut),'resumedSHA256':digest(resumed),
                'referenceSHA256':digest(uninterrupted),'identicalAtStopAndAfterResume':True})
    if baseline:
        spec=fixtures/'es-six-weighted.json'
        low,bad=run(baseline,spec,500,2,2,'legacy-limited')
        failure=subprocess.run([cli,str(spec),'5','2',str(directory/'out'),'128',str(directory/'legacy-limited')],capture_output=True)
        assert failure.returncode and b'committed deal count' in failure.stderr
        ref,old=run(baseline,spec,149,1,128,'legacy-valid')
        new,resumed=run(cli,spec,5,4,128,'resumed','legacy-valid')
        ref,uninterrupted=run(baseline,spec,154,1,128,'legacy-ref')
        assert body(resumed)==body(uninterrupted)
        for key in ['rng','actionRng','stateVisits','trainingDeals','iterations','rows','states']:
            assert new[key]==ref[key]
        report['legacy']={'bad':low,'rejection':failure.stderr.decode().strip(),'resumed':new,'reference':ref,
                          'payloadSHA256':digest(body(resumed)),'referencePayloadSHA256':digest(body(uninterrupted))}
    output.write_text(json.dumps(report,indent=2))
