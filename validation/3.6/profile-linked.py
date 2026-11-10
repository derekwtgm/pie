"""Interleaved, matched-work native profile. Supply the three original CLIs and the spec directory from EM_SPEC_DIR."""
import hashlib,json,os,pathlib,random,statistics,subprocess,sys,tempfile,time
clis=sys.argv[1:4];specs=pathlib.Path(sys.argv[4]);out=pathlib.Path(sys.argv[5]);runs=[]
with tempfile.TemporaryDirectory() as tmp:
 for run in range(9):
  order=list(enumerate(clis));random.Random(121+run).shuffle(order)
  seed=1+run%3;spec=specs/f'{seed}.json'
  for i,cli in order:
   if cli=='-':continue
   state=pathlib.Path(tmp)/'state';start=time.perf_counter()
   r=json.loads(subprocess.check_output([cli,str(spec),'80','4',str(state),'2048']))
   elapsed=time.perf_counter()-start;data=state.read_bytes()
   runs.append(dict(version=['3.4','3.5','3.6'][i],run=run,seed=seed,specSHA=hashlib.sha256(spec.read_bytes()).hexdigest(),
     trainingMs=1000*r['wallSeconds'],processMs=1000*elapsed,profile=r['seconds'],rssMiB=r.get('processPeakRssMiB'),threads=r['threads'],visits=r['stateVisits'],stateSHA=hashlib.sha256(data).hexdigest()))
out.write_text(json.dumps({'updates':80,'batchDeals':16,'requestedThreads':4,'tableLimitMiB':2048,'runs':runs},indent=2))
for i in range(3):
 v=['3.4','3.5','3.6'][i];x=[r['trainingMs'] for r in runs if r['version']==v]
 if x:print(v,statistics.median(x),min(x),max(x))
