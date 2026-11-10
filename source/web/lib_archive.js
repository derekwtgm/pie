// EMCP36 v1. Blocks carry the exact bytes of the original native checkpoint.
(function(EM){
'use strict';
const blockSize=256*1024, magic='EMCP36\r\n', type='application/vnd.eightmax.checkpoint';
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const sha=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
function pack(input){
  const tmp=new Uint8Array(input.length+Math.ceil(input.length/128)+2);let i=0,w=0;
  // Return the original block as soon as the coding cannot save space.
  while(i<input.length){
    const begin=i;
    if(!input[i]&&!input[i+1]&&!input[i+2]&&i+2<input.length){
      while(i<input.length&&i-begin<128&&!input[i])i++;
      tmp[w++]=127+i-begin;
    }else{
      do{i++;}while(i<input.length&&i-begin<128&&(input[i]||input[i+1]||input[i+2]||i+2>=input.length));
      tmp[w++]=i-begin-1;tmp.set(input.subarray(begin,i),w);w+=i-begin;
    }
  }
  return w<input.length?tmp.subarray(0,w):input;
}
function unpack(src,n){
  if(src.length===n)return src;
  const out=new Uint8Array(n);let i=0,w=0;
  while(i<src.length){const c=src[i++],len=1+(c&127);if(len>n-w)throw Error('Invalid compressed block');
    if(c<128){if(len>src.length-i)throw Error('Truncated compressed block');out.set(src.subarray(i,i+len),w);i+=len;}w+=len;}
  if(w!==n)throw Error('Incomplete compressed block');return out;
}
async function archiveTo(meta,total,chunks,write,progress){
  const text=enc.encode(JSON.stringify(meta));
  if(!Number.isSafeInteger(total)||total<1||total>16*2**30||!text.length||text.length>1048576)throw Error('Invalid checkpoint metadata or size');
  const h=new Uint8Array(24+text.length),dv=new DataView(h.buffer);h.set(enc.encode(magic));dv.setUint32(8,1,true);dv.setUint32(12,text.length,true);
  dv.setBigUint64(16,BigInt(total),true);h.set(text,24);await write(h);
  const count=Math.ceil(total/blockSize),manifest=new Uint8Array(h.length+40*count);manifest.set(h);
  let index=0,done=0;
  for await(const raw of chunks){
    if(raw.length!==Math.min(blockSize,total-done)||!raw.length)throw Error('Invalid source block length');
    const stored=pack(raw),desc=manifest.subarray(h.length+40*index,h.length+40*(index+1)),view=new DataView(desc.buffer,desc.byteOffset,40);
    view.setUint32(0,raw.length,true);view.setUint32(4,stored.length,true);desc.set(await sha(raw),8);
    await write(desc);await write(stored);done+=raw.length;index++;if(progress)progress(done,total);
  }
  if(done!==total)throw Error('Incomplete checkpoint source');await write(await sha(manifest));
}
function nativeBlocks(bytes){return (function*(){for(let i=0;i<bytes.length;i+=blockSize)yield bytes.subarray(i,i+blockSize);})();}
// OPFS provides a file-backed Blob on Chromium's loopback origin. Both stages
// are closed and removed after the host acknowledgement or any failed write.
async function stagingFile(staging,produce){
  if(staging&&globalThis.navigator?.storage?.getDirectory){
    const root=await navigator.storage.getDirectory(),name='eightmax-'+crypto.randomUUID()+'.part';
    const locks=navigator.locks;let unlock,held=Promise.resolve();
    if(locks){
      // An active file remains locked until the host acknowledges its upload.
      for await(const key of root.keys())if(/^eightmax-[0-9a-f-]{36}\.part$/.test(key))
        await locks.request(key,{ifAvailable:true},async lock=>{if(lock)await root.removeEntry(key).catch(()=>{});});
      let grant;const ready=new Promise(resolve=>{grant=resolve;});
      held=locks.request(name,()=>new Promise(resolve=>{unlock=resolve;grant();}));
      await Promise.race([ready,held]);
    }
    let stream;
    const release=async()=>{try{await root.removeEntry(name);}finally{if(unlock)unlock();await held;}};
    try{const file=await root.getFileHandle(name,{create:true});stream=await file.createWritable();
      await produce(b=>stream.write(b));await stream.close();stream=null;
      return {blob:await file.getFile(),release};
    }catch(e){if(stream)await stream.abort().catch(()=>{});await release().catch(()=>{});throw e;}
  }
  const parts=[];await produce(async b=>parts.push(b));return {blob:new Blob(parts,{type}),release:async()=>{}};
}
async function archiveBlob(state,progress,staging=false,signal){
  const {meta,bytes,entries}=state;let source;
  try{
    if(entries)source=await stagingFile(staging,async write=>{
      let lines=[],size=0;
      for(const line of entries()){
        const text=JSON.stringify(line)+'\n';lines.push(text);size+=text.length;
        if(size>=blockSize){if(signal?.aborted)throw Error('Checkpoint save cancelled');await write(enc.encode(lines.join('')));lines=[];size=0;}
      }
      if(size)await write(enc.encode(lines.join('')));
    });
    async function* fromFile(){for(let p=0;p<source.blob.size;p+=blockSize)yield new Uint8Array(await source.blob.slice(p,p+blockSize).arrayBuffer());}
    return await stagingFile(staging,write=>archiveTo(meta,source?source.blob.size:bytes.length,source?fromFile():nativeBlocks(bytes),write,progress));
  }finally{if(source)await source.release();}
}
async function readArchive(stream,progress,maxRaw=2**31){
  const reader=stream.getReader();let pending=new Uint8Array(0),pos=0;
  async function read(n){const out=new Uint8Array(n);let used=0;while(used<n){
    if(pos===pending.length){const v=await reader.read();if(v.done)throw Error('Truncated streaming checkpoint');pending=v.value;pos=0;}
    const size=Math.min(n-used,pending.length-pos);out.set(pending.subarray(pos,pos+size),used);pos+=size;used+=size;
  }return out;}
  try{
    const h=await read(24),dv=new DataView(h.buffer),ml=dv.getUint32(12,true),total=Number(dv.getBigUint64(16,true));
    if(dec.decode(h.subarray(0,8))!==magic||dv.getUint32(8,true)!==1||!ml||ml>1048576||!total||total>maxRaw)throw Error('Invalid archive or restore budget exceeded');
    const metadata=await read(ml),meta=JSON.parse(dec.decode(metadata));EM.validateCheckpointMetadata(meta);
    const tables=meta.state.codec==='tables1',cfg=EM.copyStudyConfig(meta.cfg);
    if(!tables&&(meta.state.kind!=='wide'||meta.state.external!==true||cfg.privateMode!=='sampled'))throw Error('Invalid streaming study');
    const game=EM.MultiwayGame(cfg,{restoredExternal:meta.state.external});
    const verifier=tables?game.tableReader(meta.state):null;
    const textDecoder=new TextDecoder('utf-8',{fatal:true});let tail='';
    const count=Math.ceil(total/blockSize),manifest=new Uint8Array(24+ml+40*count);manifest.set(h);manifest.set(metadata,24);
    const bytes=tables?null:new Uint8Array(total);
    for(let i=0,p=0;i<count;i++){
      const desc=await read(40),v=new DataView(desc.buffer),n=v.getUint32(0,true),wire=v.getUint32(4,true);
      if(n!==Math.min(total-p,blockSize)||!wire||wire>n)throw Error('Invalid archive block length');
      const raw=unpack(await read(wire),n);if(!equal(await sha(raw),desc.subarray(8)))throw Error('Checkpoint block checksum failed');
      manifest.set(desc,24+ml+40*i);
      if(tables){
        const parts=(tail+textDecoder.decode(raw,{stream:true})).split('\n');tail=parts.pop();
        if(tail.length>262144)throw Error('Oversized strategy table line');
        for(const line of parts){if(line.length>262144)throw Error('Oversized strategy table line');verifier.row(JSON.parse(line));}
      }else bytes.set(raw,p);
      p+=n;if(progress)progress(p,total);
    }
    if(!equal(await sha(manifest),await read(32))||pos!==pending.length||!(await reader.read()).done)throw Error('Checkpoint final checksum or length mismatch');
    if(tables){if(tail+textDecoder.decode())throw Error('Incomplete strategy table');verifier.finish();}
    else if(game.importNative(bytes,true).iterations!==meta.state.iterations)throw Error('Checkpoint iteration mismatch');
    return {game,cfg,labels:meta.labels.slice()};
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function loadStudyFile(file,progress){
  if(dec.decode(await file.slice(0,8).arrayBuffer())===magic)return readArchive(file.stream(),progress);
  if(file.size>EM.checkpointMaxBytes)throw Error('Legacy JSON exceeds the browser import limit');
  return EM.restoreCheckpoint(await EM.decodeCheckpoint(await file.text()));
}
Object.assign(EM,{archiveBlockSize:blockSize,archiveTo,archiveBlob,readArchive,loadStudyFile,nativeBlocks});
})(globalThis.EM||(globalThis.EM={}));
