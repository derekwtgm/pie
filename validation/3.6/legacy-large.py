"""Recover a real large 3.5 native JSON envelope through the compatibility path."""
from pathlib import Path as P
import base64,hashlib,json,sys,tempfile,importlib.util
s=importlib.util.spec_from_file_location('stress',P(__file__).resolve().parents[2]/'source/tools/checkpoint_stress36.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
exe,metadata,state,report=map(lambda x:P(x).resolve(),sys.argv[1:5])
with tempfile.TemporaryDirectory() as d:
 root=P(d);(root/'Documents').mkdir();meta=json.loads(metadata.read_text());meta['writer']='3.5'
 with state.open('rb') as f:f.read(8);n=int.from_bytes(f.read(4),'little');head=json.loads(f.read(n));meta['state']['iterations']=head['iterations']
 meta['state']['nativeEMMW4']='NATIVE';a,b=json.dumps(meta,separators=(',',':')).encode().split(b'NATIVE')
 payload=root/'payload';h=hashlib.sha256()
 with payload.open('wb') as out,state.open('rb') as inp:
  out.write(a);h.update(a)
  while chunk:=inp.read(3*65536):v=base64.b64encode(chunk);out.write(v);h.update(v)
  out.write(b);h.update(b)
 env=root/'old.emstudy'
 with env.open('wb') as out,payload.open('rb') as inp:
  out.write(('{"sha256":"'+h.hexdigest()+'","payloadBytes":'+str(payload.stat().st_size)+',"payload":').encode())
  import shutil
  shutil.copyfileobj(inp,out,65536);out.write(b'}')
 with m.host(exe,root) as (port,proc):
  with env.open('rb') as f:code,reply=m.request(port,'checkpoint/write',f)
  assert code==200,(code,reply);got=m.download(port,'latest');assert got==(env.stat().st_size,m.digestfile(env))
  report.write_text(json.dumps({'writer':'3.5','actualTrainedIterations':head['iterations'],'bytes':got[0],'sha256':got[1],'hostPeakBytes':m.hwm(proc.pid),'downloadMatches':True},indent=2))
