(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./study-adapter.js'));else root.WorkbenchBenchmark=factory(root.WorkbenchStudy);})(typeof globalThis!=='undefined'?globalThis:this,function(A){
'use strict';
function percentile(xs,p){if(!xs.length)return null;const sorted=xs.slice().sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];}
function summary(rows){const successful=rows.filter(r=>r.ok),latencies=successful.map(r=>r.endToEndMs);return {requests:rows.length,completed:successful.length,failed:rows.length-successful.length,deadlineMisses:rows.filter(r=>r.deadlineMiss).length,updatesComplete:successful.filter(r=>r.stopped==='updates-complete').length,p50Ms:percentile(latencies,.5),p95Ms:percentile(latencies,.95),maxMs:latencies.length?Math.max(...latencies):null,maxQueueMs:successful.length?Math.max(...successful.map(r=>r.queueMs)):null};}
async function run(submit,request,options={}){
 const normalized=A.input(request),counts=options.counts||[1,2,5,10],now=options.now||(()=>performance.now()),check=options.check||(()=>{}),progress=options.progress||(()=>{}),deadlineMs=options.deadlineMs===undefined?10000:options.deadlineMs;
 if(!Array.isArray(counts)||counts.length<1||counts.length>4||counts.some(n=>!Number.isInteger(n)||n<1||n>10)||!Number.isFinite(deadlineMs)||deadlineMs<100||deadlineMs>120000)throw Error('Invalid benchmark settings');
 const rounds=[];for(const count of counts){check();const start=now();const jobs=Array.from({length:count},(_,i)=>{const queued=now();return submit(i+1,{...normalized,deadlineMs}).then(value=>{check();A.validateResult(value);const elapsed=Math.max(0,now()-queued),timing=value.queueTiming||{};return {slot:i+1,ok:elapsed<=deadlineMs,deadlineMiss:elapsed>deadlineMs,endToEndMs:elapsed,queueMs:timing.queueMs||0,runMs:timing.runMs===undefined?elapsed:timing.runMs,updates:value.updates,stopped:value.stopped,strategyMiB:value.diagnostics&&value.diagnostics.strategyMiB};},error=>{check();return {slot:i+1,ok:false,deadlineMiss:/deadline/i.test(error.message),error:error.message};});});
  const rows=await Promise.all(jobs);check();const round={tables:count,burstMs:Math.max(0,now()-start),...summary(rows),rows};rounds.push(round);progress(round);
 }
 return {format:'eightmax-study-benchmark',version:1,engine:A.ENGINE,backend:'javascript-reference-cpu',profile:normalized,deadlineMs,workerConcurrency:options.concurrency||1,rounds,scope:'Fresh off-table CPU study bursts only. No capture, OCR, input execution, network or native/GPU work. One burst per count; not a sustained table-capacity certification.',capacityEstablished:false};
}
return {percentile,summary,run};
});
