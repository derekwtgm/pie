"""Commit and download one large EMCP36 generation, corrupt its index, start a fresh host, reopen and train."""
import importlib.util,json,os,pathlib,shutil,subprocess,sys,tempfile,time
P=pathlib.Path;root=P(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('continuation',P(__file__).with_name('native-continuation.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
exe=P(sys.argv[1]).resolve();out=P(sys.argv[2]);size=int(sys.argv[3]) if len(sys.argv)>3 else 2050
tmpbase=out.resolve().parent if len(sys.argv)<5 else P(sys.argv[4]).resolve()
required=size*1048576*7+150*1048576
if shutil.disk_usage(tmpbase).free<required:raise RuntimeError(f'Need {required} free bytes in test working directory {tmpbase}')
policy={'EIGHTMAX_CHECKPOINT_MIB':'4096','EIGHTMAX_APP_MIB':'8192','EIGHTMAX_PROCESS_MIB':'8192','EIGHTMAX_RESTORE_MIB':'6500'}
with tempfile.TemporaryDirectory(dir=tmpbase) as td:
 d=P(td);profile=d/'profile';(profile/'Documents').mkdir(parents=True)
 subprocess.run(['node',root/'source/tools/fixture37.js',d],check=True);f,rows=c.s.fixture(d,size,wide=True)
 digest=c.s.digestfile(f);n=f.stat().st_size;(d/'large.state').unlink()
 with c.s.host(exe,profile,policy) as (port,proc):
  start=time.monotonic()
  with f.open('rb') as stream:c.check(port,'checkpoint/write',stream)
  save=time.monotonic()-start;peak=c.s.hwm(proc.pid);start=time.monotonic()
  assert c.s.download(port,'latest')==(n,digest);download=time.monotonic()-start;where=P(c.check(port,'info')['saveDir'])
 (where/'autosave.index').write_bytes(b'bad index')
 with c.s.host(exe,profile,policy) as (port,proc):
  start=time.monotonic();c.check(port,'checkpoint/native-latest',b'');cold=time.monotonic()-start;hwm=c.s.hwm(proc.pid)
  s=c.check(port,'mw/status')['engine'];assert s['rows']==rows and s['iterations']==128
  c.check(port,'mw/desktop-train',b'{"iterations":1,"threads":1}')
  while (s:=c.check(port,'mw/status'))['running']:time.sleep(.05)
  assert s['engine']['iterations']==129 and not s['error']
  st=c.check(port,'checkpoint/status');assert st['generation']=='1'
 out.write_text(json.dumps(dict(kind='Synthetic rows on legal topology, full generation save, stream download, corrupted index and cold native continuation',nominalMiB=size,rows=rows,wireBytes=n,sha256=digest,saveSeconds=save,downloadSeconds=download,coldIndexAndRestoreSeconds=cold,savePeakProcessMiB=peak/2**20,restorePeakProcessMiB=hwm/2**20,generation=st['generation'],resumedUpdates=129,policy=policy),indent=2))
