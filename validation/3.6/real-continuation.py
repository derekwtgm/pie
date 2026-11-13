"""Cold restore and deterministic continuation of an actual eight-seat linked calculation."""
import hashlib,json,sys,tempfile,time,pathlib,subprocess,importlib.util
P=pathlib.Path
module=importlib.util.spec_from_file_location('stress',P(__file__).resolve().parents[2]/'source/tools/checkpoint_stress36.py')
s=importlib.util.module_from_spec(module);module.loader.exec_module(s)
host,cli,fixture,work,report=map(lambda x:P(x).resolve(),sys.argv[1:6])
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
with tempfile.TemporaryDirectory() as t:
 profile=P(t);(profile/'Documents').mkdir()
 with s.host(host,profile) as (port,proc):
  with (fixture/'small.emstudy').open('rb') as f:assert s.request(port,'checkpoint/write',f)[0]==200
  start=time.monotonic()
  with (work/'real.emstudy').open('rb') as f:
   code,data=s.request(port,'checkpoint/write',f);assert code==200,(code,data)
  save=time.monotonic()-start;peak=s.hwm(proc.pid)
  sd=P(json.loads(s.request(port,'info')[1])['saveDir']);(sd/'autosave.index').unlink()
 with s.host(host,profile) as (port,proc):
  start=time.monotonic();status=json.loads(s.request(port,'checkpoint/status')[1]);assert status['reconstructed'] and status['generation']=='2'
  import http.client
  h=http.client.HTTPConnection('127.0.0.1',port,timeout=1200);h.request('GET','/api/checkpoint/latest');resp=h.getresponse();assert resp.status==200
  with (work/'recovered.emstudy').open('wb') as out:
   while chunk:=resp.read(65536):out.write(chunk)
  assert sha(work/'recovered.emstudy')==sha(work/'real.emstudy')
  cold=time.monotonic()-start;readpeak=s.hwm(proc.pid)
 # Recover the actual browser strategy with the shipping streaming deserializer.
 start=time.monotonic()
 js="""const fs=require('fs'),E=require('./source/tools/loadlib');for(const l of ['lib_wide','lib_river','lib_runouts','lib_archive'])require('./source/web/'+l);
 (async()=>{const src=await fs.openAsBlob(process.argv[1]);const g=(await E.loadStudyFile(src)).game;
 fs.writeFileSync(process.argv[2],g.exportNative(true));console.log(JSON.stringify({iterations:g.iterations,trainingDeals:g.trainingDeals,rssKiB:process.resourceUsage().maxRSS}));})().catch(e=>{console.error(e);process.exitCode=1;});"""
 browser=json.loads(subprocess.check_output(['node','--max-old-space-size=6144','-e',js,str(work/'recovered.emstudy'),str(work/'decoded')]))
 deserialize=time.monotonic()-start;assert sha(work/'decoded')==sha(work/'state')
 spec=fixture/'spec.json';a=json.loads(subprocess.check_output([str(cli),str(spec),'7','2',str(work/'resumed'),'1536',str(work/'decoded')]))
 b=json.loads(subprocess.check_output([str(cli),str(spec),str(browser['iterations']+7),'2',str(work/'direct'),'1536']))
 assert sha(work/'resumed')==sha(work/'direct')
 report.write_text(json.dumps({'kind':'Engine-trained eight-seat linked, physical hands, CPU; cold restart after missing index','input':json.loads((work/'status.json').read_text()),'saveSeconds':save,'hostSavePeakBytes':peak,'coldIndexRepairPlusDownloadSeconds':cold,'recoveryHostPeakBytes':readpeak,'archiveBytes':(work/'real.emstudy').stat().st_size,'archiveSHA256':sha(work/'real.emstudy'),'rawSHA256':sha(work/'state'),'workerLogicInNode':browser,'deserializeAndExportSeconds':deserialize,'resumedSHA256':sha(work/'resumed'),'directSHA256':sha(work/'direct'),'continuation':a,'uninterrupted':b},indent=2))
