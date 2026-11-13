"""Compare each live HTTP continuation and every CLI state byte with its uninterrupted trained oracle."""
import importlib.util,json,pathlib,struct,subprocess,sys,tempfile,time
P=pathlib.Path;root=P(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('common',P(__file__).with_name('native-continuation.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
exe,cli,series,out=[P(x).resolve() for x in sys.argv[1:5]]
spec=root/'validation/3.6/linked-fixture/spec.json';meta=json.loads((spec.parent/'meta.json').read_text())
report={'kind':'Genuinely trained eight-seat linked external-sampling checkpoints, each compared to the next uninterrupted update.','runs':[]}
def header(p):
 with p.open('rb') as f:
  assert f.read(8)==b'EMMW4\0\0\0';return json.loads(f.read(struct.unpack('<I',f.read(4))[0]))
with tempfile.TemporaryDirectory() as td:
 d=P(td);profile=d/'profile';(profile/'Documents').mkdir(parents=True)
 for t in sorted(int(p.stem) for p in series.glob('*.next')):
  raw=series/(str(t)+'.state');oracle=series/(str(t)+'.next');a=header(raw);after=header(oracle);meta['state']['iterations']=a['iterations']
  archive=d/'file.emstudy';c.encode(meta,raw,archive);output=d/'resumed';start=time.monotonic()
  m=json.loads(subprocess.check_output([cli,spec,'1','2',output,'6500',raw]));elapsed=time.monotonic()-start
  sha=c.s.digestfile(output);assert sha==c.s.digestfile(oracle);output.unlink()
  env={'EIGHTMAX_APP_MIB':'8192','EIGHTMAX_PROCESS_MIB':'8192','EIGHTMAX_RESTORE_MIB':'6500','EIGHTMAX_CHECKPOINT_MIB':'4096'}
  with c.s.host(exe,profile,env) as (port,proc):
   start=time.monotonic()
   with archive.open('rb') as f:c.check(port,'checkpoint/native-upload',f)
   seconds=time.monotonic()-start;rss=c.s.hwm(proc.pid)/2**20;c.check(port,'mw/desktop-train',b'{"iterations":1,"threads":2}')
   while (info:=c.check(port,'mw/status'))['running']:time.sleep(.05)
   engine=info['engine'];assert not info['error'] and engine['rows']==m['rows']
   for k in ['iterations','trainingDeals','stateVisits','rng','actionRng']:assert engine[k]==after[k],k
  report['runs'].append(dict(targetMiB=t,rawBytes=raw.stat().st_size,archiveBytes=archive.stat().st_size,completedUpdates=a['iterations'],sampledDeals=a['trainingDeals'],httpRestoreSeconds=seconds,hostPeakRestoreMiB=rss,cliRestoreTrainAndSaveSeconds=elapsed,cliProcessPeakMiB=m['processPeakRssMiB'],fullResumedAndUninterruptedSHA256=sha,resumedCounters={k:engine[k] for k in ['iterations','trainingDeals','stateVisits','rng','actionRng','rows']}))
  out.write_text(json.dumps(report,indent=2));print(t,sha,flush=True)
