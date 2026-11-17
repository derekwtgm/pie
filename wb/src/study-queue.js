/* Bounded off-table worker pool. At most two CPU workers and ten unique study slots. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkbenchStudyQueue=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
class Queue {
 constructor(makeWorker,options={}){this.makeWorker=makeWorker;this.jobs=new Map();this.waiting=[];this.generations=new Map();this.serial=0;this.concurrency=options.concurrency===undefined?1:options.concurrency;if(!Number.isInteger(this.concurrency)||this.concurrency<1||this.concurrency>2)throw Error('Use one or two CPU workers');this.now=options.now||(()=>performance.now());this.setTimer=options.setTimer||setTimeout;this.clearTimer=options.clearTimer||clearTimeout;this.notify=options.notify||(()=>{});}
 get active(){return this.jobs.values().next().value||null;}
 submit(slot,request,mode='solve'){
  if(!Number.isInteger(slot)||slot<1||slot>10)return Promise.reject(Error('Study slot must be 1 to 10'));
  if(request.deadlineMs!==undefined&&(!Number.isFinite(request.deadlineMs)||request.deadlineMs<1||request.deadlineMs>120000))return Promise.reject(Error('Deadline must be 1 to 120,000 ms'));
  const {cpuCheckpoint,...plain}=request,cloned=JSON.parse(JSON.stringify(plain));
  if(cpuCheckpoint!==undefined){if(!cpuCheckpoint||!ArrayBuffer.isView(cpuCheckpoint.bytes)||cpuCheckpoint.bytes.BYTES_PER_ELEMENT!==1||cpuCheckpoint.bytes.byteLength>48*1048576)return Promise.reject(Error('Invalid or oversized CPU checkpoint request'));cloned.cpuCheckpoint={meta:JSON.parse(JSON.stringify(cpuCheckpoint.meta)),bytes:new Uint8Array(cpuCheckpoint.bytes.buffer,cpuCheckpoint.bytes.byteOffset,cpuCheckpoint.bytes.byteLength).slice()};}
  this.cancel(slot,'Superseded by a new study');const generation=(this.generations.get(slot)||0)+1;this.generations.set(slot,generation);
  return new Promise((resolve,reject)=>{this.waiting.push({id:++this.serial,slot,generation,request:cloned,mode,resolve,reject,submittedAt:this.now()});this.notify({kind:'queued',slot});this.pump();});
 }
 pump(){while(this.jobs.size<this.concurrency&&this.waiting.length){const job=this.waiting.shift(),startedAt=this.now(),queueMs=Math.max(0,startedAt-job.submittedAt),remaining=job.request.deadlineMs===undefined?Infinity:job.request.deadlineMs-queueMs;
  if(remaining<=0){job.reject(Error('Study end-to-end deadline expired in queue'));continue;}
  let worker;try{worker=this.makeWorker();}catch(e){job.reject(e);continue;}const current={...job,worker,timer:null,startedAt,queueMs};this.jobs.set(job.id,current);
  const finish=(error,value)=>{if(this.jobs.get(job.id)!==current)return;this.clearTimer(current.timer);worker.terminate();this.jobs.delete(job.id);const end=this.now(),timing={queueMs:current.queueMs,runMs:Math.max(0,end-current.startedAt),endToEndMs:Math.max(0,end-current.submittedAt)};
   if(!error&&job.request.deadlineMs!==undefined&&timing.endToEndMs>job.request.deadlineMs)error=Error('Study end-to-end deadline exceeded');
   if(this.generations.get(job.slot)!==job.generation)job.reject(Error('Stale study response'));else if(error)job.reject(error);else{if(value&&typeof value==='object')value.queueTiming=timing;job.resolve(value);}this.notify({kind:'finished',slot:job.slot,id:job.id,timing,error:error?error.message:null});this.pump();};
  worker.onmessage=e=>{if(this.jobs.get(job.id)!==current||e.data.id!==job.id)return;const d=e.data;if(d.kind==='progress')this.notify({...d,slot:job.slot});else if(d.kind==='error')finish(Error(d.message));else if(d.kind==='result'||d.kind==='native-job')finish(null,d.value);};
  worker.onerror=e=>finish(Error(e.message||'Study worker failed'));
  const timeout=Math.min(30000,(job.request.timeMs||3000)+8000,remaining);current.timer=this.setTimer(()=>finish(Error('Study exceeded its deadline; worker stopped')),timeout);
  this.notify({kind:'started',slot:job.slot});try{worker.postMessage({id:job.id,request:job.request,mode:job.mode});}catch(e){finish(e);}
 }}
 cancel(slot,reason='Study cancelled'){
  this.generations.set(slot,(this.generations.get(slot)||0)+1);this.waiting=this.waiting.filter(j=>{if(j.slot!==slot)return true;j.reject(Error(reason));return false;});
  for(const [id,j] of this.jobs)if(j.slot===slot){this.clearTimer(j.timer);j.worker.terminate();this.jobs.delete(id);j.reject(Error(reason));}this.pump();
 }
 cancelAll(){const pending=this.waiting.splice(0);pending.forEach(j=>j.reject(Error('All studies cancelled')));for(const j of this.jobs.values()){this.clearTimer(j.timer);j.worker.terminate();j.reject(Error('All studies cancelled'));}this.jobs.clear();}
}
return {Queue};
});
