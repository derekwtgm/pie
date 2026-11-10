'use strict';
// EightMax 3.1: native betting rules + external-sampling MCCFR (spec protocol 4),
// EMMW4 state integrity, resume continuity, the resource-based automatic
// full-tree limit, 3.0 checkpoint compatibility, property tests (chip
// conservation, probability normalisation, card uniqueness, ICM invariants),
// exact all-in equity and the CUDA driver test double.
// Time limits: every test declares one. A timeout is reported as a failure.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const E=require('../tools/loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river','lib_river_ui','lib_checkpoint'])require('../web/'+l+'.js');
const {cli:nativeCli}=require('./native_build');
const built=nativeCli(),cli=built.cli,skip=cli?false:built.why;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'em31-'));
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
let seq=0;
function runNative(spec,iterations,threads,{memoryMiB=1024,from=null,env}={}){
  const f=path.join(tmp,'s'+(++seq)),specFile=f+'.json',out=f+'.state';
  fs.writeFileSync(specFile,JSON.stringify(spec));
  const args=[specFile,String(iterations),String(threads),out,String(memoryMiB)];
  if(from){fs.writeFileSync(f+'.in',from);args.push(f+'.in');}
  const info=JSON.parse(execFileSync(cli,args,{env:env||process.env,stdio:['ignore','pipe','pipe']}).toString());
  return {info,state:fs.readFileSync(out)};
}
// EMMW4 rows keyed by action path, hand index and public cards; zero rows ignored.
function rows4(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength),hl=dv.getUint32(8,true);let p=12+hl;const sc=dv.getUint32(p,true);p+=4;
  const paths=[];for(let i=0;i<sc;i++){const par=dv.getUint32(p,true),slot=u8[p+4];paths.push(i?paths[par]+(slot===7?'c':slot):'r');p+=9;}
  const c=dv.getUint32(p,true);p+=4;const m=new Map();
  for(let i=0;i<c;i++){const st=dv.getUint32(p,true),k=u8[p+11],v=Buffer.from(u8.subarray(p+12,p+12+16*k));
    if(v.some(x=>x))m.set(paths[st]+'|'+Buffer.from(u8.subarray(p+4,p+11)).toString('hex'),v.toString('hex'));p+=12+16*k;}
  return m;
}
function sameRows(a,b){const x=rows4(a),y=rows4(b);assert.ok(x.size>0,'no rows');assert.equal(x.size,y.size,'row count');for(const [k,v] of x)assert.equal(y.get(k),v,'row '+k);}
function crc(bytes){let c=-1;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return ((~c)>>>0).toString(16).padStart(8,'0');}
function refreshCrc(u8){const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength),hl=dv.getUint32(8,true);u8.set(Buffer.from(crc(u8.subarray(12+hl))),12+hl-10);return u8;}

const river3={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc:0.5,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
  streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:128,privateSeed:9};
const flop3={...river3,board:'Ks8d5h',stacks:[12,20,30],streets:{flop:{bets:'33,a',raises:'3x',maxBets:2},turn:{bets:'75,g',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}}};
const pf8={preflop:{mode:'linked',opens:'2,a',raises:'2.75x,a',maxBets:3,limps:true},board:'',dealt:8,common:0,stacks:[24.9,18,40,12,30,9,55,20],ranges:Array(8).fill('random'),privateMode:'sampled',evaluationDeals:128,abstraction:'exact',
  streets:{flop:{bets:'33,75',raises:'3x',maxBets:2},turn:{bets:'66',raises:'a',maxBets:2},river:{bets:'75,a',raises:'',maxBets:1}},privateSeed:4};
const noLimp8={...pf8,preflop:{...pf8.preflop,limps:false},anteType:'bba'};
const shove8={preflop:{mode:'shove'},dealt:8,common:0,board:'',privateMode:'sampled',abstraction:'exact',stacks:[10,6,14,3,9,12,7.5,11],ranges:Array(8).fill('random'),evaluationDeals:128,icm:{payouts:[50,30,20]}};
const six={board:'Td7c2h',dealt:8,common:1.5,stacks:[20,35,8,50,14,26],prior:[2.5,2.5,2.5,2.5,2.5,2.5],folded:[1,2.5],ranges:Array(6).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6'),privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:128,
  streets:{flop:{bets:'33,a',raises:'3x,a',maxBets:3},turn:{bets:'50,g',raises:'a',maxBets:2},river:{bets:'75,150',raises:'a',maxBets:2}}};
const heads={board:'Qs9h4d',common:6,stacks:[40,25],ranges:['random','random'],streets:{flop:{bets:'50',raises:'3x',maxBets:2},turn:{bets:'75',raises:'',maxBets:1},river:{bets:'100,a',raises:'',maxBets:1}},
  privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:128,lead:[false,true]};

const cases=[
  ['3-player river, one deal per update',river3,{},300,1],
  ['3-player river, frozen batches of 4, per-deal streams, 4 threads',river3,{batchDeals:4,actionStreams:'deal'},100,4],
  ['3-player flop, unequal stacks, geometric sizing and all-ins',flop3,{},150,1],
  ['3-player flop, CFR+ with batches of 8 (shared stream)',flop3,{batchDeals:8,regretMatching:'plus'},40,4],
  ['3-player flop, ICM with an off-table stack',{...flop3,icm:{payouts:[50,30,20],others:[15]}},{},100,1],
  ['heads-up flop, out-of-position seat may not lead',heads,{batchDeals:2},120,2],
  ['8-seat linked preflop to river, unequal stacks',pf8,{},30,1],
  ['8-seat linked preflop, batches of 16 per-deal x4, CFR+',pf8,{batchDeals:16,actionStreams:'deal',regretMatching:'plus'},6,4],
  ['8-seat linked preflop, big blind ante, limping disabled',noLimp8,{},20,1],
  ['8-seat shove/call with ICM',shove8,{},200,1],
  ['6-seat flop, earlier and folded wagers, weighted ranges, multiway all-ins',six,{batchDeals:4},40,2],
  ['6-seat flop, uniform weighting',six,{weighting:'uniform'},60,1]];
for(const [name,base,over,its,threads] of cases){
  test('native external sampling matches JavaScript bit for bit: '+name,{skip,timeout:120000},()=>{
    const cfg={...base,...over},js=E.MultiwayGame(cfg),nat=E.MultiwayGame(cfg);
    assert.equal(js.nativeSupport(),null);
    const spec=nat.nativeSpec();assert.equal(spec.protocol,4);
    const {info,state}=runNative(spec,its,threads);
    js.iterate(its);
    sameRows(js.exportNative(),state);
    assert.equal(info.trainingDeals,js.trainingDeals);assert.equal(info.stateVisits,js.metrics().stateVisits);
    nat.importNative(state);
    sameRows(js.exportNative(),nat.exportNative());
    const strip=m=>{const {infos,strategyMiB,memoryBudgetMiB,...rest}=m;return rest;};
    assert.deepEqual(strip(nat.metrics()),strip(js.metrics()));
    assert.deepEqual(nat.view([]),js.view([]));
  });
}
test('per-deal action streams give the same result for every thread count',{skip,timeout:120000},()=>{
  const spec=E.MultiwayGame({...pf8,batchDeals:16,actionStreams:'deal'}).nativeSpec(),ref=runNative(spec,8,1);
  for(const t of [2,3,4,8]){const r=runNative(spec,8,t);sameRows(ref.state,r.state);assert.equal(r.info.rng,ref.info.rng);}
});
test('resume: JavaScript -> native -> native equals uninterrupted JavaScript, with different thread counts',{skip,timeout:120000},()=>{
  const cfg={...flop3,ranges:['random','random','random'],batchDeals:4,actionStreams:'deal'};
  const ref=E.MultiwayGame(cfg);ref.iterate(120);
  const js=E.MultiwayGame(cfg);js.iterate(50);
  const spec=js.nativeSpec(),a=runNative(spec,40,3,{from:js.exportNative()}),b=runNative(spec,30,2,{from:a.state});
  const back=E.MultiwayGame(cfg);back.importNative(b.state);
  assert.ok(Buffer.from(ref.exportNative()).equals(Buffer.from(back.exportNative())));
  assert.deepEqual(back.metrics(),ref.metrics());
  // .emstudy round trip of the native-trained study, then continue in JavaScript.
  const restored=E.restoreCheckpoint(JSON.parse(JSON.stringify(back.snapshot(['a','b','c'])))).game;
  restored.iterate(10);ref.iterate(10);assert.deepEqual(restored.metrics(),ref.metrics());
});
test('EMMW4 integrity: checksum, tampered states, foreign studies and truncation are rejected by both readers',{skip,timeout:120000},()=>{
  const cfg={...flop3,batchDeals:2},g=E.MultiwayGame(cfg),spec=g.nativeSpec(),{state}=runNative(spec,30,1);
  const flip=Uint8Array.from(state);flip[flip.length-5]^=0x10;
  assert.throws(()=>E.MultiwayGame(cfg).importNative(flip),/checksum/);
  assert.throws(()=>runNative(spec,1,1,{from:flip}),/checksum/);
  // Change a state's action slot and repair the checksum: the rules replay must catch it.
  const tamper=Uint8Array.from(state),dv=new DataView(tamper.buffer),hl=dv.getUint32(8,true),sc=dv.getUint32(12+hl,true);
  let changed=false;for(let i=1;i<sc&&!changed;i++){const at=16+hl+9*i;if(tamper[at+4]!==7){tamper[at+4]=6;changed=true;}}
  assert.ok(changed);refreshCrc(tamper);
  assert.throws(()=>runNative(spec,1,1,{from:tamper}),/does not match|Duplicate/);
  assert.throws(()=>E.MultiwayGame(cfg).importNative(tamper),/does not match|Invalid/);
  assert.throws(()=>runNative(spec,1,1,{from:state.subarray(0,state.length-7)}),/checksum|Truncated|Trailing/);
  const other=E.MultiwayGame({...cfg,privateSeed:10});
  assert.throws(()=>other.importNative(state),/different study/);
  assert.throws(()=>runNative(other.nativeSpec(),1,1,{from:state}),/different study/);
});
test('native memory budget: a small budget stops cleanly, keeps a valid state and resumes with a larger budget',{skip,timeout:120000},()=>{
  const cfg={...pf8,batchDeals:4,actionStreams:'deal'},spec=E.MultiwayGame(cfg).nativeSpec();
  const small=runNative(spec,500,2,{memoryMiB:2});
  assert.equal(small.info.limitReached,true);assert.ok(small.info.iterations<500);assert.ok(small.info.tableMiB<=2.0001,'table '+small.info.tableMiB);
  const g=E.MultiwayGame(cfg);g.importNative(small.state);assert.equal(g.iterations,small.info.iterations);
  const more=runNative(spec,5,2,{memoryMiB:256,from:small.state});
  assert.equal(more.info.limitReached,false);assert.equal(more.info.iterations,small.info.iterations+5);
  assert.throws(()=>runNative(spec,1,1,{memoryMiB:0.01}),/budget|state table/i);
});
test('malformed protocol 4 specs are refused with a reason',{skip,timeout:60000},()=>{
  const spec=E.MultiwayGame(flop3).nativeSpec();
  const bad=[[{algorithm:'full'},/external sampling only/],[{rules:{...spec.rules,stacks:[1,2]}},/stacks/],[{rules:{...spec.rules,sizes:{}}},/sizes/],
    [{actionStreams:'random'},/action stream/],[{weighting:'dcfr',dcfrAlpha:-1},/DCFR/],   // 3.3: valid ES-DCFR is supported; invalid parameters are refused
    [{rules:{...spec.rules,pre:true}},/Preflop/],[{stratified:true},/stratified/i]];
  for(const [over,re] of bad)assert.throws(()=>runNative({...spec,...over},1,1),re);
});
test('native support: Exact cards external sampling is native; grouped abstractions name the unsupported feature',()=>{
  assert.equal(E.MultiwayGame(flop3).nativeSupport(),null);
  // 3.3: grouped external-sampling flops train natively; grouped full traversal still names the JavaScript fallback.
  for(const abstraction of ['compact','detailed']){
    assert.equal(E.MultiwayGame({...flop3,abstraction}).nativeSupport(),null);
    assert.equal(E.MultiwayGame({...flop3,abstraction,traversal:'full',fullTreeStates:250000}).nativeSupport(),null);
  }
});
test('automatic native traversal counts the tree instead of building 250,000 states, and chooses by size',{timeout:60000},()=>{
  const base={board:'Td7c2h',dealt:8,common:1.5,stacks:Array(6).fill(60),prior:Array(6).fill(2.5),ranges:Array(6).fill('random'),privateMode:'sampled',abstraction:'exact',engine:'native',evaluationDeals:128,
    streets:{flop:{bets:'50',raises:'',maxBets:1},turn:{bets:'50',raises:'',maxBets:1},river:{bets:'50',raises:'',maxBets:1}}};
  const before=process.memoryUsage().heapUsed,t=performance.now(),big=E.MultiwayGame(base);
  assert.equal(big.metrics(128).algorithm,'external');assert.ok(performance.now()-t<5000);
  assert.ok(process.memoryUsage().heapUsed-before<120*1048576,'automatic decision must not materialise the full tree');
  const small=E.MultiwayGame({...river3,traversal:'auto',engine:'native'});assert.equal(small.metrics(128).algorithm,'full');
  assert.equal(E.MultiwayGame({...base,traversal:'full',fullTreeStates:250000,stacks:Array(6).fill(4)}).metrics(128).algorithm,'full');
});
test('a 3.0 checkpoint of an automatic native full-tree study (20k-250k states) still restores',{timeout:120000},()=>{
  const cfg={...river3,traversal:'full',fullTreeStates:250000,ranges:Array(3).fill('random'),stacks:[100,100,100],streets:{river:{bets:'20,33,50,75,a',raises:'2x,3x,a',maxBets:5}}};
  const g=E.MultiwayGame(cfg);const states=g.metrics(128).nodes;assert.ok(states>20000&&states<250000,'fixture has '+states+' states');
  g.iterate(3);
  const p=g.snapshot(['a','b','c']);p.writer='3.0';p.cfg={...p.cfg,traversal:'auto',engine:'native'};delete p.cfg.fullTreeStates;
  const r=E.restoreCheckpoint(JSON.parse(JSON.stringify(p))).game;
  assert.equal(r.iterations,3);assert.deepEqual(r.view([]),g.view([]));
});
// ---- property tests ----
function rng(seed){let s=seed>>>0;return ()=>{s=(s+0x6d2b79f5)>>>0;let x=Math.imul(s^(s>>>15),s|1);x^=x+Math.imul(x^(x>>>7),x|61);return((x^(x>>>14))>>>0)/4294967296;};}
test('property: side-pot layers conserve chips and only pay eligible or refunded seats',{timeout:30000},()=>{
  const r=rng(31);
  for(let trial=0;trial<3000;trial++){
    const n=2+Math.floor(r()*7),committed=Array.from({length:n},()=>Math.round(r()*40)/4),live=committed.map(()=>r()<0.7);
    if(!live.some(Boolean))live[Math.floor(r()*n)]=true;
    const common=r()<0.5?Math.round(r()*30)/10:0,pots=E.potLayers(committed,live,common);
    const total=pots.reduce((a,p)=>a+p.amount,0),expected=committed.reduce((a,b)=>a+b,0)+common;
    assert.ok(Math.abs(total-expected)<1e-6,trial+': '+total+' vs '+expected);
    for(const pot of pots){assert.ok(pot.eligible.length>0);
      if(pot.eligible.some(s=>!live[s]))assert.equal(pot.eligible.length,1,'only an uncalled refund goes to a folded seat');}
    const scores=committed.map(()=>Math.floor(r()*5)),chips=E.awardPots(pots,scores,committed.map(()=>0));
    assert.ok(Math.abs(chips.reduce((a,b)=>a+b,0)-total)<1e-6);
  }
});
test('property: every terminal of random multiway trees conserves chips (pots = all wagers + antes + common)',{timeout:60000},()=>{
  const r=rng(7);
  for(let trial=0;trial<25;trial++){
    const n=2+Math.floor(r()*5),cfg={board:'Td7c2h',dealt:8,common:Math.round(r()*20)/10,stacks:Array.from({length:n},()=>2+Math.round(r()*60)),
      prior:Array(n).fill(1),ranges:Array(n).fill('random'),privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:128,
      streets:{flop:{bets:'50,a',raises:'2.5x',maxBets:2},turn:{bets:'a',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}}};
    const g=E.MultiwayGame(cfg),dead=E.anteModel(cfg).total(8)+cfg.common;
    let path=[];
    for(let step=0;step<40;step++){
      const v=g.view(path);
      if(v.kind==='terminal'){
        const pot=v.pots.reduce((a,p)=>a+p.amount,0);
        assert.ok(Math.abs(pot-(v.pot))<1e-6,'pot layers equal the pot');
        assert.ok(Math.abs(pot-(dead+n*1+cfg.stacks.reduce((a,s,i)=>a+Math.min(s,s-v.behind[i]),0)))<1e-6,'chips conserved');
        break;
      }
      if(v.kind==='chance'){const used=new Set(v.board);let c=0;while(used.has(c))c++;path=[...path,{card:c}];continue;}
      path=[...path,Math.floor(r()*v.actions.length)];
    }
  }
});
test('property: strategies are normalised and sampled deals never share cards',{timeout:60000},()=>{
  const g=E.MultiwayGame({...six,traversal:'external'});g.iterate(30);
  const v=g.view([]);
  for(const h of v.hands){const s=h.mix.reduce((a,b)=>a+b,0);assert.ok(Math.abs(s-1)<1e-12,'mix sums to 1');assert.ok(h.mix.every(x=>x>=0));}
  assert.ok(Math.abs(v.actions.reduce((a,x)=>a+x.frequency,0)-1)<1e-9);
  const state=g.exportNative(),dv=new DataView(state.buffer,state.byteOffset),hl=dv.getUint32(8,true);let p=12+hl;const sc=dv.getUint32(p,true);p+=4+9*sc;
  const count=dv.getUint32(p,true);p+=4;const board=E.parseBoard(six.board);
  for(let i=0;i<count;i++){
    const k=state[p+11],cards=[...state.subarray(p+6,p+11)].filter(c=>c).map(c=>c-1);
    assert.equal(new Set(cards).size,cards.length);for(const c of board)assert.ok(cards.includes(c));
    for(let a=0;a<k;a++)assert.ok(dv.getFloat64(p+12+8*(k+a),true)>=0,'average weights are nonnegative');
    p+=12+16*k;
  }
});
test('property: ICM prizes sum to the paid places, rise with stack, and split exact ties',{timeout:30000},()=>{
  const r=rng(99);
  for(let trial=0;trial<300;trial++){
    const n=2+Math.floor(r()*10),stacks=Array.from({length:n},()=>1+Math.round(r()*50)),pay=[50,30,20,10,5].slice(0,1+Math.floor(r()*Math.min(5,n)));
    const eq=E.icmRaw(stacks,pay),total=pay.reduce((a,b)=>a+b,0);
    assert.ok(Math.abs(eq.reduce((a,b)=>a+b,0)-total)<1e-9);
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      if(stacks[i]>stacks[j])assert.ok(eq[i]>=eq[j]-1e-12);
      if(stacks[i]===stacks[j])assert.ok(Math.abs(eq[i]-eq[j])<1e-9);
    }
  }
});
// ---- exact equity and CUDA test double ----
function equity(spec,env){const f=path.join(tmp,'eq'+(++seq)+'.json');fs.writeFileSync(f,JSON.stringify(spec));return JSON.parse(execFileSync(cli,['--equity',f],{env:env||process.env}).toString());}
function jsEquity(hands,board){const used=new Set([...hands.flat(),...board]),deck=[...Array(52).keys()].filter(c=>!used.has(c)),need=5-board.length,w=hands.map(()=>0);let n=0;const pick=[];
  (function rec(s){if(pick.length===need){const b=[...board,...pick],sc=hands.map(h=>E.evalCards([...b,...h])),m=Math.max(...sc),k=sc.filter(x=>x===m).length;sc.forEach((x,i)=>{if(x===m)w[i]+=1/k;});n++;return;}
    for(let i=s;i<deck.length;i++){pick.push(deck[i]);rec(i+1);pick.pop();}})(0);return {n,eq:w.map(x=>x/n)};}
test('exact all-in equity: native enumeration equals an independent JavaScript enumeration',{skip,timeout:120000},()=>{
  for(const [hands,board] of [[[[48,49],[44,45],[40,36]],[46,30,13]],[[[48,49],[44,45],[40,36],[0,5]],[46,30,13,7]],[[[51,47],[50,46]],[]],[[[0,4],[1,5],[2,6]],[8,12,16,20,24]]]){
    const nat=equity({hands,board,device:'cpu',threads:3}),js=jsEquity(hands,board);
    assert.equal(nat.boards,js.n);nat.equity.forEach((x,i)=>assert.ok(Math.abs(x-js.eq[i])<5e-9,x+' vs '+js.eq[i]));
    assert.equal(nat.shareUnits.reduce((a,b)=>a+b,0),840*nat.boards,'every board awards exactly 840 units');
  }
  assert.throws(()=>equity({hands:[[1,2],[2,3]]}),/duplicate/i);
});
const fixture=built.fixtureDir&&path.join(built.fixtureDir,'libcuda.so.1');
const fxSkip=skip||process.platform!=='linux'||!fixture||!fs.existsSync(fixture)?'CUDA test double needs Linux and a C++ compiler':false;
const withFixture=(fault)=>({...process.env,LD_LIBRARY_PATH:built.fixtureDir+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:''),EM_FIXTURE_FAULT:fault||''});
test('CUDA test double: probe reports device, SASS image and VRAM reserve; equity kernel matches CPU exactly',{skip:fxSkip,timeout:180000},()=>{
  const info=JSON.parse(execFileSync(cli,['--cuda-info'],{env:withFixture()}).toString());
  assert.equal(info.available,true);assert.equal(info.computeCapability,'8.9');assert.equal(info.image,'sm_89 SASS');assert.equal(info.reserveMiB,2048);
  const none=JSON.parse(execFileSync(cli,['--cuda-info'],{env:{...process.env,LD_LIBRARY_PATH:''}}).toString());
  assert.equal(none.available,false);assert.ok(none.reason.length>0);
  const r=equity({hands:[[48,49],[44,45],[40,36],[0,5],[1,9],[2,30]],board:[],device:'both',threads:2},withFixture());
  assert.equal(r.gpuMatchesCpu,true);assert.equal(r.boards,658008);
});
test('CUDA test double: GPU equity equals CPU; failures fall back to CPU with a stated reason',{skip:fxSkip,timeout:180000},()=>{
  const spec={hands:[[48,49],[44,45],[40,36],[0,5],[1,9]],board:[46,13,30],device:'both',threads:2};
  const ok=equity(spec,withFixture());assert.equal(ok.gpuUsed,true);assert.equal(ok.gpuMatchesCpu,true);
  const ref=equity({...spec,device:'cpu'});
  for(const fault of ['oldgpu','pressure','alloc','launch','download','missing','nodevice']){
    const r=equity({...spec,device:'gpu'},withFixture(fault));
    assert.equal(r.gpuUsed,false,fault);assert.deepEqual(r.shareUnits,ref.shareUnits,fault);assert.ok(r.gpuFallbackReason,fault);
  }
  assert.match(equity({...spec,device:'gpu'},withFixture('oldgpu')).gpuFallbackReason,/compute capability 6\.1/);
});
test('CUDA routing: river starts and external sampling stay on CPU and say why; turn studies keep CPU-identical results',{skip:fxSkip,timeout:180000},()=>{
  const river=E.MultiwayGame({...river3,traversal:'full',batchDeals:4}).nativeSpec();
  const r=runNative({...river,device:'gpu'},20,2,{env:withFixture()});assert.match(r.info.devicePath,/precomputed/);
  const es=runNative({...E.MultiwayGame(flop3).nativeSpec(),device:'hybrid'},20,1,{env:withFixture()});assert.match(es.info.devicePath,/CPU/);
  const turn=E.MultiwayGame({...river3,board:'Ks8d5h2c',traversal:'full',batchDeals:7,streets:{turn:{bets:'50',raises:'',maxBets:1},river:{bets:'75',raises:'2.5x',maxBets:2}}}).nativeSpec();
  const cpu=runNative(turn,24,3),gpu=runNative({...turn,device:'gpu'},24,3,{env:withFixture()});
  assert.equal(gpu.info.rng,cpu.info.rng);assert.equal(gpu.info.devicePath.includes('CPU (CUDA'),false,gpu.info.devicePath);
  const rowsOf=u8=>{const hl=new DataView(u8.buffer,u8.byteOffset).getUint32(8,true);return Buffer.from(u8.subarray(12+hl));};
  assert.ok(rowsOf(gpu.state).equals(rowsOf(cpu.state)),'GPU-scored training equals CPU-scored training');
  const old=runNative({...turn,device:'gpu'},4,1,{env:withFixture('oldgpu')});assert.match(old.info.devicePath,/compute capability 6\.1/);
});
test('native host: protocol 4 init/train/stop/state/import, CUDA probe in /api/info, /api/equity',{skip,timeout:300000},async()=>{
  const {spawn}=require('node:child_process'),{host}=require('./native_build');
  const h=host(),port=18000+Math.floor(Math.random()*20000),home=fs.mkdtempSync(path.join(tmp,'home'));
  const proc=spawn(h.exe,['--no-browser','--port='+port],{env:{...process.env,HOME:home,EIGHTMAX_GPU:'off',EIGHTMAX_THREADS:'4'},stdio:'ignore'});
  const base='http://127.0.0.1:'+port;
  const call=async(route,body,raw)=>{
    const init={method:body===undefined?'GET':'POST',headers:{'X-EightMax':'1'}};
    if(body!==undefined){init.body=raw?body:JSON.stringify(body);init.headers['Content-Type']=raw?'application/octet-stream':'application/json';}
    const r=await fetch(base+route,init);return {status:r.status,body:r.headers.get('content-type')?.includes('octet')?new Uint8Array(await r.arrayBuffer()):await r.json()};
  };
  const idle=async()=>{for(;;){const st=(await call('/api/mw/status')).body;if(!st.running)return st;await new Promise(r=>setTimeout(r,20));}};
  try{
    for(let i=0;i<150;i++){try{await call('/api/info');break;}catch(e){await new Promise(r=>setTimeout(r,100));}}
    const info=(await call('/api/info')).body;
    assert.deepEqual(info.multiwaySpecProtocols,[1,3,4]);assert.equal(typeof info.cuda.available,'boolean');assert.ok(info.cuda.reason);
    const cfg={...pf8,batchDeals:8,actionStreams:'deal'},js=E.MultiwayGame(cfg),nat=E.MultiwayGame(cfg);
    const init=await call('/api/mw/init',nat.nativeSpec());assert.equal(init.status,200,JSON.stringify(init.body));assert.equal(init.body.engine.algorithm,'external');
    assert.equal((await call('/api/mw/train',{iterations:20,threads:4})).status,200);
    const st=await idle();assert.equal(st.error,null);assert.equal(st.iterations,20);
    nat.importNative((await call('/api/mw/state')).body);js.iterate(20);sameRows(js.exportNative(),nat.exportNative());
    assert.equal((await call('/api/mw/train',{iterations:5000000,threads:4})).status,200);
    await new Promise(r=>setTimeout(r,300));await call('/api/mw/stop',{});
    const stopped=await idle();assert.ok(stopped.iterations>20&&stopped.iterations<5000020);
    const saved=(await call('/api/mw/state')).body,again=E.MultiwayGame(cfg);again.importNative(saved);
    const ref=E.MultiwayGame(cfg);ref.iterate(again.iterations);sameRows(ref.exportNative(),again.exportNative());
    assert.equal((await call('/api/mw/import',saved,true)).status,200);
    const eq=await call('/api/equity',{hands:[[48,49],[44,45]],board:[46,30,13],device:'cpu',threads:2});
    assert.equal(eq.status,200);assert.equal(eq.body.boards,990);
    assert.equal((await call('/api/equity',{hands:[[1,1]]})).status,400);
  }finally{proc.kill('SIGKILL');}
});

// 3.2: the EMMW4 payload includes every state edge in insertion order and every
// row's raw float64 values. Runtime timings and device diagnostics live outside it.
function sameCommitted(actual,reference){
  for(const key of ['iterations','trainingDeals','stateVisits','rng','actionRng','states','rows'])
    assert.equal(actual.info[key],reference.info[key],key);
  const body=result=>result.state.subarray(12+result.state.readUInt32LE(8));
  assert.ok(body(actual).equals(body(reference)),'committed state table or strategy values differ');
}
for(const batchDeals of [1,4,16])for(const actionStreams of ['shared','deal']){
  test('transactional six-seat recovery '+batchDeals+' deals '+actionStreams,{skip,timeout:120000},()=>{
    const cfg={...six,batchDeals,actionStreams,...(actionStreams==='shared'?{regretMatching:'plus',icm:{payouts:[50,30,20],others:[18,27]}}:{})};
    const spec=E.MultiwayGame(cfg).nativeSpec();
    const stop=runNative(spec,2000,2,{memoryMiB:2}), it=stop.info.iterations;
    assert.ok(stop.info.limitReached && it<2000);
    assert.equal(stop.info.trainingDeals,batchDeals*it);
    sameCommitted(stop,runNative(spec,it,1));
    sameCommitted(runNative(spec,5,4,{from:stop.state}),runNative(spec,it+5,1));
    if(batchDeals===4 && actionStreams==='deal'){
      assert.ok(stop.info.tablePeakBytes<=2*1048576);
      assert.ok(stop.info.scratchPeakBytes<=stop.info.scratchBudgetBytes);
      const g=E.MultiwayGame(cfg);g.importNative(stop.state);
      const loaded=E.restoreCheckpoint(JSON.parse(JSON.stringify(g.snapshot()))).game;
      sameCommitted(runNative(spec,5,2,{from:Buffer.from(loaded.exportNative(true))}),runNative(spec,it+5,1));
    }
  });
}
test('inconsistent legacy external checkpoint counters are rejected',{skip},()=>{
  const g=E.MultiwayGame({...six,batchDeals:4}),spec=g.nativeSpec();
  const {state}=runNative(spec,20,1);
  const bad=Buffer.from(state);
  const i=bad.indexOf('"trainingDeals":80');assert.ok(i>0);
  bad.write('"trainingDeals":84',i);
  assert.throws(()=>runNative(spec,1,1,{from:bad}),/committed deal count/i);
  assert.throws(()=>g.importNative(bad),/committed deal count/i);
});
for(const abstraction of ['compact','detailed']){
  test('native grouped river parity with blockers and weighted overlapping ranges '+abstraction,{skip},()=>{
    const cfg={...river3,abstraction,batchDeals:4,actionStreams:'deal',
      ranges:Array(3).fill('22+,A2s+,K9s+,QTs+,ATo+:0.6')};
    const js=E.MultiwayGame(cfg),spec=js.nativeSpec();
    assert.ok(spec.riverGroups.some(r=>new Set(r).size<r.length));
    js.iterate(120);
    const trained=runNative(spec,120,3);
    sameRows(js.exportNative(),trained.state);
    const mirror=E.MultiwayGame(cfg);mirror.importNative(trained.state);
    assert.deepEqual(mirror.view([]),js.view([]));
    js.iterate(10);
    sameRows(runNative(spec,10,1,{from:trained.state}).state,js.exportNative());
  });
}
test('stratified external frozen river batch matches JS and restores exactly',{skip},()=>{
  const cfg={...river3,batchDeals:4,externalRiverStrata:true};
  const game=E.MultiwayGame(cfg),spec=game.nativeSpec();
  assert.equal(spec.stratified,true);game.iterate(100);
  const full=runNative(spec,100,1);
  sameRows(game.exportNative(),full.state);
  sameCommitted(full,runNative(spec,30,4,{from:runNative(spec,70,2).state}));
  assert.throws(()=>E.MultiwayGame({...cfg,board:'Ks8d5h'}),/stratification/);
});
test('JS external memory stop restores all committed rows and RNGs',{timeout:60000},()=>{
  for(const batchDeals of [1,4]){
    const cfg={...six,batchDeals,strategyBudgetMiB:1};
    const low=E.MultiwayGame(cfg);low.iterate(500);
    assert.equal(low.limitReached,true);
    const ref=E.MultiwayGame({...cfg,strategyBudgetMiB:32});ref.iterate(low.iterations);
    assert.deepEqual(Buffer.from(low.exportNative()),Buffer.from(ref.exportNative()));
    low.increaseBudget(32);low.iterate(5);ref.iterate(5);
    assert.deepEqual(Buffer.from(low.exportNative()),Buffer.from(ref.exportNative()));
  }
});
for(const abstraction of ['compact','detailed']){
  test('grouped native turn-to-river parity '+abstraction,{skip},()=>{
    const cfg={...flop3,board:'Ks8d5h2c',abstraction,batchDeals:4,actionStreams:'deal',
      ranges:Array(3).fill('QQ+,AKs,AQs:0.7'),icm:{payouts:[50,30,20]}};
    const js=E.MultiwayGame(cfg),spec=js.nativeSpec();
    assert.ok(spec.turnGroups);js.iterate(120);
    const a=runNative(spec,120,4);sameRows(a.state,js.exportNative());
    const mirror=E.MultiwayGame(cfg);mirror.importNative(a.state);
    assert.deepEqual(mirror.view([]),js.view([]));
    js.iterate(10);sameRows(runNative(spec,10,1,{from:a.state}).state,js.exportNative());
  });
}
