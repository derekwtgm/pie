/* Local desktop protocol. Credentials/process references never enter study backups. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./study-adapter.js'),require('./native-jobs.js'));else root.WorkbenchDesktop=factory(root.WorkbenchStudy,root.WorkbenchNative);})(typeof globalThis!=='undefined'?globalThis:this,function(A,N){
'use strict';
const ORIGIN='http://127.0.0.1:48713',STAGES=['starting','restoring','training','querying','complete','cancelled','failed'],MAX_REVISION=256;
const ok=(v,m)=>{if(!v)throw Error(m);},equal=(a,b)=>A.canonical(a)===A.canonical(b);
const revision=s=>s.version===2?s.revision:null;
function status(value,job,id=null,expectedRevision=null){
 const s=JSON.parse(JSON.stringify(value));ok(s&&s.format==='eightmax-desktop-job'&&[1,2].includes(s.version)&&typeof s.id==='string'&&/^[a-f0-9]{32}$/.test(s.id)&&(!id||s.id===id),'Wrong desktop job identity');
 if(s.version===2)ok(Number.isSafeInteger(s.revision)&&s.revision>=1&&s.revision<=MAX_REVISION,'Invalid desktop attempt revision');
 if(expectedRevision!==null)ok(s.version===2&&s.revision===expectedRevision,'Desktop attempt changed; find the current managed study');
 ok(STAGES.includes(s.stage)&&typeof s.running==='boolean'&&typeof s.resumable==='boolean'&&typeof s.resultAvailable==='boolean'&&typeof s.message==='string'&&s.message.length<=2000,'Invalid desktop status');
 ok(equal(s.binding,job.workbench)&&s.targetUpdates===job.iterations,'Desktop job belongs to a different study binding/target');
 ok(s.resultAvailable===(s.stage==='complete')&&s.running===['starting','restoring','training','querying'].includes(s.stage)&&(!s.resumable||['cancelled','failed'].includes(s.stage)),'Contradictory desktop job state');
 if(s.nativeStatus!==null){s.nativeStatus=N.status(s.nativeStatus);ok(s.nativeStatus.id===job.id&&s.nativeStatus.targetUpdates===job.iterations&&equal(s.nativeStatus.workbench,job.workbench),'Native status belongs to another job');}return s;
}
function current(value){
 ok(value&&value.format==='eightmax-desktop-current'&&value.version===1&&Object.keys(value).length===4,'Unsupported desktop recovery record');
 if(value.job===null||value.status===null){ok(value.job===null&&value.status===null,'Incomplete desktop recovery record');return null;}
 const job=N.job(value.job);ok(job.workbench,'Recovered native job has no study binding');return {job,status:status(value.status,job)};
}
class Client {
 constructor({origin=ORIGIN,token,fetch:fetcher,delay=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now(),timeoutMs=180000}={}){
  ok(origin===ORIGIN&&typeof token==='string'&&/^[a-f0-9]{64}$/.test(token),'Invalid local desktop session');ok(typeof fetcher==='function','Desktop fetch is unavailable');
  this.origin=origin;this.fetcher=fetcher;this.delay=delay;this.now=now;this.timeout=timeoutMs;this.secret=token;this.task=null;this.last=null;this.observed=null;this.unknown=null;this.connected=false;this.capabilities={};
 }
 get busy(){return !!(this.task||this.unknown||this.last?.status.running||this.observed?.status.running);}
 async call(path,method='GET',data,attempt=null){
  ok(/^\/api\/(desktop\/(health|shutdown)|native\/(current|cancel-intent|history(?:\/import|\/[a-f0-9]{32}(?:\/open)?)?|batch(?:\/[a-f0-9]{32}\/cancel)?|jobs(?:\/[a-f0-9]{32}(?:\/(cancel|resume|result))?)?))$/.test(path),'Unknown desktop route');
  const body=data===undefined?undefined:JSON.stringify(data);if(body!==undefined)ok(new TextEncoder().encode(body).length<=1000000,'Native job exceeds 1 MB');
  if(attempt!==null)ok(Number.isSafeInteger(attempt)&&attempt>=1&&attempt<=MAX_REVISION,'Invalid desktop attempt revision');
  const abort=typeof AbortController==='function'?new AbortController():null,timer=abort?setTimeout(()=>abort.abort(),10000):null;
  try{const r=await this.fetcher(this.origin+path,{method,headers:{'X-EightMax-Session':this.secret,...(body===undefined?{}:{'Content-Type':'application/json'}),...(attempt===null?{}:{'X-EightMax-Revision':String(attempt)})},body,credentials:'omit',cache:'no-store',mode:'same-origin',redirect:'error',...(abort?{signal:abort.signal}:{})});
   const length=Number(r.headers?.get('content-length'));ok(!Number.isFinite(length)||length<=N.MAX_RESULT_BYTES,'Desktop response exceeds 6 MB');const text=await r.text();ok(new TextEncoder().encode(text).length<=N.MAX_RESULT_BYTES,'Desktop response exceeds 6 MB');
   let value;try{value=JSON.parse(text);}catch(e){throw Error('Desktop returned invalid JSON');}if(!r.ok)throw Error(typeof value?.error==='string'?value.error.slice(0,2000):'Desktop request failed');return value;
  }finally{if(timer!==null)clearTimeout(timer);}
 }
 async connect(){const h=await this.call('/api/desktop/health');ok(h&&h.format==='eightmax-desktop-health'&&h.version===1&&h.build===A.ENGINE.build&&h.nativeCPU===true&&h.liveClientConnected===false,'Unsupported desktop host/build');this.connected=true;this.capabilities={currentJob:h.currentJob===true,cancelIntents:h.cancelIntents===true,revisionedJobs:h.revisionedJobs===true,nativeHistory:h.nativeHistory===true,nativeBatches:h.nativeBatches===true};return h;}
 async findCurrent(){if(!this.connected)await this.connect();ok(this.capabilities.currentJob,'This host does not support recovery; reopen START-DESKTOP.cmd from the latest release');const found=current(await this.call('/api/native/current'));this.observed=found;if(this.last){if(found&&equal(this.last.job,found.job))this.last=found;else this.last=null;}return found;}
 _remember(job,s){const record={job,status:s};this.last=record;this.observed=record;return record;}
 _task(job,id=null,attempt=null){return {job,id,revision:attempt,submitted:false,acknowledged:false,stopped:false,userStop:false,cancelConfirmed:false,cancelPromise:null};}
 _uncertain(task){this.unknown={job:task.job,id:task.id,revision:task.revision};return Error('Native cancellation could not be confirmed; the study may still be running. Use Find managed study or Stop native study in the desktop host.');}
 async _fence(task){
  ok(this.capabilities.cancelIntents,'This host cannot confirm cancellation before submission acknowledgment');
  const r=await this.call('/api/native/cancel-intent','POST',task.job,task.revision||1);
  ok(r&&r.format==='eightmax-desktop-cancel-intent'&&r.version===1&&r.fenced===true&&r.revision===(task.revision||1)&&equal(r.binding,task.job.workbench),'Invalid native cancellation receipt');
  const observed=current(r.current);
  if(observed){if(equal(observed.job,task.job)&&revision(observed.status)===task.revision)ok(!observed.status.running,'Cancellation receipt still reports the targeted attempt running');this._remember(observed.job,observed.status);}
  else{this.observed=null;if(this.last&&equal(this.last.job,task.job))this.last=null;}
  task.cancelConfirmed=true;this.unknown=null;return true;
 }
 async _stop(task){
  task.stopped=true;if(task.cancelConfirmed)return true;if(task.cancelPromise)return task.cancelPromise;
  if(!task.submitted){task.cancelConfirmed=true;return true;}
  const promise=(async()=>{
   if(task.id&&task.acknowledged){try{const s=status(await this.call('/api/native/jobs/'+task.id+'/cancel','POST',task.revision===null?undefined:{revision:task.revision}),task.job,task.id,task.revision);ok(!s.running,'Native cancellation is still pending');this._remember(task.job,s);task.cancelConfirmed=true;this.unknown=null;return true;}
    catch(e){if(!this.capabilities.cancelIntents)throw e;return this._fence(task);}}
   return this._fence(task);
  })();task.cancelPromise=promise;
  try{return await promise;}catch(e){throw this._uncertain(task);}finally{if(task.cancelPromise===promise)task.cancelPromise=null;}
 }
 async _failure(task,error){
  if(task.submitted&&!task.cancelConfirmed){try{await this._stop(task);}catch(e){return Error(error.message+'. '+this._uncertain(task).message);}}
  return task.userStop&&task.cancelConfirmed?Error('Desktop native study cancelled'):error;
 }
 async _watch(task,s,notify,started){
  for(;;){if(task.stopped){await this._stop(task);throw Error('Desktop native study cancelled');}this._remember(task.job,s);notify(s);
   if(s.stage==='complete'){const raw=await this.call('/api/native/jobs/'+task.id+'/result','GET',undefined,task.revision);if(task.stopped){await this._stop(task);throw Error('Desktop native study cancelled');}N.same(task.job,raw.job,task.job.workbench.slot);N.result(raw);return raw;}
   if(!s.running)throw Error(s.message||'Desktop native study stopped');if(this.now()-started>this.timeout){await this._stop(task);throw Error('Desktop native deadline exceeded; cancellation requested');}
   await this.delay(500);if(task.stopped){await this._stop(task);throw Error('Desktop native study cancelled');}s=status(await this.call('/api/native/jobs/'+task.id,'GET',undefined,task.revision),task.job,task.id,task.revision);
  }
 }
 async run(value,notify=()=>{},resume=false){
  ok(!this.task,'A desktop native request is already active');ok(!this.unknown,'Resolve the unconfirmed native submission before starting another study');ok(!this.last?.status.running&&!this.observed?.status.running,'A managed native study is still running; recover or stop it first');
  const job=N.job(value);ok(job.workbench,'Desktop native jobs require a bound study slot');const prior=this.last;if(resume)ok(prior&&prior.status.resumable&&equal(prior.job,job),'No compatible managed native checkpoint is available');
  const task=this._task(job,resume?prior.status.id:null,null),started=this.now();this.task=task;
  try{if(!this.connected)await this.connect();task.revision=this.capabilities.revisionedJobs?(resume?prior.status.revision+1:1):null;ok(task.revision===null||task.revision<=MAX_REVISION,'Desktop attempt limit reached; use a new job binding');
   if(task.stopped){task.cancelConfirmed=true;throw Error('Desktop native study cancelled');}
   task.submitted=true;const s=status(await this.call(resume?'/api/native/jobs/'+task.id+'/resume':'/api/native/jobs','POST',resume?(task.revision===null?undefined:{revision:prior.status.revision}):job),job,task.id,task.revision);task.id=s.id;task.acknowledged=true;
   if(task.stopped){await this._stop(task);throw Error('Desktop native study cancelled');}return await this._watch(task,s,notify,started);
  }catch(e){throw await this._failure(task,e);}finally{if(this.task===task)this.task=null;}
 }
 async attach(value,notify=()=>{}){
  ok(!this.task,'A desktop native request is already active');const record=current({format:'eightmax-desktop-current',version:1,job:value.job,status:value.status});ok(record,'No managed study is available');
  if(this.unknown)ok(equal(this.unknown.job,record.job),'Resolve the other unconfirmed submission before recovering this study');
  const task=this._task(record.job,record.status.id,revision(record.status)),started=this.now();task.submitted=true;task.acknowledged=true;this.task=task;
  try{if(this.unknown){const uncertain={...this._task(this.unknown.job,this.unknown.id,this.unknown.revision),submitted:true,acknowledged:false};await this._stop(uncertain);}const actual=await this.findCurrent();ok(actual&&actual.status.id===task.id&&revision(actual.status)===task.revision&&equal(actual.job,record.job),'The managed study changed; find it again before recovering');
   this.unknown=null;if(task.stopped){await this._stop(task);throw Error('Desktop native study cancelled');}if(!actual.status.running&&!actual.status.resultAvailable){this._remember(record.job,actual.status);notify(actual.status);return {status:actual.status,result:null};}const raw=await this._watch(task,actual.status,notify,started);return {status:this.last.status,result:raw};
  }catch(e){throw await this._failure(task,e);}finally{if(this.task===task)this.task=null;}
 }
 async cancel(slot=null){
  let task=this.task;if(!task&&this.unknown)task={...this._task(this.unknown.job,this.unknown.id,this.unknown.revision),submitted:true,acknowledged:!!this.unknown.id};
  const known=this.last?.status.running?this.last:slot===null&&this.observed?.status.running?this.observed:null;
  if(!task&&known)task={...this._task(known.job,known.status.id,revision(known.status)),submitted:true,acknowledged:true};
  if(!task||(slot!==null&&task.job.workbench.slot!==slot))return false;task.userStop=true;task.stopped=true;
  if(task.submitted&&!task.acknowledged&&!this.capabilities.cancelIntents){this.unknown={job:task.job,id:task.id,revision:task.revision};return true;}
  await this._stop(task);return true;
 }
}
function fromPage(page){
 try{if(page.location.origin!==ORIGIN)return null;const match=/^#desktop-token=([a-f0-9]{64})$/.exec(page.location.hash||'');let token=match?match[1]:null;
  if(!token){try{token=page.sessionStorage?.getItem('eightmax-desktop-session');}catch(e){}if(!token)return null;}
  if(match){let stored=false;try{page.sessionStorage?.setItem('eightmax-desktop-session',token);stored=!!page.sessionStorage;}catch(e){}if(stored){try{page.history?.replaceState(null,'',page.location.pathname);}catch(e){}}}
  return new Client({token,fetch:page.fetch.bind(page)});
 }catch(e){return null;}
}
return {ORIGIN,MAX_REVISION,Client,status,current,fromPage};
});
