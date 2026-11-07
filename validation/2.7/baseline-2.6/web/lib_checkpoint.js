(function(EM){
'use strict';
const MAX_BYTES=512*1024*1024, ENGINE='multiway-2.4', ENGINES=['multiway-2.3',ENGINE];
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
function payload(cfg,state,labels){return {format:'EightMax training',version:1,engine:ENGINE,cfg:copy(cfg),state,labels:labels||[]};}
function validate(p){
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
  const g=EM.MultiwayGame(cfg);
  g.restoreState(p.state);return {game:g,cfg,labels:p.labels.slice()};
}
Object.assign(EM,{copyStudyConfig:copy,checkpointInteger:integer,checkpointFail:fail,packTrainingValues:pack,unpackTrainingValues:unpack,
  checkpointPayload:payload,encodeCheckpoint:encode,decodeCheckpoint:decode,restoreCheckpoint:restore,checkpointMaxBytes:MAX_BYTES});
})(globalThis.EM || (globalThis.EM = {}));
