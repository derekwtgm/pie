"""Run fresh Linux processes on a genuine trained state, compare bytes and measure whole-process I/O and memory."""
import hashlib,json,os,pathlib,resource,subprocess,sys,tempfile,time
P=pathlib.Path;root=P(__file__).resolve().parents[2]
oldsrc,oldcli,newcli,raw,out=[P(s).resolve() for s in sys.argv[1:6]];meta=root/'validation/3.6/linked-fixture/meta.json';spec=meta.parent/'spec.json'
report={'description':'Same trained EMMW4 input and 3.6 archive metadata for both writers. CLI import + 1 update + atomic raw export. Child CPU time includes user and kernel time.','rawBytes':raw.stat().st_size,'rows':[]}
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
with tempfile.TemporaryDirectory() as td:
 d=P(td)
 for v,source,cli in [('3.6',oldsrc,oldcli),('3.7',root/'source',newcli)]:
  arc=d/'state.emstudy';dst=d/'resumed';encoder=json.loads(subprocess.check_output(['node',source/'tools/checkpoint_encode36.js',meta,raw,arc]));a=resource.getrusage(resource.RUSAGE_CHILDREN);t=time.monotonic()
  r=json.loads(subprocess.check_output([cli,spec,'1','2',dst,'4096',raw]));elapsed=time.monotonic()-t;b=resource.getrusage(resource.RUSAGE_CHILDREN)
  row={'version':v,'encoder':encoder,'archiveSha256':digest(arc),'continuedSha256':digest(dst),'restoreTrainAndSaveSeconds':elapsed,'restoreTrainAndSaveCpuSeconds':b.ru_utime+b.ru_stime-a.ru_utime-a.ru_stime,'cliPeakRssMiB':r['processPeakRssMiB'],'deals':r['trainingDeals']}
  report['rows'].append(row)
 assert report['rows'][0]['archiveSha256']==report['rows'][1]['archiveSha256']
 assert report['rows'][0]['continuedSha256']==report['rows'][1]['continuedSha256']
 out.write_text(json.dumps(report,indent=2))
