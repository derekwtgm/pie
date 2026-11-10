'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {withHost,home}=require('./checkpoint_host'),cp=require('node:child_process');
const E=require('../tools/loadlib');for(const f of ['lib_runouts','lib_wide','lib_river','lib_archive','lib_select'])require('../web/'+f);
const legacy=require('./fixtures/checkpoints-2.5.json');
const cfg={board:'Qs9h4d2c7s',common:8,stacks:[18,20],ranges:['AsQd,KhQh,9s9c','QcJc,TdTc,As4s'],bets:'50,a',raises:'',maxBets:1,privateMode:'sampled',abstraction:'exact',evaluationDeals:128,engine:'native',batchDeals:4};
async function write(url,b){return fetch(url+'/api/checkpoint/write',{method:'POST',headers:{'X-EightMax':'1'},body:b});}
async function arch(state){return (await E.archiveBlob(state)).blob;}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wire(url,headers,body='',end=true){
 const port=Number(new URL(url).port),s=net.createConnection(port,'127.0.0.1');s.setEncoding('utf8');
 let response='';const result=new Promise((resolve,reject)=>{s.on('data',d=>response+=d);s.on('error',reject);s.on('close',()=>resolve(Number(response.split(' ')[1])));});
 s.write('POST /api/checkpoint/write HTTP/1.1\r\nHost: 127.0.0.1:'+port+'\r\nX-EightMax: 1\r\n'+headers+'\r\n\r\n'+body);
 if(end)s.end();return {s,result};
}
for(const [name,x] of Object.entries(legacy).filter(([,v])=>v.text)){
 test('table archive exact values and continuation: '+name,async()=>{
   const g=E.restoreCheckpoint(await E.decodeCheckpoint(x.text)).game,blob=await arch(g.archiveState()),copy=(await E.loadStudyFile(blob)).game;
   assert.deepEqual(copy.snapshot().state,g.snapshot().state);g.iterate(2);copy.iterate(2);assert.deepEqual(copy.snapshot().state,g.snapshot().state);
 });
}
test('host handles native and JavaScript row archives from real training',async t=>withHost(home(t),{},async(api,url)=>{
 for(const over of [{traversal:'external',weighting:'dcfr'},{traversal:'full'},{privateMode:'exact',engine:'javascript'},{traversal:'external',native:true}]){
  const g=E.MultiwayGame({...cfg,...over});g.iterate(20);if(over.native)g.importNative(g.exportNative());
  const blob=await arch(g.archiveState()),r=await write(url,blob);assert.equal(r.status,200,await r.text());
  const download=await api('checkpoint/latest'),loaded=(await E.readArchive(download.body)).game;
  assert.deepEqual(loaded.snapshot().state,g.snapshot().state);const st=await(await api('checkpoint/status')).json();
  assert.equal(st.sizeBytes,blob.size);assert.equal(st.transferBufferBytes,65536);
 }
}));
test('block SHA, final SHA, truncation and trailing data retain acknowledged generations',async t=>withHost(home(t),{},async(api,url)=>{
 const g=E.MultiwayGame({...cfg,traversal:'external'});g.iterate(13);g.importNative(g.exportNative());
 const buf=Buffer.from(await(await arch(g.archiveState())).arrayBuffer());assert.equal((await write(url,buf)).status,200);
 const ml=buf.readUInt32LE(12),desc=24+ml;
 for(const bad of [buf.subarray(0,-1),Buffer.concat([buf,Buffer.from([0])]),...([desc,desc+8,desc+41,buf.length-15].map(i=>{const b=Buffer.from(buf);b[i]^=33;return b;}))]){
  assert.equal((await write(url,bad)).status,400);assert.equal((await(await api('checkpoint/status')).json()).generation,'1');
 }
}));
test('valid hashes around forged native counters and duplicate rows do not pass semantic verification',async t=>withHost(home(t),{},async(api,url)=>{
 const g=E.MultiwayGame({...cfg,traversal:'external'});g.iterate(30);g.importNative(g.exportNative());const a=g.archiveState();
 const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);return c;});
 const b=Buffer.from(a.bytes),hl=b.readUInt32LE(8),start=12+hl,h=JSON.parse(b.subarray(12,start));
 const body=Buffer.from(b.subarray(start)),rc=4+9*body.readUInt32LE(0),src=rc+4,one=12+16*body[src+11];
 body.writeUInt32LE(body.readUInt32LE(rc)+1,rc);const data=Buffer.concat([body,body.subarray(src,src+one)]);
 let crc=-1;for(const c of data)crc=crcTable[(crc^c)&255]^(crc>>>8);h.rowCrc32=((~crc)>>>0).toString(16).padStart(8,'0');const header=Buffer.from(JSON.stringify(h));b.writeUInt32LE(header.length,8);
 const bad=await arch({meta:a.meta,bytes:Buffer.concat([b.subarray(0,12),header,data])});const r=await write(url,bad);assert.equal(r.status,400);assert.match(await r.text(),/Duplicate/);
 assert.equal((await write(url,await arch({...a,meta:{...a.meta,state:{...a.meta.state,iterations:g.iterations+1}}}))).status,400);
}));
for(const [name,h,b,status] of [
 ['bad hexadecimal','Transfer-Encoding: chunked','zx\r\n',400],['truncated chunk','Transfer-Encoding: chunked','8\r\nxx',400],['ambiguous framing','Content-Length: 3\r\nTransfer-Encoding: chunked','abc',400],['duplicate lengths','Content-Length: 3\r\nContent-Length: 2','xxx',400],['oversized chunk','Transfer-Encoding: chunked','200001\r\n',413],['missing declared bytes','Content-Length: 1234','{}',400]
])test('HTTP streaming refuses '+name,async t=>withHost(home(t),{EIGHTMAX_CHECKPOINT_MIB:'1'},async(api,url)=>{
 assert.equal((await write(url,legacy.exact.text)).status,200);assert.equal(await(await wire(url,h,b)).result,status);
 assert.equal(await(await api('checkpoint/latest')).text(),legacy.exact.text);
}));
test('disk reserve returns 507 and preserves the previous save',async t=>{
 const h=home(t);await withHost(h,{},async(api,u)=>assert.equal((await write(u,legacy.exact.text)).status,200));
 await withHost(h,{EIGHTMAX_CHECKPOINT_RESERVE_MIB:'1048576'},async(api,u)=>{assert.equal((await write(u,legacy.wide.text)).status,507);assert.equal(await(await api('checkpoint/latest')).text(),legacy.exact.text);});
});
test('cancel and concurrent uploader leave the first committed pair intact',async t=>withHost(home(t),{},async(api,url)=>{
 for(const x of [legacy.exact.text,legacy.wide.text])assert.equal((await write(url,x)).status,200);
 const {s,result}=await wire(url,'Content-Length: 500000','abc',false);
 for(let i=0;i<50;i++){if((await(await api('checkpoint/progress')).json()).receivedBytes===3)break;await delay(10);}
 assert.equal((await write(url,legacy.exact.text)).status,503);
 await api('checkpoint/cancel',{});s.end('x');assert.equal(await result,409);
 assert.equal((await(await api('checkpoint/status')).json()).generation,'2');assert.equal(await(await api('checkpoint/latest')).text(),legacy.wide.text);
}));
test('ingress timeout releases writer and restart discards abandoned scratch',async t=>{
 const h=home(t);await withHost(h,{EIGHTMAX_CHECKPOINT_IDLE_SECONDS:'1'},async(api,u)=>{
  assert.equal((await write(u,legacy.exact.text)).status,200);const {result}=await wire(u,'Content-Length: 2000','x',false);assert.equal(await result,408);
  const dir=(await(await api('info')).json()).saveDir;for(const n of ['autosave.index.tmp.body','autosave.verify.raw','autosave.verify.sort.4'])fs.writeFileSync(path.join(dir,n),'incomplete');
 });
 await withHost(h,{},async(api)=>{assert.equal(await(await api('checkpoint/latest')).text(),legacy.exact.text);
  const dir=(await(await api('info')).json()).saveDir;assert.ok(!fs.readdirSync(dir).some(n=>/\.tmp\.body$|\.verify\./.test(n)));});
});
test('new estimator agrees across JavaScript and native, including continuation',async t=>{
 const h=home(t),g=E.MultiwayGame({...cfg,traversal:'external',terminalExpectation:true}),spec=path.join(h,'s'),state=path.join(h,'state');fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));
 const cli=process.env.EM_TEST_MWCLI||require('./native_build').cli().cli;
 cp.execFileSync(cli,[spec,'70','2',state,'128']);const b=E.MultiwayGame({...cfg,traversal:'external',terminalExpectation:true});b.importNative(fs.readFileSync(state));g.iterate(70);
 const h1=E.exactCheckSampled(g.resolvedConfig,g),h2=E.exactCheckSampled(b.resolvedConfig,b);assert.deepEqual(h1.gain,h2.gain);
 const restored=(await E.loadStudyFile(await arch(b.archiveState()))).game;assert.ok(Buffer.from(restored.exportNative(true)).equals(fs.readFileSync(state)));
});
test('measured selection respects manual configuration and keeps pilot deals outside the real study',async()=>{
 const result=await E.selectByTrials({...cfg,traversal:'external',weighting:'uniform',regretMatching:'standard'},async g=>{g.iterate(16);return {seconds:.01,backend:'test budget'};});
 assert.equal(result.cfg.traversal,'external');assert.equal(result.cfg.weighting,'uniform');assert.equal(result.trials.length,3);assert.equal(E.MultiwayGame(result.cfg).iterations,0);
});
test('slow simulated CUDA scoring selects CPU and preserves complete state',{skip:process.platform!=='linux'},t=>{
 const h=home(t),g=E.MultiwayGame({...cfg,board:'Qs9h4d2c',traversal:'external',batchDeals:64}),base=g.nativeSpec(),tool=require('./native_build').cli();
 const cli=process.env.EM_TEST_MWCLI||tool.cli;
 function run(mode){const spec=path.join(h,mode+'.json'),state=path.join(h,mode+'.state');fs.writeFileSync(spec,JSON.stringify({...base,device:mode}));
 return [JSON.parse(cp.execFileSync(cli,[spec,'3','2',state,'256'],{env:{...process.env,LD_LIBRARY_PATH:tool.fixtureDir,EM_FIXTURE_FAULT:'slow'}})),fs.readFileSync(state)];}
 const [cpu,ref]=run('cpu'),[hybrid,b]=run('hybrid');assert.match(hybrid.devicePath,/CPU scoring/);assert.ok(b.equals(ref));assert.equal(cpu.trainingDeals,hybrid.trainingDeals);
});
test('128 MiB HTTP chunked native study, streaming read and cold reconstruction',{timeout:210000},t=>{
 const report=path.join(home(t),'sizes.json'),host=process.env.EM_TEST_HOST||require('./native_build').host().exe;
 cp.execFileSync(process.platform==='win32'?'python':'python3',[path.join(__dirname,'../tools/checkpoint_stress36.py'),host,report,'128'],{timeout:205000});
 const row=JSON.parse(fs.readFileSync(report)).runs[0];assert.ok(row.storedBytes>128*1024*1024);assert.ok(row.chunkedHTTP);
 if(row.saveHostHighWaterBytes!==null)assert.ok(row.saveHostHighWaterBytes<128*1024*1024);
});
test('process death during streaming preserves two prior generations',async t=>{
 const h=home(t);let interrupted,dir;
 await withHost(h,{},async(api,url)=>{
  for(const x of [legacy.exact.text,legacy.wide.text])assert.equal((await write(url,x)).status,200);
  dir=(await(await api('info')).json()).saveDir;
  const pending=await wire(url,'Content-Length: 1000000','partial',false);interrupted=pending.result.catch(()=>0);
  for(let i=0;i<100;i++){if((await(await api('checkpoint/progress')).json()).receivedBytes===7)break;await delay(10);}
  assert.ok(fs.readdirSync(dir).some(n=>n.endsWith('.tmp.body')));
 });
 await interrupted;await withHost(h,{},async api=>{
  assert.equal(await(await api('checkpoint/latest')).text(),legacy.wide.text);assert.equal(await(await api('checkpoint/previous')).text(),legacy.exact.text);
  assert.ok(!fs.readdirSync(dir).some(n=>n.endsWith('.tmp.body')));
 });
});
test('cold scan rejects a forged slot with a matching outer hash',async t=>{
 const profile=home(t);let file;
 await withHost(profile,{},async(api,url)=>{
  assert.equal((await write(url,legacy.exact.text)).status,200);
  const g=E.MultiwayGame({...cfg,traversal:'external'});g.iterate(14);g.importNative(g.exportNative());
  assert.equal((await write(url,await arch(g.archiveState()))).status,200);
  const status=await(await api('checkpoint/status')).json(),d=(await(await api('info')).json()).saveDir;file=path.join(d,'autosave.'+status.latestSlot+'.em35');
 });
 const frame=fs.readFileSync(file);frame[frame.length-1]^=1;
 frame.write(crypto.createHash('sha256').update(frame.subarray(69)).digest('hex'),4,64,'ascii');fs.writeFileSync(file,frame);
 await withHost(profile,{},async api=>{assert.equal(await(await api('checkpoint/latest')).text(),legacy.exact.text);assert.ok((await(await api('checkpoint/status')).json()).slots.includes(400));});
});
test('legacy native base64 across block boundaries restores every trained byte',t=>{
 const d=home(t),spec=path.join(d,'s.json'),state=path.join(d,'state');
 const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'../../validation/3.6/linked-fixture/meta.json'))).cfg,g=E.MultiwayGame(cfg);
 fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));cp.execFileSync(process.env.EM_TEST_MWCLI||require('./native_build').cli().cli,[spec,'80','2',state,'256']);
 const raw=fs.readFileSync(state);assert.ok(raw.length>65536);g.importNative(raw);const p=g.snapshot(),builtin=Uint8Array.fromBase64;
 for(const fn of [builtin,undefined]){try{Uint8Array.fromBase64=fn;assert.ok(Buffer.from(E.restoreCheckpoint(p).game.exportNative(true)).equals(raw));}finally{Uint8Array.fromBase64=builtin;}}
});
