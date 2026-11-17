(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./study-adapter.js'));else root.WorkbenchCache=factory(root.WorkbenchStudy);})(typeof globalThis!=='undefined'?globalThis:this,function(A){
'use strict';
class Cache {
 constructor({maxEntries=32,maxBytes=4000000}={}){if(!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>64||!Number.isInteger(maxBytes)||maxBytes<1000||maxBytes>8000000)throw Error('Invalid cache bounds');this.limit=maxEntries;this.budget=maxBytes;this.bytes=0;this.entries=new Map();}
 key(request){return A.canonical({schema:1,engine:A.ENGINE,backend:'javascript-reference-cpu',request:A.input(request)});}
 get(request){const key=this.key(request),entry=this.entries.get(key);if(!entry)return null;this.entries.delete(key);this.entries.set(key,entry);return JSON.parse(entry.text);}
 put(request,value){const r=A.validateResult(value),normalized=A.input(request);if(r.engine.backend!=='javascript-reference-cpu'||r.stopped!=='updates-complete'||r.updates!==normalized.iterations||r.practice||r.reviewedNode||r.cpuContinuation&&r.cpuContinuation.operation!=='fresh'||A.canonical(normalized.config)!==A.canonical(r.config))return false;
  const key=this.key(request),text=JSON.stringify(r),bytes=(key.length+text.length)*2;if(bytes>this.budget)return false;const old=this.entries.get(key);if(old){this.bytes-=old.bytes;this.entries.delete(key);}while(this.entries.size>=this.limit||this.bytes+bytes>this.budget){const first=this.entries.keys().next().value;this.bytes-=this.entries.get(first).bytes;this.entries.delete(first);}this.entries.set(key,{text,bytes});this.bytes+=bytes;return true;
 }
 clear(){this.entries.clear();this.bytes=0;}
 stats(){return {entries:this.entries.size,accountedBytes:this.bytes,maxEntries:this.limit,budgetBytes:this.budget,semantics:'UTF-16 key/result strings only; not total JavaScript heap'};}
}
return {Cache};
});
