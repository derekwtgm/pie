"""Exercise packaged worker and real IndexedDB in a persistent Chromium profile."""
import functools,http.server,json,pathlib,sys,tempfile,threading
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[2]
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
httpd=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=root))
threading.Thread(target=httpd.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{httpd.server_port}/EightMax-Offline.html'
config=dict(board='2c4d7h9sJc',common=10,stacks=[15,25,32],ranges=['QhQd:0.8,9c9d','AsAd,KsTh','JhJd,8s8d'],bets='50,100',raises='a',maxBets=2,privateMode='sampled',batchDeals=4,riverStrata=True,evaluationDeals=128)
setup="""() => {
 const url=URL.createObjectURL(new Blob([document.querySelector('#em-lib').textContent+'\\n;EM.workerMain(self);'],{type:'text/javascript'}));
 window.testWorker=new Worker(url);URL.revokeObjectURL(url);
 window.sendJob=(type,args={},interrupt=false)=>new Promise((resolve,reject)=>{
 testWorker.onerror=e=>reject(Error(e.message));testWorker.onmessage=({data:m})=>{
 if(m.type==='error')reject(Error(m.message));else if(m.type==='result')resolve(m.result);
 else if(interrupt&&m.saveStatus?.startsWith('Checkpoint saved')){testWorker.terminate();resolve(m.saveStatus);}
 };testWorker.postMessage({id:1,type,...args});});
}"""
with tempfile.TemporaryDirectory() as profile, sync_playwright() as pw:
    def open_page():
        ctx=pw.chromium.launch_persistent_context(profile,executable_path=sys.argv[1],args=['--no-sandbox','--disable-dev-shm-usage'],headless=True)
        page=ctx.new_page();page.goto(url);page.evaluate(setup);return ctx,page
    ctx,p=open_page()
    status=p.evaluate("cfg=>sendJob('multi-solve',{cfg,maxIter:1000000,target:0,autosaveSeconds:1},true)",config)
    assert isinstance(status,str) and status.startswith('Checkpoint saved'),status
    ctx.close()
    ctx,p=open_page()
    first=p.evaluate("()=>sendJob('multi-recover')");it=first['metrics']['iterations']
    assert 0<it<1000000
    last=p.evaluate("()=>sendJob('multi-resume',{iterations:10,target:0,autosaveSeconds:1})")
    assert last['metrics']['iterations']==it+10 and last['saveStatus'].startswith('Checkpoint saved')
    good=p.evaluate("""async cfg=>{
      const saved=await sendJob('multi-export'),g=EM.MultiwayGame(cfg);
      g.iterate(JSON.parse(saved.text).payload.state.iterations);
      return JSON.stringify(g.snapshot().state)===JSON.stringify(JSON.parse(saved.text).payload.state);
    }""",config)
    assert good,'resumed state differs from uninterrupted training'
    p.evaluate("""()=>new Promise((resolve,reject)=>{
      const r=indexedDB.open('EightMax-training',1);r.onsuccess=()=>{
        const tx=r.result.transaction('checkpoints','readwrite');tx.objectStore('checkpoints').put('bad','latest');
        tx.onabort=()=>{r.result.close();resolve(true)};tx.abort();};})""")
    assert p.evaluate("()=>sendJob('multi-recover')")['metrics']['iterations']==it+10
    p.evaluate("""()=>new Promise(resolve=>{const r=indexedDB.open('EightMax-training',1);r.onsuccess=()=>{
      const tx=r.result.transaction('checkpoints','readwrite');tx.objectStore('checkpoints').put('bad','latest');
      tx.oncomplete=()=>{r.result.close();resolve(true)};};})""")
    assert p.evaluate("()=>sendJob('multi-recover')")['metrics']['iterations']==it
    ctx.close()
print(json.dumps({'passed':True,'periodicSaveAt':it,'workerTerminated':True,'browserRestart':True,'resumedBitIdentically':True,'abortedWritePreserved':True,'corruptLatestRecoveredPrevious':True}))
