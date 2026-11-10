// This realm has no filesystem, module loader, network or process API.
class TextDecoder {
  decode(bytes) {
    let s='';
    for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return decodeURIComponent(escape(s));
  }
}
function verifyEnvelope(text) {
  const file=JSON.parse(text);
  const payload=JSON.stringify(file.payload);
  // Accept the two canonical encodings produced by EightMax. Round-tripping
  // excludes duplicate keys, trailing data, extra fields and ambiguous encodings.
  if (JSON.stringify(file)!==text || !/^[0-9a-f]{64}$/.test(file.sha256) ||
      typeof file.sha256!=='string' || Object.keys(file).some(k=>!['sha256','payload','payloadBytes'].includes(k)))
    throw Error('Invalid checkpoint envelope');
  if (!verifyDigest(payload,file.sha256,file.payloadBytes??-1)) throw Error('Checkpoint checksum or length mismatch');
  if ('payloadBytes' in file && (!Number.isSafeInteger(file.payloadBytes)||file.payloadBytes<1))throw Error('Invalid payload size');
  if (['3.4','3.5','3.6'].includes(file.payload.writer) && !('payloadBytes' in file))throw Error('Missing payload size');
  const p=file.payload;
  if(!p.cfg || Array.isArray(p.cfg) || !p.state || Array.isArray(p.state) ||
     (p.writer!==undefined && (typeof p.writer!=='string' || !/^\d+\.\d+$/.test(p.writer))))throw Error('Invalid training metadata');
  if(p.state.nativeEMMW4!==undefined && (p.state.kind!=='wide'||p.state.external!==true))throw Error('Invalid native state metadata');
  EM.restoreCheckpoint(p);
}
function atob(s){const bytes=new Uint8Array(decodeBase64(s));let out='';
  for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return out;}

// Derive the verification specification from the same study rules used by the
// UI. Caller-supplied study IDs or hand ranges outside cfg are never trusted.
function streamSpec(text){
  const p=JSON.parse(text);
  if(JSON.stringify(p)!==text||Object.keys(p).some(k=>!['format','version','engine','writer','cfg','state','labels'].includes(k)))throw Error('Invalid archive metadata');
  EM.validateCheckpointMetadata(p);
  if(['3.6','3.7'].includes(p.writer)&&p.state.codec==='tables1'){
    const s=p.state,wide=s.kind==='wide',fields=wide?['kind','codec','external','iterations','stateVisits','trainingDeals','limitReached','dealState','actionState','counts']:['kind','codec','iterations'];
    if((!wide&&s.kind!=='exact')||wide!==(p.cfg.privateMode==='sampled')||Object.keys(s).some(k=>!fields.includes(k)))throw Error('Invalid table metadata');
    return '#tables1';
  }
  if(!['3.6','3.7'].includes(p.writer)||p.state.kind!=='wide'||p.state.external!==true||
    Object.keys(p.state).some(k=>!['kind','external','iterations'].includes(k))||
    p.cfg.privateMode!=='sampled')throw Error('Invalid native archive metadata');
  const game=EM.MultiwayGame(p.cfg,{restoredExternal:true});
  const spec=game.nativeSpec();if(spec.protocol!==4)throw Error('Expected an external-sampling study');
  return JSON.stringify(spec);
}
function verifyTableStream(text){
  const p=JSON.parse(text),s=p.state;
  const g=EM.MultiwayGame(p.cfg,{restoredExternal:s.external,checkpointShape:s.kind==='exact'});
  const verify=g.tableReader(s,true);
  for(;;){const line=nextCheckpointLine();if(line===null)break;
    const x=JSON.parse(line);if(JSON.stringify(x)!==line)throw Error('Invalid table record encoding');verify.row(x);}
  verify.finish();
}
function legacyNativeMeta(text){
  const f=JSON.parse(text),p=f.payload;
  if(JSON.stringify(f)!==text||Object.keys(f).some(k=>!['payload','sha256','payloadBytes'].includes(k))||
     typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)||p.state.nativeEMMW4!==''||
     p.state.kind!=='wide'||p.state.external!==true||p.cfg.privateMode!=='sampled')throw Error('Invalid legacy native envelope');
  if(f.payloadBytes!==undefined && (!Number.isSafeInteger(f.payloadBytes)||f.payloadBytes<1))throw Error('Invalid length');
  if(['3.4','3.5','3.6','3.7'].includes(p.writer)&&!f.payloadBytes)throw Error('Missing length');
  if(p.writer!==undefined&&(typeof p.writer!=='string'||!/^\d+\.\d+$/.test(p.writer)))throw Error('Invalid writer');
  EM.validateCheckpointMetadata(p);
  const bytes=s=>unescape(encodeURIComponent(s)).length,body=JSON.stringify(p),start=text.indexOf(body);
  p.state.nativeEMMW4='!';const marker=JSON.stringify(f).indexOf('"nativeEMMW4":"!"')+'"nativeEMMW4":"'.length;
  const cfg=EM.copyStudyConfig(p.cfg);if(p.engine==='multiway-2.3'&&cfg.weighting===undefined)cfg.weighting='uniform';
  if(cfg.preflop&&!['3.0','3.1','3.2','3.3','3.4','3.5','3.6','3.7'].includes(p.writer))cfg.traversal='external';
  const meta={...p,cfg,writer:'3.6',state:{kind:'wide',external:true,iterations:p.state.iterations}};
  return JSON.stringify({start:bytes(text.slice(0,start)),emptyLength:bytes(body),marker:bytes(text.slice(0,marker)),length:f.payloadBytes??-1,sha256:f.sha256,meta:JSON.stringify(meta)});
}
function advanceArchive(text){
  const [metadata,updates]=JSON.parse(text);
  metadata.state.iterations=updates;
  metadata.writer='3.7';
  return JSON.stringify(metadata);
}
