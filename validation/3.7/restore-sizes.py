"""Measure reconstruction of legal but artificial row values separately from trained studies."""
import importlib.util,json,pathlib,sys,tempfile,subprocess,time
P=pathlib.Path
root=P(__file__).resolve().parents[2]
module=importlib.util.spec_from_file_location('transport',root/'source/tools/checkpoint_stress36.py')
s=importlib.util.module_from_spec(module);module.loader.exec_module(s)
exe,out=map(lambda v:P(v).resolve(),sys.argv[1:3])
sizes=list(map(int,sys.argv[3:])) or [128,256,512,1024,2050]
report={'kind':'Synthetic physical row values on a trained 8-seat linked topology. Each successful import reconstructs a live solver, then trains it.','runs':[]}
with tempfile.TemporaryDirectory() as t:
    d=P(t);subprocess.run(['node',str(root/'source/tools/fixture37.js'),str(d)],check=True)
    for size in sizes:
        file,rows=s.fixture(d,size,wide=True)
        profile=d/'profile';(profile/'Documents').mkdir(parents=True,exist_ok=True)
        env={'EIGHTMAX_CHECKPOINT_MIB':'4096','EIGHTMAX_APP_MIB':'8192','EIGHTMAX_PROCESS_MIB':'8192','EIGHTMAX_RESTORE_MIB':'6500'}
        with s.host(exe,profile,env) as (port,proc):
            before=s.hwm(proc.pid);start=time.monotonic()
            with file.open('rb') as f:code,response=s.request(port,'checkpoint/native-upload',f)
            row={'nominalMiB':size,'rawBytes':(d/'large.state').stat().st_size,'wireBytes':file.stat().st_size,'rows':rows,'status':code,'restoreSeconds':round(time.monotonic()-start,3),'peakRestoreMiB':s.hwm(proc.pid)/2**20,'idleMiB':before/2**20,'requestedLimits':env,'memory':json.loads(s.request(port,'memory')[1])}
            if code==200:
                game=json.loads(s.request(port,'mw/status')[1])['engine']
                assert game['rows']==rows and game['iterations']==128
                assert s.request(port,'mw/desktop-train',b'{"iterations":1,"threads":1}')[0]==200
                while True:
                    result=json.loads(s.request(port,'mw/status')[1])
                    if not result['running']:break
                    time.sleep(.03)
                assert result['engine']['iterations']==129 and not result['error'],result
                row.update(restoredUpdates=128,resumedUpdates=129,committedDeals=result['engine']['trainingDeals'],peakAfterTrainingMiB=s.hwm(proc.pid)/2**20)
            else:row['error']=response.decode()
            report['runs'].append(row);out.write_text(json.dumps(report,indent=2));print(size,code,row.get('error',''),flush=True)
            if code!=200:raise RuntimeError(response)
