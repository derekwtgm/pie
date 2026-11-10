"""Two hosts share a save directory, with separate simultaneous large uploads."""
import concurrent.futures,importlib.util,json,pathlib,sys,tempfile,threading
P=pathlib.Path
s=importlib.util.spec_from_file_location('stress',P(__file__).resolve().parents[2]/'source/tools/checkpoint_stress36.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
exe,small,old,modern,out=[P(x).resolve() for x in sys.argv[1:]]
with tempfile.TemporaryDirectory() as tmp:
 d=P(tmp);(d/'Documents').mkdir()
 with m.host(exe,d) as (a,_),m.host(exe,d) as (b,_):
  with small.open('rb') as f:assert m.request(a,'checkpoint/write',f)[0]==200
  pairs=[(a,old),(b,modern)];gate=threading.Barrier(2)
  def save(port,file):
   with file.open('rb') as f:
    gate.wait();return m.request(port,'checkpoint/write',f,file==modern)[0]
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   futures=[pool.submit(save,*x) for x in pairs];codes=[future.result() for future in futures]
  for code,(port,file) in zip(codes,pairs):
   if code==503:
    with file.open('rb') as f:assert m.request(port,'checkpoint/write',f)[0]==200
   else:assert code==200,codes
  st=json.loads(m.request(a,'checkpoint/status')[1]);assert st['generation']=='3'
  store=P(json.loads(m.request(a,'info')[1])['saveDir'])
  def hashes():return {p.name:m.digestfile(p) for p in store.iterdir() if p.name.endswith('.em35') or p.name=='autosave.index'}
  before=hashes();expected={m.digestfile(old),m.digestfile(modern)}
  assert {m.download(a,'latest')[1],m.download(b,'previous')[1]}==expected
 with m.host(exe,d,{'EIGHTMAX_CHECKPOINT_RESERVE_MIB':'1048576'}) as (port,_):
  refused=m.request(port,'checkpoint/write',b'{}')[0];assert refused==507
  assert before==hashes()
 with m.host(exe,d) as (port,_):
  st=json.loads(m.request(port,'checkpoint/status')[1]);assert st['generation']=='3'
  assert {m.download(port,'latest')[1],m.download(port,'previous')[1]}==expected
  assert before==hashes()
 out.write_text(json.dumps({'passed':True,'simultaneousWireBytes':[old.stat().st_size,modern.stat().st_size],'initialCodes':codes,'generation':st['generation'],'pressureCode':refused,'everyExistingSlotAndIndexUnchanged':True,'recoveredHashes':sorted(expected)},indent=2))
