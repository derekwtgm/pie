(function(EM){
'use strict';
const MAX_BYTES=512*1024*1024, ENGINE='multiway-2.8', ENGINES=['multiway-2.3','multiway-2.4',ENGINE];
const fail=()=>{throw Error('Invalid or incompatible training checkpoint');};
function copy(value,depth=0){
  if(depth>20)fail();
  if(value===null || typeof value!=='object')return value;
  if(Array.isArray(value)||ArrayBuffer.isView(value))return Array.from(value,x=>copy(x,depth+1));
  const out=Object.create(null);
  for(const key of Object.keys(value)){
    if(['__proto__','prototype','constructor'].includes(key))fail();
    out[key]=copy(value[key],depth+1);
  }
  return out;
}
function integer(v,max=1e9){if(!Number.isSafeInteger(v)||v<0||v>max)fail();return v;}
function pack(values){
  const bytes=new Uint8Array(values.length*8),view=new DataView(bytes.buffer);
  for(let i=0;i<values.length;i++){if(!Number.isFinite(values[i]))throw Error('Cannot save non-finite strategy values');view.setFloat64(i*8,values[i],true);}
  let text='';for(let i=0;i<bytes.length;i+=24576)text+=btoa(String.fromCharCode(...bytes.subarray(i,i+24576)));
  return text;
}
function unpack(text,length,nonnegative=false){
  integer(length,32*1024*1024);
  if(typeof text!=='string'||text.length!==4*Math.ceil(length*8/3)||!(/^[A-Za-z0-9+/]*={0,2}$/).test(text))fail();
  const binary=atob(text);if(binary.length!==length*8)fail();
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),out=new Float64Array(length);
  for(let i=0;i<length;i++){const x=view.getFloat64(i*8,true);if(!Number.isFinite(x)||(nonnegative&&x<0))fail();out[i]=x;}
  return out;
}
function payload(cfg,state,labels){return {format:'EightMax training',version:1,engine:cfg.riverStrata?ENGINE:'multiway-2.4',writer:'3.2',cfg:copy(cfg),state,labels:labels||[]};}
function validate(p){
  if(p&&p.format==='EightMax training'&&(p.version!==1||(typeof p.engine==='string'&&!ENGINES.includes(p.engine))))
    throw Error('This checkpoint was written by an incompatible EightMax engine ('+String(p.engine).slice(0,40)+', format '+String(p.version).slice(0,8)+(p.writer?', writer '+String(p.writer).slice(0,12):'')+'). This version reads formats from '+ENGINES.join(', ')+'.');
  if(!p||p.format!=='EightMax training'||p.version!==1||!ENGINES.includes(p.engine)||!p.cfg||!p.state)fail();
  if(!Array.isArray(p.labels)||p.labels.length>8||p.labels.some(v=>typeof v!=='string'||v.length>80))fail();
  integer(p.state.iterations);return p;
}
async function digest(text){
  if(!globalThis.crypto?.subtle)throw Error('Use a current Edge, Chrome or Firefox browser to save or load training');
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}
async function encode(p){
  validate(p);const body=JSON.stringify(p);
  if(body.length>MAX_BYTES)throw Error('Checkpoint exceeds the 512 MiB file limit');
  return '{"sha256":"'+await digest(body)+'","payload":'+body+'}';
}
async function decode(text){
  if(typeof text!=='string'||text.length>MAX_BYTES)fail();
  let file;try{file=JSON.parse(text);}catch{fail();}
  if(typeof file.sha256!=='string'||!/^([a-f0-9]{64})$/.test(file.sha256)||file.sha256!==await digest(JSON.stringify(file.payload)))throw Error('Checkpoint checksum failed; the file may be incomplete or changed');
  return validate(file.payload);
}
function restore(p){
  validate(p);const cfg=copy(p.cfg);
  // 2.3 trained wide studies with uniform weighting and had no ante choice; keep both on resume.
  if(p.engine==='multiway-2.3' && cfg.privateMode==='sampled' && cfg.weighting===undefined)cfg.weighting='uniform';
  if(cfg.preflop && p.state.external===true && p.writer!=='3.0' && p.writer!=='3.1' && p.writer!=='3.2')cfg.traversal='external';
  // 3.1 changed the automatic full-tree limit for native training (20,000 states,
  // was 250,000). An automatic sampled study resumes with the traversal it was
  // trained with, so earlier checkpoints keep restoring. The saved configuration
  // itself is not changed.
  const opts=p.state.kind==='wide' && typeof p.state.external==='boolean'?{restoredExternal:p.state.external}:{};
  const g=EM.MultiwayGame(cfg,opts);
  g.restoreState(p.state);return {game:g,cfg,labels:p.labels.slice()};
}
// The transaction replaces both generations atomically. Keep the DB closed
// between operations so browser shutdown cannot leave a file handle held.
async function checkpointTransaction(write,operation){
  if(!globalThis.indexedDB)throw Error('Browser checkpoint storage unavailable');
  const db=await new Promise((resolve,reject)=>{
    const open=indexedDB.open('EightMax-training',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('checkpoints');
    open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
  });
  try{
    return await new Promise((resolve,reject)=>{
      const tx=write?db.transaction('checkpoints','readwrite',{durability:'strict'}):
        db.transaction('checkpoints','readonly');
      const result=operation(tx.objectStore('checkpoints'));
      tx.oncomplete=()=>resolve(result());tx.onabort=()=>reject(tx.error||Error('Checkpoint transaction aborted'));
      tx.onerror=()=>reject(tx.error);
    });
  }finally{db.close();}
}
async function autosaveTraining(text,host){
  if(host){
    if(text.length>64*1024*1024)throw Error('Desktop automatic saves support 64 MiB. Use manual Export for this study.');
    const r=await fetch(host+'/api/checkpoint/write',{method:'POST',headers:{'X-EightMax':'1','Content-Type':'application/json'},body:text});
    if(!r.ok)throw Error('Desktop checkpoint write failed (HTTP '+r.status+')');
    return;
  }
  try{
    await checkpointTransaction(true,store=>{
      const old=store.get('latest');
      old.onsuccess=()=>{if(old.result)store.put(old.result,'previous');store.put(text,'latest');};
      return ()=>true;
    });
  }catch(e){
    // The transaction is atomic: on failure both stored generations are unchanged.
    const quota=e&&(e.name==='QuotaExceededError'||/quota|space/i.test(e.message||''));
    throw Error((quota?'Browser storage is full or blocked':'Browser checkpoint write failed')+' ('+((e&&e.message)||e)+'). The previous checkpoints are unchanged; use Save training to download this study.');
  }
}
async function recoverTraining(host){
  let lastError;const skipped=[];
  for(const key of ['latest','previous']){
    try{
      let text;
      if(host){const r=await fetch(host+'/api/checkpoint/'+key);if(!r.ok){if(r.status===404){skipped.push({generation:key,reason:'missing'});continue;}throw Error('Checkpoint read failed');}text=await r.text();}
      else text=await checkpointTransaction(false,store=>{const r=store.get(key);return ()=>r.result;});
      if(!text){skipped.push({generation:key,reason:'missing'});continue;}
      const restored=restore(await decode(text));
      restored.generation=key;restored.skipped=skipped;
      restored.message=key==='latest'?'Recovered the newest automatic checkpoint.':
        'The newest automatic checkpoint was '+(skipped[0]?.reason==='missing'?'missing':'damaged or incompatible ('+skipped[0]?.reason+')')+'; recovered the previous one.';
      return restored;
    }catch(e){lastError=e;skipped.push({generation:key,reason:e.message});}
  }
  throw lastError||Error('No automatic checkpoint is available for this browser and address');
}
Object.assign(EM,{autosaveTraining,recoverTraining,copyStudyConfig:copy,checkpointInteger:integer,checkpointFail:fail,packTrainingValues:pack,unpackTrainingValues:unpack,
  checkpointPayload:payload,encodeCheckpoint:encode,decodeCheckpoint:decode,restoreCheckpoint:restore,checkpointMaxBytes:MAX_BYTES});
})(globalThis.EM || (globalThis.EM = {}));
