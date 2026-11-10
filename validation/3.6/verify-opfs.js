const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright'),{withHost}=require('../../source/tests/checkpoint_host');
process.env.EM_TEST_HOST=path.resolve(process.argv[2]);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'em36web-'));
(async()=>{try{await withHost(profile,{},async(api,url)=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
 try{const page=await browser.newPage();await page.goto(url);
 const r=await page.evaluate(async()=>{
  const blobURL=URL.createObjectURL(new Blob([document.querySelector('#em-lib').textContent+'\n;EM.workerMain(self);'],{type:'text/javascript'}));
  const w=new Worker(blobURL);URL.revokeObjectURL(blobURL);const root=await navigator.storage.getDirectory();
  await root.getFileHandle('eightmax-'+crypto.randomUUID()+'.part',{create:true});
  const job=(type,args={})=>new Promise((resolve,reject)=>{w.onerror=e=>reject(Error(e.message));w.onmessage=({data:m})=>{if(m.type==='result')resolve(m.result);if(m.type==='error')reject(Error(m.message));};w.postMessage({id:1,type,checkpointHost:location.origin,...args});});
  const cfg={board:'Qs9h4d2c7s',common:8,stacks:[18,20],ranges:['AsQd,KhQh,9s9c','QcJc,TdTc,As4s'],bets:'50,a',raises:'',maxBets:1,privateMode:'sampled',abstraction:'exact',traversal:'external',engine:'native',batchDeals:4,evaluationDeals:128};
  const solved=await job('multi-solve',{cfg,maxIter:60,target:0,autosaveSeconds:1,native:{base:location.origin,threads:2}});
  const status=await(await fetch('/api/checkpoint/status')).json();const exp=await job('multi-export',{streamFormat:true});
  const restored=await job('multi-recover'),imported=await job('multi-load',{file:exp.blob}),next=await job('multi-resume',{iterations:8,autosaveSeconds:1,native:{base:location.origin,threads:2}});
  const saved=(await EM.loadStudyFile((await job('multi-export',{streamFormat:true})).blob)).game;
  const reference=EM.MultiwayGame(cfg);reference.iterate(68);
  const left=[];for await(const k of root.keys())if(k.endsWith('.part'))left.push(k);w.terminate();
  return {engine:solved.metrics.trainingEngine.name,iterations:restored.metrics.iterations,imported:imported.metrics.iterations,resumed:next.metrics.iterations,generation:status.generation,size:status.sizeBytes,
   magic:await exp.blob.slice(0,8).text(),orphanParts:left,reference:EM.exactCheckSampled(cfg,reference).gain,resumedGains:EM.exactCheckSampled(cfg,saved).gain};
 });
 assert.equal(r.engine,'native C++');assert.equal(r.iterations,60);assert.equal(r.imported,60);assert.equal(r.resumed,68);assert.equal(r.generation,'1');assert.deepEqual(r.orphanParts,[]);assert.deepEqual(r.reference,r.resumedGains);assert.equal(r.magic,'EMCP36\r\n');
 fs.writeFileSync(process.argv[3],JSON.stringify({passed:true,...r},null,2));}finally{await browser.close();}
});}finally{fs.rmSync(profile,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
