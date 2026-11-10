"""Drive real cancellation during native table reconstruction and kill a separate host mid-decode."""
import importlib.util,json,pathlib,sys,tempfile,time
from concurrent.futures import ThreadPoolExecutor
P=pathlib.Path
s=importlib.util.spec_from_file_location('base',P(__file__).with_name('native-continuation.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
exe,big,out=[P(x).resolve() for x in sys.argv[1:4]];small=P(__file__).parent/'fixtures/eight-seat-3.6.emstudy';rows=[]
with tempfile.TemporaryDirectory() as td:
 d=P(td);(d/'Documents').mkdir()
 for action,phase in [('cancel','rebuild tables'),('kill','decompress')]:
  with c.s.host(exe,d) as (port,proc):
   if action=='cancel':
    with small.open('rb') as f:c.check(port,'checkpoint/write',f)
   c.check(port,'checkpoint/native-latest',b'');before=c.check(port,'mw/status')['engine']
   def upload():
    with big.open('rb') as f:return c.s.request(port,'checkpoint/native-upload',f)
   with ThreadPoolExecutor(1) as pool:
    pending=pool.submit(upload);end=time.monotonic()+120
    while True:
     progress=c.check(port,'checkpoint/progress')
     if progress['phase']==phase and progress['active'] and progress['receivedBytes']>0:break
     assert not pending.done() and time.monotonic()<end,progress
     time.sleep(.01)
    if action=='cancel':
     c.check(port,'checkpoint/cancel',b'');assert pending.result()[0]==409;assert c.check(port,'mw/status')['engine']==before
    else:
     proc.kill();proc.wait()
     try:pending.result()
     except OSError:pass
  with c.s.host(exe,d) as (port,proc):
   st=c.check(port,'checkpoint/status');assert st['generation']=='1';c.check(port,'checkpoint/native-latest',b'')
   after=c.check(port,'mw/status')['engine'];assert after['rng']==before['rng'] and after['iterations']==8
   dsave=P(c.check(port,'info')['saveDir']);assert not list(dsave.glob('*.import')) and not list(dsave.glob('*.raw'))
   rows.append(dict(action=action,observedProgress=progress,recoveredGeneration=st['generation'],resumedUpdates=after['iterations'],scratchRemoved=True))
out.write_text(json.dumps(rows,indent=2))
