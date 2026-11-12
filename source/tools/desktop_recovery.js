'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),{Worker}=require('node:worker_threads'),assert=require('node:assert/strict');
const source=path.resolve(__dirname,'..'),hostExe=path.resolve(process.argv[2]),result=process.argv[3];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eightmax-recover-'));
const config={board:'2c4d7h9sJc',common:10,stacks:[15,25,32],ranges:['QhQd:0.8,9c9d','AsAd,KsTh','JhJd,8s8d'],bets:'50,100',raises:'a',maxBets:2,privateMode:'sampled',batchDeals:4,riverStrata:true,evaluationDeals:128};
let proc,worker,origin;
async function startHost(){
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 origin='http://127.0.0.1:'+port;
 proc=spawn(hostExe,['--no-browser','--port='+port],{env:{...process.env,HOME:dir,USERPROFILE:dir,EIGHTMAX_THREADS:'2',EIGHTMAX_GPU:'off'},stdio:'ignore'});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/info')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
 throw Error('Host failed to start');
}
function makeWorker(){
 worker=new Worker("const {parentPort,workerData}=require('node:worker_threads');const E=require(workerData+'/tools/loadlib');for(const l of ['lib_runouts','lib_wide','lib_river','lib_archive','lib_select','worker'])require(workerData+'/web/'+l);const self={postMessage:m=>parentPort.postMessage(m)};E.workerMain(self);parentPort.on('message',data=>self.onmessage({data}));",{eval:true,workerData:source});
}
async function job(type,args,interrupt=false){
 return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(reject,Error('Worker timeout')),60000);
  function finish(fn,value){clearTimeout(timer);worker.off('message',onMessage);worker.off('error',onError);fn(value);}
  function onError(e){finish(reject,e);}
  function onMessage(m){
   if(m.type==='error')finish(reject,Error(m.message));
   else if(m.type==='result')finish(resolve,m.result);
   else if(interrupt&&m.saveStatus?.startsWith('Checkpoint saved'))finish(resolve,m.saveStatus);
  }
  worker.on('message',onMessage);worker.once('error',onError);worker.postMessage({type,id:1,checkpointHost:origin,...args});
 });
}
async function killHost(){if(proc&&proc.exitCode===null){await new Promise(r=>{proc.once('exit',r);proc.kill('SIGKILL');});}proc=null;}
(async()=>{try{
 await startHost();makeWorker();
 const first=await job('multi-solve',{cfg:config,maxIter:1000000,target:0,autosaveSeconds:1},true);
 assert.equal(typeof first,'string');await worker.terminate();await killHost();
 await startHost();makeWorker();
 const back=await job('multi-recover',{}),it=back.metrics.iterations;
 assert.ok(it>0&&it<1000000);
 const more=await job('multi-resume',{iterations:11,autosaveSeconds:1});assert.equal(more.metrics.iterations,it+11);
 const exported=await job('multi-export',{}),E=require('../tools/loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
 const reference=E.MultiwayGame(config);reference.iterate(it+11);assert.deepEqual(reference.snapshot().state,JSON.parse(exported.text).payload.state);
 const info=await(await fetch(origin+'/api/info')).json();
 const slot=Number(fs.readFileSync(path.join(info.saveDir,'autosave.index'),'utf8')[0]);
 fs.writeFileSync(path.join(info.saveDir,'autosave.'+slot+'.em35'),'corrupt');
 assert.equal((await job('multi-recover',{})).metrics.iterations,it);
 const bad=await fetch(origin+'/api/checkpoint/write',{method:'POST',body:'bad',headers:{'X-EightMax':'1'}});assert.equal(bad.status,400);
 fs.writeFileSync(result,JSON.stringify({passed:true,runtime:process.platform,periodicSaveAt:it,hostAndWorkerKilled:true,resumeEquivalent:true,corruptLatestRecoveredPrevious:true},null,2));
}finally{if(worker)await worker.terminate();await killHost();fs.rmSync(dir,{recursive:true,force:true});}})().catch(err=>{console.error(err);process.exitCode=1;});
