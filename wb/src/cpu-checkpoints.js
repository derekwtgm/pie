/* Portable CPU training-state containers. Reports/workspace backups remain separate. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./study-adapter.js'),require('./reviewed-study.js'));else root.WorkbenchCPUCheckpoint=factory(root.WorkbenchStudy,root.WorkbenchReviewed);})(typeof globalThis!=='undefined'?globalThis:this,function(A,Q){
'use strict';
const FORMAT='eightmax-workbench-cpu-checkpoint',MAX_STATE_BYTES=48*1048576,MAX_META_BYTES=600000,MAX_FILE_BYTES=20+MAX_META_BYTES+MAX_STATE_BYTES,STORE_BYTES=96*1048576,MAX_STATES=200000,MAX_ROWS=500000,MAX_DEPTH=128;
const magic=[69,77,87,66,67,80,49,10],copy=x=>JSON.parse(JSON.stringify(x)),ok=(v,m)=>{if(!v)throw Error(m);};
const equal=(a,b)=>A.canonical(a)===A.canonical(b);
function integer(v,lo,hi,name){ok(Number.isSafeInteger(v)&&v>=lo&&v<=hi,'Invalid CPU checkpoint '+name);}
function keys(v,names,name){ok(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.prototype.hasOwnProperty.call(v,k)),'Unsupported CPU checkpoint '+name);}
function bytes(value){ok(ArrayBuffer.isView(value)&&value.BYTES_PER_ELEMENT===1,'CPU checkpoint needs byte data');const b=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);ok(b.length>=20&&b.length<=MAX_STATE_BYTES,'CPU checkpoint state exceeds 48 MiB or is truncated');return b;}
function metadata(value){
 const m=copy(value);keys(m,['format','version','engine','config','reviewedProof','updates','trainingDeals','requestedUpdates','timeMs','decisionReady'],'metadata');
 ok(m.format===FORMAT&&m.version===1&&equal(m.engine,A.ENGINE)&&m.decisionReady===false,'Unsupported CPU checkpoint engine/format');
 const input=A.input({config:m.config,iterations:m.requestedUpdates,timeMs:m.timeMs});ok(equal(input.config,m.config),'CPU checkpoint configuration must use the saved normalized settings');
 integer(m.updates,0,A.MAX_ITERATIONS,'updates');integer(m.trainingDeals,0,A.MAX_ITERATIONS,'sampled deals');ok(m.trainingDeals===m.updates&&m.updates<=m.requestedUpdates,'CPU checkpoint counters/target disagree');
 if(m.reviewedProof!==null){m.reviewedProof=Q.validate(m.reviewedProof).proof;Q.rootConfig(m.config,Q.validate(m.reviewedProof));}
 ok(new TextEncoder().encode(JSON.stringify(m)).length<=MAX_META_BYTES,'CPU checkpoint metadata is too large');return m;
}
// Bound the original EMMW4 parser's allocation counts and recursive path depth.
// The original engine still validates row checksums, study identity and row semantics.
function preflight(value){
 const b=bytes(value),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 ok([69,77,77,87,52,0,0,0].every((c,i)=>b[i]===c),'CPU checkpoint requires EMMW4 external-sampling state');
 const length=v.getUint32(8,true);ok(length>=2&&length<=10000&&12+length+8<=b.length,'Invalid CPU checkpoint state header');
 const h=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(12,12+length)));
 ok(h.protocol===1&&h.specProtocol===4&&typeof h.studyId==='string'&&/^[a-f0-9]{16}$/.test(h.studyId),'Unsupported CPU checkpoint native header');
 for(const k of ['iterations','trainingDeals'])integer(h[k],0,A.MAX_ITERATIONS,k);
 integer(h.stateVisits,0,Number.MAX_SAFE_INTEGER,'state visits');integer(h.rng,0,4294967295,'deal RNG');integer(h.actionRng,0,4294967295,'action RNG');
 ok(h.trainingDeals===h.iterations&&h.rowSync===undefined&&h.rowKeys===undefined,'CPU checkpoint trainer differs from the portable exact-card trainer');
 let at=12+length;const states=v.getUint32(at,true);at+=4;integer(states,1,MAX_STATES,'state count');ok(h.states===states&&at+9*states+4<=b.length,'Truncated CPU checkpoint states');const depth=new Uint16Array(states);
 for(let i=0;i<states;i++,at+=9){const parent=v.getUint32(at,true),slot=b[at+4],kind=b[at+5],actor=b[at+6],street=b[at+7],width=b[at+8];
  ok((i===0?parent===4294967295:parent<i)&&slot<=7&&[0,1].includes(kind)&&actor<8&&[0,3,4,5].includes(street)&&(kind===0?width>=1&&width<=7:width===0),'Invalid CPU checkpoint state table');depth[i]=i?depth[parent]+1:0;ok(depth[i]<=MAX_DEPTH,'CPU checkpoint path exceeds 128 transitions');}
 const rows=v.getUint32(at,true);at+=4;integer(rows,0,MAX_ROWS,'row count');ok(h.rows===rows,'CPU checkpoint row count differs');
 for(let i=0;i<rows;i++){ok(at+12<=b.length,'Truncated CPU checkpoint row');const state=v.getUint32(at,true),hand=v.getUint16(at+4,true),width=b[at+11];ok(state<states&&hand<1326&&width>=1&&width<=7,'Invalid CPU checkpoint row header');at+=12+16*width;ok(at<=b.length,'Truncated CPU checkpoint values');}
 ok(at===b.length,'CPU checkpoint has trailing data');return h;
}
function validate(value){keys(value,['meta','bytes'],'runtime record');const m=metadata(value.meta),b=bytes(value.bytes),h=preflight(b);ok(h.iterations===m.updates&&h.trainingDeals===m.trainingDeals,'CPU checkpoint metadata differs from its state');return {meta:m,bytes:b};}
function context(value,config,proof=null){const s=validate(value);ok(equal(s.meta.config,A.input({config}).config),'CPU checkpoint belongs to different study settings');ok(equal(s.meta.reviewedProof,proof===null?null:Q.validate(proof).proof),'CPU checkpoint belongs to a different captured position');return s;}
function restore(prepared,value,proof=null){
 ok(prepared.game.iterations===0,'CPU checkpoint restore requires a fresh worker study');const s=context(value,prepared.options.config,proof);ok(prepared.options.iterations>=s.meta.updates,'Total update target is below the saved committed count');
 const h=preflight(s.bytes);ok(h.studyId===prepared.spec.studyId,'CPU checkpoint belongs to a different engine study');prepared.game.importNative(s.bytes);
 ok(prepared.game.iterations===s.meta.updates&&prepared.game.trainingDeals===s.meta.trainingDeals,'Restored CPU checkpoint counters differ');
 ok(prepared.game.strategyMiB<=32+1e-9,'CPU checkpoint exceeds the 32 MiB portable strategy budget');return s.meta.updates;
}
function capture(prepared,proof=null){return validate({meta:{format:FORMAT,version:1,engine:{...A.ENGINE},config:prepared.options.config,reviewedProof:proof===null?null:Q.validate(proof).proof,updates:prepared.game.iterations,trainingDeals:prepared.game.trainingDeals,requestedUpdates:prepared.options.iterations,timeMs:prepared.options.timeMs,decisionReady:false},bytes:prepared.game.exportNative()});}
const crcTable=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let n=0;n<8;n++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[i]=c>>>0;}
function crc32(data){let c=4294967295;for(let i=0;i<data.length;i++)c=crcTable[(c^data[i])&255]^(c>>>8);return (c^4294967295)>>>0;}
function encode(value){const s=validate(value),head=new TextEncoder().encode(JSON.stringify(s.meta)),out=new Uint8Array(20+head.length+s.bytes.length),v=new DataView(out.buffer);out.set(magic);v.setUint32(8,head.length,true);v.setUint32(12,s.bytes.length,true);out.set(head,20);out.set(s.bytes,20+head.length);v.setUint32(16,crc32(out.subarray(20)),true);return out;}
function decode(value){
 ok(ArrayBuffer.isView(value)&&value.BYTES_PER_ELEMENT===1,'Open a binary .emcpu checkpoint');const b=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);ok(b.length>=40&&b.length<=MAX_FILE_BYTES,'CPU checkpoint file exceeds its limit or is truncated');const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 ok(magic.every((c,i)=>b[i]===c),'Not an EightMax Workbench CPU checkpoint');const hl=v.getUint32(8,true),bl=v.getUint32(12,true);ok(hl>=2&&hl<=MAX_META_BYTES&&bl>=20&&bl<=MAX_STATE_BYTES&&20+hl+bl===b.length,'CPU checkpoint lengths disagree');
 ok(crc32(b.subarray(20))===v.getUint32(16,true),'CPU checkpoint checksum failed');const meta=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(20,20+hl)));return validate({meta,bytes:b.subarray(20+hl)});
}
function report(value,snapshot){const r=A.validateResult(value),s=context(snapshot,r.config,r.reviewedNode?r.reviewedNode.proof:null);ok(r.engine.backend==='javascript-reference-cpu'&&r.updates===s.meta.updates&&r.trainingDeals===s.meta.trainingDeals&&r.requestedUpdates===s.meta.requestedUpdates,'CPU checkpoint does not match its returned report');if(r.reviewedNode)Q.validateNode(r.reviewedNode,r.config);return s;}
class Store{
 constructor(limit=STORE_BYTES){integer(limit,1,STORE_BYTES,'retained-byte budget');this.limit=limit;this.used=0;this.items=new Map();}
 get(slot){return this.items.get(slot)?.value||null;}
 delete(slot){const p=this.items.get(slot);if(p){this.used-=p.cost;this.items.delete(slot);}}
 clear(){this.items.clear();this.used=0;}
 put(slot,value){integer(slot,1,10,'slot');const s=validate(value),cost=s.bytes.length+new TextEncoder().encode(JSON.stringify(s.meta)).length;ok(cost<=this.limit,'CPU checkpoint exceeds the retained-state budget');const owned={meta:copy(s.meta),bytes:s.bytes.slice()},evicted=[];this.delete(slot);
  while(this.used+cost>this.limit){const oldest=this.items.keys().next().value;this.delete(oldest);evicted.push(oldest);}
  this.items.set(slot,{value:owned,cost});this.used+=cost;return evicted;
 }
}
return {FORMAT,MAX_STATE_BYTES,MAX_META_BYTES,MAX_FILE_BYTES,STORE_BYTES,MAX_STATES,MAX_ROWS,MAX_DEPTH,metadata,preflight,validate,context,restore,capture,crc32,encode,decode,report,Store};
});
