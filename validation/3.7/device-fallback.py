import hashlib,json,pathlib,struct,sys,subprocess,tempfile,time
P=pathlib.Path;root=P(__file__).resolve().parents[2];cli=P(sys.argv[1]).resolve();out=P(sys.argv[2])
cfg=json.loads((root/'source/tests/fixtures/es-six-weighted.json').read_text());cfg['batchDeals']=64;rows=[]
with tempfile.TemporaryDirectory() as td:
 d=P(td);spec=d/'spec';raw=d/'state'
 for mode in ['cpu','auto','gpu','hybrid']:
  cfg['device']=mode;spec.write_text(json.dumps(cfg));start=time.monotonic()
  r=json.loads(subprocess.check_output([cli,spec,'40','4',raw,'512']));wall=time.monotonic()-start
  with raw.open('rb') as f:
   assert f.read(8)==b'EMMW4\0\0\0';h=json.loads(f.read(struct.unpack('<I',f.read(4))[0]));digest=hashlib.file_digest(f,'sha256').hexdigest()
  counters={k:h[k] for k in ['iterations','trainingDeals','stateVisits','rng','actionRng']}
  if rows:assert rows[0]['bodySHA256']==digest and rows[0]['counters']==counters
  rows.append(dict(mode=mode,actualPath=r['devicePath'],trainingSeconds=r['wallSeconds'],processWallSeconds=wall,peakRssMiB=r['processPeakRssMiB'],gpuBufferPeakBytes=r['gpuBufferPeakBytes'],bodySHA256=digest,counters=counters))
out.write_text(json.dumps(dict(probe=json.loads(subprocess.check_output([cli,'--cuda-info'])),runs=rows),indent=2))
