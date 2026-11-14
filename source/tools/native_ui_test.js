'use strict';
// Real-browser test of native multiway training through the worker (desktop mode).
// Usage: node tools/native_ui_test.js <native host executable> [report.json]
// Opens the host's own page in Chromium, runs a multiway solve in the page's
// worker with native training enabled, and checks: the result says the native
// engine trained it, the training state equals JavaScript training of the same
// study in the same page, stop works, and an ineligible study falls back to
// JavaScript with the reason recorded.
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),{spawn}=require('child_process'),{chromium}=require('playwright');
const exe=path.resolve(process.argv[2]),reportFile=process.argv[3],viaWine=exe.toLowerCase().endsWith('.exe')&&process.platform!=='win32';
const checks=[],pass=m=>{checks.push(m);console.log('PASS  '+m);};
(async()=>{
  const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'em-ui-')),env={...process.env,HOME:home,USERPROFILE:home,EIGHTMAX_GPU:'off',WINEDEBUG:'-all'};
  const host=viaWine?spawn('wine',[exe,'--no-browser','--port='+port],{env,stdio:'ignore'}):spawn(exe,['--no-browser','--port='+port],{env,stdio:'ignore'});
  let browser,failure=null;
  try{
    for(let i=0;i<600;i++){try{await fetch('http://127.0.0.1:'+port+'/api/info');break;}catch(e){await new Promise(r=>setTimeout(r,100));}}
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
    const page=await browser.newPage();await page.goto('http://127.0.0.1:'+port+'/');
    await page.evaluate(()=>{
      const url=URL.createObjectURL(new Blob([document.querySelector('#em-lib').textContent+'\n;EM.workerMain(self);'],{type:'text/javascript'}));
      window.W=new Worker(url);
      window.job=(type,args,onProgress)=>new Promise((resolve,reject)=>{W.onmessage=({data:m})=>{if(m.id!==1)return;if(m.type==='error')reject(Error(m.message));else if(m.type==='result')resolve(m.result);else if(onProgress)onProgress(m);};W.postMessage({id:1,type,...args});});
    });
    const cfg={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
      streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',engine:'native',batchDeals:4,evaluationDeals:256,privateSeed:4};
    const r=await page.evaluate(async cfg=>{
      let progress=0,engine=null;
      const res=await job('multi-solve',{cfg,maxIter:20000,target:0,native:{base:location.origin,threads:4}},m=>{progress++;if(m.engine)engine=m.engine;});
      const ref=EM.MultiwayGame(cfg);ref.iterate(20000);const rm=ref.metrics(256);
      return {engine:res.metrics.trainingEngine,progress,progressEngine:engine,ev:res.metrics.ev,refEv:rm.ev,iterations:res.metrics.iterations,deals:res.metrics.trainingDeals,checkpoints:res.checkpoints.length};
    },cfg);
    if(!r.engine||r.engine.name!=='native C++')throw Error('not trained natively: '+JSON.stringify(r.engine));
    if(JSON.stringify(r.ev)!==JSON.stringify(r.refEv))throw Error('native EV differs from JavaScript: '+JSON.stringify([r.ev,r.refEv]));
    pass(`Worker trained 20,000 updates (${r.deals} deals) in the native engine (${r.engine.threads} threads, ${r.engine.seconds.toFixed(2)} s native); EVs equal page-side JavaScript training exactly; ${r.progress} progress messages, ${r.checkpoints} diagnostics checkpoints`);
    const s=await page.evaluate(async cfg=>{
      const p=job('multi-solve',{cfg,maxIter:1000000,target:0,native:{base:location.origin,threads:2}});
      await new Promise(r=>setTimeout(r,1500));const t=performance.now();W.postMessage({id:2,type:'multi-stop'});
      const res=await p;return {reason:res.reason,iterations:res.metrics.iterations,ms:performance.now()-t};
    },cfg);
    if(s.reason!=='stopped'||!(s.iterations>0&&s.iterations<1000000))throw Error('stop failed '+JSON.stringify(s));
    pass(`Stop from the interface ends native training after ${s.iterations} updates and returns the trained strategy (${s.ms.toFixed(0)} ms)`);
    const f=await page.evaluate(async cfg=>{const res=await job('multi-solve',{cfg:{...cfg,abstraction:'detailed'},maxIter:2000,target:0,native:{base:location.origin,threads:2}});return res.metrics.trainingEngine;},cfg);
    if(f.name!=='native C++')throw Error('Detailed native traversal unavailable');
    pass('Detailed grouped river study used native C++');
    const back=await page.evaluate(async cfg=>{
      const res=await job('multi-solve',{cfg,maxIter:200,target:0,native:{base:location.origin+'/unavailable',threads:2}});
      const ref=EM.MultiwayGame(cfg);ref.iterate(200);
      return {engine:res.metrics.trainingEngine,ev:res.metrics.ev,ref:ref.metrics().ev};
    },cfg);
    if(back.engine.name!=='JavaScript'||!back.engine.fallbackReason||JSON.stringify(back.ev)!==JSON.stringify(back.ref))throw Error('Native fallback failed');
    pass('Unavailable native route reported the reason and reproduced JavaScript EVs');
  }catch(e){failure=e.stack||String(e);console.log('FAIL  '+failure);}
  finally{if(browser)await browser.close();host.kill('SIGKILL');fs.rmSync(home,{recursive:true,force:true});
    if(reportFile)fs.writeFileSync(reportFile,JSON.stringify({passed:!failure,runtime:viaWine?'wine (not Windows)':process.platform,checks,error:failure,generated:new Date().toISOString()},null,1)+'\n');
    process.exitCode=failure?1:0;}
})();
