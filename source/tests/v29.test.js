'use strict';
// EightMax 2.9: native C++ multiway engine against the JavaScript reference
// (bit-identical training state), thread-count independence, memory limits,
// malformed native state, checkpoint continuity through the native engine, and
// the native host's versioned /api/mw protocol.
// The native pieces are compiled from source/native into a temporary directory
// with the system C/C++ compilers; without them these tests are skipped (and the
// release script fails, because it requires them).
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync,spawn}=require('node:child_process');
const E=require('../tools/loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river','lib_river_ui'])require('../web/'+l+'.js');
const native=path.join(__dirname,'../native'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'em29-'));
let cli=null,why='';
try{
  execFileSync('gcc',['-O2','-c',path.join(native,'json.c'),'-o',path.join(tmp,'json.o')]);
  execFileSync('g++',['-std=c++20','-O2','-ffp-contract=off','-I'+native,path.join(native,'mw.cpp'),path.join(native,'mwcli.cpp'),path.join(tmp,'json.o'),'-lpthread','-o',path.join(tmp,'mwcli')]);
  cli=path.join(tmp,'mwcli');
}catch(e){why='C/C++ compiler unavailable: '+e.message.split('\n')[0];}
const skip=cli?false:why;
let seq=0;
function runNative(spec,iterations,threads,{memoryMiB=1024,from=null}={}){
  const f=path.join(tmp,'s'+(++seq)),specFile=f+'.json',out=f+'.state';
  fs.writeFileSync(specFile,JSON.stringify(spec));
  const args=[specFile,String(iterations),String(threads),out,String(memoryMiB)];
  if(from){fs.writeFileSync(f+'.in',from);args.push(f+'.in');}
  const info=JSON.parse(execFileSync(cli,args).toString());
  return {info,state:fs.readFileSync(out)};
}
// Rows as hex, ignoring all-zero rows (JavaScript also creates empty rows for
// information sets it only reads; an empty row and a missing row both mean uniform).
function rows(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength),hl=dv.getUint32(8,true);let p=12+hl;const c=dv.getUint32(p,true);p+=4;const m=new Map();
  for(let i=0;i<c;i++){const k=u8[p+8],v=Buffer.from(u8.subarray(p+9,p+9+16*k));if(v.some(x=>x))m.set(Buffer.from(u8.subarray(p,p+8)).toString('hex'),v.toString('hex'));p+=9+16*k;}
  return m;
}
function sameRows(a,b){const x=rows(a),y=rows(b);assert.equal(x.size,y.size,'row count');for(const [k,v] of x)assert.equal(y.get(k),v,'row '+k);}
const river3={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc:0.5,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
  streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',traversal:'full',evaluationDeals:128,privateSeed:9};
const turn3={...river3,board:'Ks8d5h2c',streets:{turn:{bets:'50',raises:'',maxBets:1},river:{bets:'75',raises:'2.5x',maxBets:2}}};
const flop3={...river3,board:'Ks8d5h',stacks:[12,12,12],streets:{flop:{bets:'50',raises:'',maxBets:1},turn:{bets:'75',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}}};

const cases=[
  ['3-player river, one deal per update',river3,{},400,1],
  ['3-player river, frozen batches of 4, 4 threads',river3,{batchDeals:4},150,4],
  ['3-player river, batches of 16, CFR+ clipping',river3,{batchDeals:16,regretMatching:'plus'},40,3],
  ['3-player river, uniform weighting, batches of 8',river3,{batchDeals:8,weighting:'uniform'},40,8],
  ['3-player river, alternating seats',river3,{updates:'alternating'},150,2],
  ['3-player river, own-hand enumeration, batches of 4',river3,{updates:'enumerate',batchDeals:4},30,4],
  ['3-player turn start (hashed rows), batches of 4',turn3,{batchDeals:4},80,4],
  ['3-player turn start, own-hand enumeration',turn3,{updates:'enumerate'},20,4],
  ['3-player flop start, batches of 2',flop3,{batchDeals:2},40,4]];
for(const [name,base,over,its,threads] of cases){
  test('native training matches JavaScript bit for bit: '+name,{skip},()=>{
    const cfg={...base,...over},js=E.MultiwayGame(cfg),nat=E.MultiwayGame(cfg);
    const {info,state}=runNative(nat.nativeSpec(),its,threads);
    js.iterate(its);nat.importNative(state);
    sameRows(js.exportNative(),nat.exportNative());
    assert.equal(info.trainingDeals,js.trainingDeals);assert.equal(info.stateVisits,js.metrics().stateVisits);
    // JavaScript also counts the empty rows it creates for information sets it
    // only reads, so information-set counts and storage estimates may differ.
    const strip=m=>{const {infos,strategyMiB,...rest}=m;return rest;};
    assert.deepEqual(strip(nat.metrics()),strip(js.metrics()));
    assert.deepEqual(nat.view([]),js.view([]));
  });
}
test('native multithreaded merge path (large tree) matches one thread and JavaScript',{skip,timeout:240000},()=>{
  const cfg={...E.multiwaySpotConfig(E.multiwayExample(6,'River',8)),privateMode:'sampled',abstraction:'exact',engine:'native',batchDeals:16,evaluationDeals:128};
  const js=E.MultiwayGame(cfg),spec=js.nativeSpec();
  const one=runNative(spec,6,1),four=runNative(spec,6,4);
  assert.ok(four.info.threads>1);
  sameRows(one.state,four.state);
  js.iterate(6);const nat=E.MultiwayGame(cfg);nat.importNative(four.state);sameRows(js.exportNative(),nat.exportNative());
});
test('native results do not depend on the thread count',{skip},()=>{
  const g=E.MultiwayGame({...turn3,batchDeals:16}),spec=g.nativeSpec(),ref=runNative(spec,25,1).state;
  for(const t of [2,3,4,7])sameRows(ref,runNative(spec,25,t).state);
});
test('JavaScript continues a native-trained study exactly, and native continues a JavaScript study',{skip},async()=>{
  const cfg={...river3,batchDeals:4},a=E.MultiwayGame(cfg),b=E.MultiwayGame(cfg);
  a.iterate(120);
  // half in JavaScript, then native from the exported state, then JavaScript again via a checkpoint
  b.iterate(50);const mid=runNative(b.nativeSpec(),70,2,{from:b.exportNative()});
  const c=E.MultiwayGame(cfg);c.importNative(mid.state);
  sameRows(a.exportNative(),c.exportNative());
  const restored=E.restoreCheckpoint(await E.decodeCheckpoint(await E.encodeCheckpoint(c.snapshot()))).game;
  a.iterate(30);restored.iterate(30);sameRows(a.exportNative(),restored.exportNative());
  assert.deepEqual(restored.metrics(),a.metrics());
});
test('native engine refuses tables over its memory budget and stops cleanly when hashed rows reach it',{skip},()=>{
  const big=E.MultiwayGame({...E.multiwaySpotConfig(E.multiwayExample(8,'River',8)),privateMode:'sampled',abstraction:'exact',engine:'native',batchDeals:4,evaluationDeals:128});
  assert.throws(()=>runNative(big.nativeSpec(),1,1,{memoryMiB:1}),/native budget/);
  const flop=E.MultiwayGame({...flop3,ranges:Array(3).fill('random'),batchDeals:4});
  const r=runNative(flop.nativeSpec(),200,2,{memoryMiB:4});
  assert.equal(r.info.limitReached,true);assert.ok(r.info.iterations<200);
  const g=E.MultiwayGame({...flop3,ranges:Array(3).fill('random'),batchDeals:4});g.importNative(r.state);
  assert.equal(g.iterations,r.info.iterations);assert.ok(g.metrics().ev.every(Number.isFinite));
});
test('malformed specs and native states are rejected',{skip},()=>{
  const g=E.MultiwayGame(river3),spec=g.nativeSpec();
  for(const bad of [{...spec,protocol:2},{...spec,n:9},{...spec,board:[1,1,2,3,4]},{...spec,nodes:[[0,0,5,[0]]]},{...spec,batchDeals:65},{...spec,weighting:'x'}])
    assert.throws(()=>runNative(bad,1,1));
  const good=runNative(spec,5,1).state;
  for(const st of [good.subarray(0,40),Buffer.concat([good,Buffer.from([1])]),Buffer.from('EMMW2'+'\0'.repeat(30))])
    assert.throws(()=>runNative(spec,1,1,{from:st}),/state|State/);
  const nan=Buffer.from(good);nan.writeDoubleLE(NaN,nan.length-8);assert.throws(()=>runNative(spec,1,1,{from:nan}),/invalid values/);
  assert.throws(()=>g.importNative(good.subarray(0,30)));
});
test('studies outside native support say why and keep JavaScript training',()=>{
  assert.match(E.MultiwayGame({...river3,abstraction:'detailed'}).nativeSupport(),/Exact cards/);
  assert.match(E.MultiwayGame({...river3,icm:{payouts:[50,30,20]}}).nativeSupport(),/ICM/);
  assert.match(E.MultiwayGame({...river3,traversal:'external'}).nativeSupport(),/full betting tree/);
  assert.equal(E.MultiwayGame(river3).nativeSupport(),null);
  // engine:'native' asks automatic traversal for a full tree with exact cards only
  const g=E.MultiwayGame({...E.multiwaySpotConfig(E.multiwayExample(4,'Flop',8)),privateMode:'sampled',abstraction:'exact',engine:'native'});
  assert.equal(g.metrics(128).algorithm,'full');
});

// ---- native host protocol ----
test('native host: /api/mw init, train, status, stop, state, import, memory and errors',{skip,timeout:240000},async()=>{
  const build=path.join(tmp,'build');
  execFileSync(process.execPath,[path.join(__dirname,'../tools/build.js'),build]);
  execFileSync('sh',[path.join(native,'build.sh'),'linux',path.join(build,'native.html'),path.join(build,'linux')]);
  const port=18000+Math.floor(Math.random()*20000),home=fs.mkdtempSync(path.join(tmp,'home'));
  const host=spawn(path.join(build,'linux','eightmax'),['--no-browser','--port='+port],{env:{...process.env,HOME:home,EIGHTMAX_GPU:'off',EIGHTMAX_THREADS:'4'},stdio:'ignore'});
  const base='http://127.0.0.1:'+port;
  const call=async(route,body,raw)=>{
    const init={method:body===undefined?'GET':'POST',headers:{'X-EightMax':'1'}};
    if(body!==undefined){init.body=raw?body:JSON.stringify(body);init.headers['Content-Type']=raw?'application/octet-stream':'application/json';}
    const r=await fetch(base+route,init);return {status:r.status,body:r.headers.get('content-type')?.includes('octet')?new Uint8Array(await r.arrayBuffer()):await r.json()};
  };
  try{
    for(let i=0;i<100;i++){try{await call('/api/info');break;}catch(e){await new Promise(r=>setTimeout(r,100));}}
    const info=(await call('/api/info')).body;assert.equal(info.multiwayProtocol,1);
    assert.equal((await call('/api/mw/train',{iterations:5})).status,400,'train before init');
    assert.equal((await call('/api/mw/init','')).status,400,'empty spec');
    const cfg={...river3,batchDeals:4},js=E.MultiwayGame(cfg),nat=E.MultiwayGame(cfg);
    const init=await call('/api/mw/init',nat.nativeSpec());assert.equal(init.status,200);assert.ok(init.body.budgetMiB>0);
    assert.equal((await call('/api/mw/train',{iterations:0})).status,400);
    assert.equal((await call('/api/mw/train',{iterations:300,threads:2})).status,200);
    let st;for(;;){st=(await call('/api/mw/status')).body;if(!st.running)break;await new Promise(r=>setTimeout(r,20));}
    assert.equal(st.error,null);assert.equal(st.iterations,300);
    const state=(await call('/api/mw/state')).body;nat.importNative(state);js.iterate(300);sameRows(js.exportNative(),nat.exportNative());
    // long run, then stop: the state stays consistent and resumable
    assert.equal((await call('/api/mw/train',{iterations:5000000})).status,200);
    assert.equal((await call('/api/mw/train',{iterations:10})).status,409,'second job refused');
    assert.equal((await call('/api/mw/state')).status,409,'state refused while training');
    await new Promise(r=>setTimeout(r,150));await call('/api/mw/stop',{});
    for(;;){st=(await call('/api/mw/status')).body;if(!st.running)break;await new Promise(r=>setTimeout(r,20));}
    assert.ok(st.iterations>300&&st.iterations<5000300);
    const stopped=(await call('/api/mw/state')).body,again=E.MultiwayGame(cfg);again.importNative(stopped);
    const ref=E.MultiwayGame(cfg);ref.iterate(again.iterations);sameRows(ref.exportNative(),again.exportNative());
    assert.equal((await call('/api/mw/import',Buffer.from('junk'),true)).status,400);
    assert.equal((await call('/api/mw/import',stopped,true)).status,200);
    const mem=await call('/api/memory',{browserMiB:123});assert.equal(mem.body.browserReportedMiB,123);assert.ok(mem.body.processLimitMiB>0&&mem.body.residentMiB>0);
    assert.equal((await call('/api/memory',{browserMiB:-1})).status,400);
    assert.equal((await call('/api/mw/free',{})).status,200);assert.equal((await call('/api/mw/state')).status,409);
  }finally{host.kill('SIGKILL');}
});
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
