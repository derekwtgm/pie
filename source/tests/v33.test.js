'use strict';
// EightMax 3.3 regression tests.
// Part 1: tournament input validation and chip accounting (negative/non-finite
// antes, malformed arrays, blinds larger than stacks, unconserved starting pots,
// strict CLI arguments, invalid checkpoint headers, heads-up configuration).
// Every test declares a time limit; a timeout is reported as a failure.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process');
const E=require('../tools/loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river','lib_river_ui','lib_checkpoint'])require('../web/'+l+'.js');
const {cli:nativeCli,fingerprint}=require('./native_build');
const built=nativeCli(),cli=built.cli,skip=cli?false:built.why;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'em33-'));
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
let seq=0;
// Runs mwcli and returns {status, signal, out, err}; never throws.
function mw(spec,iterations=3,threads=1,extra=[]){
  const f=path.join(tmp,'s'+(++seq)),specFile=f+'.json';
  fs.writeFileSync(specFile,typeof spec==='string'||Buffer.isBuffer(spec)?spec:JSON.stringify(spec));
  const r=spawnSync(cli,[specFile,String(iterations),String(threads),f+'.state',...extra],{encoding:'utf8'});
  return {status:r.status,signal:r.signal,out:r.stdout,err:r.stderr,state:f+'.state'};
}
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,a+' vs '+b);
const sum=a=>a.reduce((x,y)=>x+y,0);
const pf8={preflop:{mode:'linked',opens:'2',raises:'3x,a',maxBets:3},board:'',dealt:8,common:0,stacks:Array(8).fill(25),
  ranges:Array(8).fill('random'),privateMode:'sampled',evaluationDeals:128,bets:'50',raises:'',maxBets:1,traversal:'external',abstraction:'exact',
  batchDeals:2,actionStreams:'deal'};
const six={board:'Td7c2h',dealt:8,common:1.5,stacks:[20,35,8,50,14,26],prior:[2.5,2.5,2.5,2.5,2.5,2.5],folded:[1,2.5],
  ranges:Array(6).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6'),privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:128,
  streets:{flop:{bets:'33',raises:'',maxBets:1},turn:{bets:'50',raises:'',maxBets:1},river:{bets:'75',raises:'',maxBets:1}},batchDeals:4,actionStreams:'deal'};
const clone=x=>JSON.parse(JSON.stringify(x));

test('Default eight-handed structure: 0.5/1 blinds, 0.1 individual antes, 0.8 total, 2.3 initial pot',{timeout:30000},()=>{
  const g=E.MultiwayGame(pf8),spec=g.nativeSpec(),r=spec.rules;
  near(g.view([]).pot,2.3);
  assert.deepEqual(r.ownAnte,Array(8).fill(0.1));near(sum(r.ownAnte),0.8);
  assert.deepEqual(r.posted,[0,0,0,0,0,0,0.5,1]);assert.deepEqual(spec.anteOf,r.ownAnte);
  near(r.pot0,0.8);near(r.pot0+sum(r.posted),2.3);
  // Every dealt player's ante is deducted from the stack before the action.
  r.stacks.forEach(s=>near(s,24.9));
  assert.equal(E.tableAntes(8),0.8);near(E.anteModel({}).total(8),0.8);
  // Optional big blind ante stays available and is not the default.
  const bba=E.MultiwayGame({...pf8,anteType:'bba'}).nativeSpec().rules;
  assert.deepEqual(bba.ownAnte,[0,0,0,0,0,0,0,1]);near(bba.pot0,1);
});

test('Short stacks never contribute more chips than they possess',{timeout:30000},()=>{
  const r=E.MultiwayGame({...pf8,stacks:[25,25,25,0.05,25,25,0.3,0.6]}).nativeSpec().rules;
  near(r.ownAnte[3],0.05);near(r.stacks[3],0);near(r.posted[3],0);
  near(r.ownAnte[6],0.1);near(r.stacks[6],0.2);near(r.posted[6],0.2);           // SB can only post 0.2 after the ante
  near(r.ownAnte[7],0.1);near(r.stacks[7],0.5);near(r.posted[7],0.5);           // BB all-in for 0.5
  for(let p=0;p<8;p++){assert.ok(r.ownAnte[p]+r.posted[p]<=[25,25,25,0.05,25,25,0.3,0.6][p]+1e-12);}
  near(r.pot0,0.75);
  if(!skip){const x=mw(E.MultiwayGame({...pf8,stacks:[25,25,25,0.05,25,25,0.3,0.6]}).nativeSpec(),4,2);assert.equal(x.status,0,x.err);}
});

test('JavaScript rejects negative, non-finite and out-of-range antes and malformed arrays; zero antes are valid',{timeout:30000},()=>{
  for(const ante of [-0.1,-1e-9,NaN,Infinity,-Infinity,'abc',10.5])
    assert.throws(()=>E.MultiwayGame({...pf8,ante}),/ante/i,'ante '+ante);
  const zero=E.MultiwayGame({...pf8,ante:0}).nativeSpec();assert.deepEqual(zero.rules.ownAnte,Array(8).fill(0));near(E.MultiwayGame({...pf8,ante:0}).view([]).pot,1.5);
  near(E.MultiwayGame({...pf8,anteType:'none'}).view([]).pot,1.5);
  for(const stacks of [[25,25],Array(8).fill(-1),[...Array(7).fill(25),NaN],[...Array(7).fill(25),Infinity],'25'])
    assert.throws(()=>E.MultiwayGame({...pf8,stacks}),undefined,'stacks '+JSON.stringify(stacks));
  assert.throws(()=>E.MultiwayGame({...six,prior:[2.5,2.5,2.5,2.5,2.5]}),/nonnegative numbers|contributions/);
  assert.throws(()=>E.MultiwayGame({...six,prior:[2.5,2.5,2.5,2.5,2.5,-2.5]}),/nonnegative/);
  assert.throws(()=>E.MultiwayGame({...six,folded:[-1]}),/nonnegative/);
  assert.throws(()=>E.MultiwayGame({...six,common:-0.5}),/common pot/);
  assert.throws(()=>E.MultiwayGame({...six,common:NaN}),/common pot/);
  assert.throws(()=>E.MultiwayGame({...six,dealt:5}),/dealt/);
  assert.throws(()=>E.MultiwayGame({...six,dealt:9}),/2 to 8/);
  assert.throws(()=>E.MultiwayGame({...six,board:'Td7cTd'}),/different board cards|Duplicate card/);
  assert.throws(()=>E.MultiwayGame({...six,ranges:six.ranges.slice(1)}),/range for every seat/);
  assert.throws(()=>E.wideGame({cfg:{},board:[],hands:[],tree:{},n:2,ownAnte:[0.1,-0.1]}),/ante/);
  assert.throws(()=>E.wideGame({cfg:{},board:[],hands:[],tree:{},n:2,ownAnte:[0.1]}),/ante/);
});

test('Native engine rejects negative, non-finite and malformed antes (3.2 accepted anteOf -0.1)',{skip,timeout:60000},()=>{
  const base=E.MultiwayGame(six).nativeSpec();
  assert.equal(mw(base).status,0,'valid fixture trains');
  const cases=[
    s=>{s.anteOf[2]=-0.1;},s=>{s.anteOf[2]=-1e-12;},s=>{s.anteOf[0]='0.1';},s=>{s.anteOf[1]=null;},s=>{s.anteOf=s.anteOf.slice(1);},
    s=>{s.anteOf=0;},s=>{s.anteOf[3]=11;},s=>{s.anteOf[3]=0.1;},                                  // postflop roots carry no live ante
    s=>{s.rules.ownAnte[2]=-0.1;},s=>{s.rules.ownAnte[2]=12;},s=>{s.rules.stacks[0]=-1;},s=>{s.rules.stacks=s.rules.stacks.slice(1);},
    s=>{s.rules.prior[0]=-2.5;},s=>{s.rules.folded=[-1];},s=>{s.rules.common=-0.1;},s=>{s.rules.pot0+=0.1;},   // pot not conserved
    s=>{s.rules.posted[0]=1;},s=>{s.rules.open[0]=1;},s=>{s.rules.folded=[9];},
    s=>{s.state.iterations=1.5;},s=>{s.state.rng=-1;},s=>{s.state.rng=4294967296;},s=>{s.state.stateVisits=-3;},
    s=>{s.batchDeals=2.5;},s=>{s.batchDeals=0;},s=>{s.protocol=4.5;},s=>{s.n=6.5;},
    s=>{s.hands[0][0][3]=-1;},s=>{s.hands[0][0][3]=0;},s=>{s.hands[0].push(s.hands[0][0].slice());},
    s=>{s.board[0]=1.5;},s=>{s.board[1]=s.board[0];},s=>{s.gpuMiB=0;},s=>{s.device='quantum';}];
  cases.forEach((mutate,i)=>{
    const s=clone(base);mutate(s);const r=mw(s);
    assert.equal(r.signal,null,'case '+i+' crashed');assert.equal(r.status,1,'case '+i+' accepted: '+r.out);assert.match(r.err,/^error: /,'case '+i);
  });
  // Huge literals overflow to infinity in the parser and are refused there.
  const text=JSON.stringify(base).replace('"anteOf":[0,','"anteOf":[1e999,');
  assert.equal(mw(text).status,1);
});

test('Native preflop specs: valid zero, nonuniform and short-stack antes train; mismatched ante lists are refused',{skip,timeout:60000},()=>{
  for(const cfg of [pf8,{...pf8,ante:0},{...pf8,anteType:'bba'},{...pf8,stacks:[25,25,25,0.05,25,25,0.3,0.6]}]){
    const r=mw(E.MultiwayGame(cfg).nativeSpec(),3,2);assert.equal(r.status,0,r.err);
  }
  const spec=E.MultiwayGame(pf8).nativeSpec();
  // Nonuniform antes are accepted when the rules, ante list and starting pot agree.
  const non=clone(spec);non.rules.ownAnte[0]=0.2;non.anteOf[0]=0.2;non.rules.stacks[0]=24.8;non.rules.pot0=0.9;
  assert.equal(mw(non).status,0,'nonuniform antes');
  const bad=clone(spec);bad.anteOf[0]=0.2;assert.equal(mw(bad).status,1,'ante list must match the rules');
  const pot=clone(spec);pot.rules.pot0=2.3;const r=mw(pot);assert.equal(r.status,1);assert.match(r.err,/conserved/);
  const blind=clone(spec);blind.rules.posted[7]=30;assert.match(mw(blind).err,/more chips than its stack/);
});

test('Native and JavaScript validation agree on ante configurations',{skip,timeout:60000},()=>{
  // JavaScript builds the spec; a value JavaScript refuses must also be refused natively when injected.
  const base=E.MultiwayGame(pf8).nativeSpec();
  for(const ante of [0,0.05,0.1,0.25,10,-0.1,-5,10.5]){
    let js=true;try{E.MultiwayGame({...pf8,ante});}catch{js=false;}
    const s=clone(base);s.rules.ownAnte=Array(8).fill(ante);s.anteOf=s.rules.ownAnte.slice();
    s.rules.stacks=Array(8).fill(25-ante);s.rules.pot0=8*ante;
    const native=mw(s).status===0;
    assert.equal(native,js,'ante '+ante+': js '+js+' native '+native);
  }
});

test('Invalid configuration files and arguments never crash the native CLI',{skip,timeout:60000},()=>{
  const valid=JSON.stringify(E.MultiwayGame(six).nativeSpec());
  for(const text of ['','{','[]','null','{"protocol":4}','\u0000\u0001ÿ',valid.slice(0,valid.length/2),valid.replace(/"rules":\{/,'"rules":{"x":'+'['.repeat(5000)),
                     JSON.stringify({...JSON.parse(valid),hands:[]}),JSON.stringify({...JSON.parse(valid),rules:null})]){
    const r=mw(text);assert.equal(r.signal,null);assert.notEqual(r.status,0,text.slice(0,40));
  }
  const spec=E.MultiwayGame(six).nativeSpec();
  for(const [it,th,more] of [['abc',1,[]],['-3',1,[]],['3.5',1,[]],['3',0,[]],['3','-2',[]],['3','x',[]],['3',1,['nan']],['3',1,['-5']],['3',1,['1e9']],['20000000',1,[]]]){
    const r=mw(spec,it,th,more);assert.equal(r.signal,null);assert.equal(r.status,2,'args '+[it,th,...more].join(' '));assert.match(r.err,/must be/);
  }
});

test('Checkpoint imports reject invalid tournament state',{timeout:60000},async()=>{
  const g=E.MultiwayGame({...six,traversal:'external'});g.iterate(4);
  const payload=JSON.parse(JSON.stringify(g.snapshot([])));
  // The unmodified checkpoint restores and continues.
  const ok=E.restoreCheckpoint(await E.decodeCheckpoint(await E.encodeCheckpoint(payload)));assert.equal(ok.game.metrics().iterations??4,4);
  for(const mutate of [c=>{c.ante=-0.1;},c=>{c.common=-1;},c=>{c.stacks[0]=-5;},c=>{c.prior=[1,2];},c=>{c.dealt=4;},c=>{c.ante='NaN';}]){
    const bad=JSON.parse(JSON.stringify(payload));mutate(bad.cfg);
    const text=await E.encodeCheckpoint(bad);
    await assert.rejects(async()=>E.restoreCheckpoint(await E.decodeCheckpoint(text)),undefined);
  }
  // Native EMMW4 headers with fractional counters are refused.
  if(!skip){
    const spec=E.MultiwayGame(six).nativeSpec(),r=mw(spec,3,1);assert.equal(r.status,0);
    const st=fs.readFileSync(r.state),hl=st.readUInt32LE(8),head=st.subarray(12,12+hl).toString();
    const forged=head.replace(/"iterations":3/,'"iterations":3.0').replace(/"stateVisits":(\d+)/,(m,v)=>'"stateVisits":'+v+'.5');
    assert.notEqual(forged,head);
    const rebuild=h=>{const len=Buffer.alloc(4);len.writeUInt32LE(Buffer.byteLength(h));return Buffer.concat([st.subarray(0,8),len,Buffer.from(h),st.subarray(12+hl)]);};
    const resume=bytes=>{const f=path.join(tmp,'forged'+(++seq)+'.state');fs.writeFileSync(f,bytes);return mw(spec,1,1,['1024',f]);};
    assert.equal(resume(rebuild(head)).status,0,'an unmodified rebuilt header resumes');
    const x=resume(rebuild(forged));assert.equal(x.status,1);assert.match(x.err,/counter/);
  }
});

test('Chip conservation: every terminal pot layer sums to the chips committed plus the starting pot',{timeout:60000},()=>{
  // Walk random action paths in several tournament configurations and check the pots.
  const configs=[pf8,{...pf8,stacks:[25,25,25,0.05,25,25,0.3,0.6]},{...pf8,anteType:'bba'},six,{...six,stacks:[3,35,8,50,1,26]}];
  let terminals=0;
  for(const cfg of configs){
    const g=E.MultiwayGame(cfg),rules=E.MultiwayGame(cfg).nativeSpec().rules;
    let rng=7;const rand=()=>((rng=Math.imul(rng,1103515245)+12345>>>0)/4294967296);
    for(let trial=0;trial<60;trial++){
      let p=[],v=g.view(p);
      for(let guard=0;guard<60 && v.kind==='player';guard++){p=[...p,Math.floor(rand()*v.actions.length)];v=g.view(p);}
      if(v.kind!=='terminal')continue;
      terminals++;
      const stacksStart=rules.pre?rules.stacks.map((s,i)=>s+rules.ownAnte[i]):rules.stacks.map((s,i)=>s);
      // pot layers + chips behind of the live seats equal the starting stacks + every chip already in the middle.
      const potTotal=sum(v.pots.map(x=>x.amount));
      const behind=sum(Array.from(v.behind));
      near(potTotal+behind,sum(stacksStart)+rules.common+sum(rules.prior)+sum(rules.folded),1e-7);
      v.pots.forEach(x=>assert.ok(x.amount>=0&&Number.isFinite(x.amount)));
    }
  }
  assert.ok(terminals>100,'terminals '+terminals);
});

test('Heads-up native configuration rejects negative weights, fractional cards and non-finite pots',{skip,timeout:120000},()=>{
  const native=path.join(__dirname,'../native'),exe=path.join(tmp,'cfgcheck');
  const src=path.join(tmp,'cfgcheck.c');
  fs.writeFileSync(src,'#include <stdio.h>\n#include <stdlib.h>\n#include "solver.h"\nint main(int c,char**v){FILE*f=fopen(v[1],"rb");static char b[1<<20];size_t n=fread(b,1,sizeof b-1,f);b[n]=0;fclose(f);'+
    'static GameCfg g;char e[256]="";int ok=solver_parse_cfg(b,&g,e,sizeof e);printf("%d %s\\n",ok,e);return ok?0:1;}\n');
  execFileSync('gcc',['-O1','-I'+native,src,path.join(native,'cfg.c'),path.join(native,'json.c'),'-lm','-o',exe]);
  const w=Array(1326).fill(1);
  const base={board:[0,5,10],pot:10,stack:50,ranges:[w,w],sizes:{bet:[['50','50'],['50','50'],['50','50']],raise:[['a','a'],['a','a'],['a','a']]}};
  const run=c=>{const f=path.join(tmp,'hu'+(++seq)+'.json');fs.writeFileSync(f,typeof c==='string'?c:JSON.stringify(c));return spawnSync(exe,[f],{encoding:'utf8'});};
  assert.equal(run(base).status,0,run(base).stdout);
  const bad=[{board:[0,5,10.5]},{board:[0,5,52]},{pot:-1},{pot:0},{stack:-1},{pot:'10'},{maxBets:-1},{maxBets:2.5},
    {ranges:[w.map((x,i)=>i===7?-1:x),w]},{ranges:[w.map((x,i)=>i===7?'1':x),w]},{ranges:[w.slice(1),w]}];
  for(const b of bad){const r=run({...base,...b});assert.equal(r.status,1,JSON.stringify(b).slice(0,60)+' '+r.stdout);}
  assert.equal(run(JSON.stringify(base).replace('"pot":10','"pot":1e999')).status,1);
  assert.equal(run({...base,ranges:[w.map((x,i)=>i<3?0:x),w]}).status,0,'zero weights remain valid');
});

test('Heads-up JavaScript configuration applies the same checks as the native host',{timeout:30000},()=>{
  require('../web/lib_postflop.js');
  const w=Array(1326).fill(1),base={board:[0,5,10],pot:10,stack:50,ranges:[w,w],sizes:{bet:[[[50],[50]],[[75],[75]],[[75],[75]]],raise:[[[],[]],[[],[]],[[],[]]]}};
  assert.ok(E.PostflopGame(base),'the valid configuration builds');
  assert.ok(E.PostflopGame({...base,ranges:[w.map((x,i)=>i<9?0:x),w]}),'zero weights are valid');
  for(const bad of [{pot:Infinity},{pot:-1},{stack:NaN},{stack:Infinity},{board:[0,5,10.5]},{board:[0,5,5]},{board:[0,5,60]},
                    {ranges:[w.map((x,i)=>i===3?-1:x),w]},{ranges:[w.map((x,i)=>i===3?NaN:x),w]},{ranges:[w.slice(1),w]},{ranges:[w]}])
    assert.throws(()=>E.PostflopGame({...base,...bad}),/Pot|Stack|board|Range|ranges/,JSON.stringify(Object.keys(bad)));
});

// ---------------- Part 2: external-sampling DCFR ----------------
// EMMW4 rows keyed by action path, hand index and public cards. DCFR states
// (header rowSync) end every row with its u32 discount iteration.
function rowsOf(u8){
  u8=Buffer.from(u8);const hl=u8.readUInt32LE(8),head=JSON.parse(u8.subarray(12,12+hl).toString());let p=12+hl;const sc=u8.readUInt32LE(p);p+=4;
  const paths=[];for(let i=0;i<sc;i++){const par=u8.readUInt32LE(p),slot=u8[p+4];paths.push(i?paths[par]+(slot===7?'c':slot):'r');p+=9;}
  const c=u8.readUInt32LE(p);p+=4;const m=new Map(),extra=head.rowSync?4:0;
  for(let i=0;i<c;i++){const st=u8.readUInt32LE(p),k=u8[p+11],vals=[];for(let a=0;a<2*k;a++)vals.push(u8.readDoubleLE(p+12+8*a));
    const sync=extra?u8.readUInt32LE(p+12+16*k):null;
    m.set(paths[st]+'|'+u8.readUInt16LE(p+4)+'|'+u8.subarray(p+6,p+11).toString('hex'),{vals,sync});p+=12+16*k+extra;}
  return {head,rows:m};
}
function compareRows(a,b,tol=0){
  const x=rowsOf(a),y=rowsOf(b);assert.ok(x.rows.size>0,'no rows');assert.equal(x.rows.size,y.rows.size,'row count');
  let worst=0;
  for(const [key,r] of x.rows){const s=y.rows.get(key);assert.ok(s,'missing row '+key);assert.equal(r.sync,s.sync,'sync '+key);
    r.vals.forEach((v,i)=>{const d=Math.abs(v-s.vals[i])/Math.max(1,Math.abs(v));worst=Math.max(worst,d);if(!tol)assert.equal(Object.is(v,s.vals[i])||v===s.vals[i],true,'value '+key+' '+i+': '+v+' vs '+s.vals[i]);});}
  assert.ok(worst<=tol,'relative difference '+worst);
  return {x,y};
}
function nativeTrain(spec,iterations,threads,{memoryMiB=1024,from=null}={}){
  const f=path.join(tmp,'d'+(++seq)),specFile=f+'.json',out=f+'.state';
  fs.writeFileSync(specFile,JSON.stringify(spec));const args=[specFile,String(iterations),String(threads),out,String(memoryMiB)];
  if(from){fs.writeFileSync(f+'.in',from);args.push(f+'.in');}
  const info=JSON.parse(execFileSync(cli,args,{stdio:['ignore','pipe','pipe']}).toString());
  return {info,state:fs.readFileSync(out)};
}
const river3={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc:0.5,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
  streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:128,privateSeed:9};
const flop3={...river3,board:'Ks8d5h',stacks:[12,20,30],streets:{flop:{bets:'33,a',raises:'3x',maxBets:2},turn:{bets:'75,g',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}}};
const dcfrCases=[
  ['3-seat river, one deal per update',river3,{},300,1],
  ['3-seat river, CFR+ clipping',river3,{regretMatching:'plus'},200,1],
  ['3-seat flop, frozen batches of 8, shared stream',flop3,{batchDeals:8},60,1],
  ['6-seat flop, per-deal streams, 4 deals, 2 threads',six,{},40,2],
  ['8-seat linked preflop, per-deal streams',pf8,{},12,2],
  ['3-seat river, alpha 2, beta 0.5, gamma 3',river3,{dcfrAlpha:2,dcfrBeta:0.5,dcfrGamma:3},200,1]];
for(const [name,base,over,its,threads] of dcfrCases){
  test('native external-sampling DCFR matches the JavaScript reference bit for bit: '+name,{skip,timeout:180000},()=>{
    const cfg={...base,weighting:'dcfr',...over},js=E.MultiwayGame(cfg),nat=E.MultiwayGame(cfg);
    const spec=nat.nativeSpec();assert.equal(spec.weighting,'dcfr');assert.equal(spec.dcfrAlpha,cfg.dcfrAlpha??1.5);
    const {info,state}=nativeTrain(spec,its,threads);
    assert.equal(info.weighting,'dcfr');assert.equal(info.dcfr.lazyRowDiscount,true);
    js.iterate(its);
    const {x}=compareRows(js.exportNative(),state);
    assert.equal(x.head.rowSync,1);
    // Sparse rows: some rows were last discounted long before the final iteration.
    const syncs=[...x.rows.values()].map(r=>r.sync);assert.ok(syncs.some(s=>s<its-1),'no sparse rows');assert.ok(syncs.every(s=>s<=its));
    nat.importNative(state);compareRows(js.exportNative(),nat.exportNative());
    assert.deepEqual(nat.view([]),js.view([]));
  });
}
test('DCFR with non-integer exponents (std::pow) agrees with JavaScript to 1e-12',{skip,timeout:120000},()=>{
  const cfg={...river3,weighting:'dcfr',dcfrAlpha:1.25,dcfrBeta:-0.75,dcfrGamma:1.7},js=E.MultiwayGame(cfg);
  const {state}=nativeTrain(E.MultiwayGame(cfg).nativeSpec(),150,1);js.iterate(150);compareRows(js.exportNative(),state,1e-12);
});
test('Lazy per-row DCFR equals textbook eager DCFR (independent reference) on sparse rows',{skip,timeout:180000},()=>{
  // Eager: every row is discounted after every iteration with directly computed factors and the
  // averages by (t/(t+1))^gamma. Lazy rows are brought to the final iteration here with a direct
  // product loop, independent of the prefix tables.
  for(const [cfg,its,threads] of [[{...river3,weighting:'dcfr'},250,1],[{...six,weighting:'dcfr'},40,2],[{...flop3,weighting:'dcfr',batchDeals:8,dcfrAlpha:2,dcfrBeta:0.5,dcfrGamma:3},60,1]]){
    const spec=E.MultiwayGame(cfg).nativeSpec(),lazy=nativeTrain(spec,its,threads),eager=nativeTrain({...spec,dcfrEager:true},its,threads);
    const L=rowsOf(lazy.state),R=rowsOf(eager.state),a=spec.dcfrAlpha,b=spec.dcfrBeta;
    assert.equal(L.rows.size,R.rows.size);
    let worstRegret=0,worstPolicy=0,stale=0;
    for(const [key,row] of L.rows){
      const ref=R.rows.get(key);assert.ok(ref,key);assert.equal(ref.sync,its);
      const k=row.vals.length/2;let pos=1,neg=1;
      for(let u=row.sync+1;u<=its;u++){pos*=u**a/(u**a+1);neg*=u**b/(u**b+1);}
      if(row.sync<its)stale++;
      for(let i=0;i<k;i++){const v=row.vals[i],x=v>0?v*pos:v<0?v*neg:v;
        worstRegret=Math.max(worstRegret,Math.abs(x-ref.vals[i])/Math.max(1e-6,Math.abs(ref.vals[i])+Math.abs(x)));}
      const s1=row.vals.slice(k).reduce((p,q)=>p+q,0),s2=ref.vals.slice(k).reduce((p,q)=>p+q,0);
      if(s1>0&&s2>0)for(let i=0;i<k;i++)worstPolicy=Math.max(worstPolicy,Math.abs(row.vals[k+i]/s1-ref.vals[k+i]/s2));
    }
    assert.ok(stale>0,'expected sparsely visited rows');
    assert.ok(worstRegret<1e-9,'regret mismatch '+worstRegret);
    assert.ok(worstPolicy<1e-9,'average strategy mismatch '+worstPolicy);
  }
});
test('DCFR checkpoints continue bit for bit across native, JavaScript and native again',{skip,timeout:180000},()=>{
  for(const cfg of [{...river3,weighting:'dcfr'},{...six,weighting:'dcfr'}]){
    const spec=E.MultiwayGame(cfg).nativeSpec(),full=nativeTrain(spec,30,2);
    const part=nativeTrain(spec,12,2),resumed=nativeTrain(spec,18,2,{from:part.state});
    assert.ok(Buffer.compare(full.state,resumed.state)===0,'native resume differs');
    // JavaScript trains the first 12 iterations, the native engine the rest.
    const js=E.MultiwayGame(cfg);js.iterate(12);
    const handoff=nativeTrain(spec,18,1,{from:js.exportNative()});compareRows(handoff.state,full.state);
    // Native state back into JavaScript, which continues identically.
    const back=E.MultiwayGame(cfg);back.importNative(part.state);back.iterate(18);compareRows(back.exportNative(),full.state);
    // The JavaScript .emstudy snapshot keeps every row's discount iteration.
    const js2=E.MultiwayGame(cfg);js2.iterate(12);const snap=JSON.parse(JSON.stringify(js2.snapshot([])));
    assert.ok(snap.state.pools.every(p=>Array.isArray(p.syncs)));
    const restored=E.restoreCheckpoint(snap).game;restored.iterate(18);compareRows(restored.exportNative(),full.state);
    // A tampered discount iteration is refused.
    const tampered=JSON.parse(JSON.stringify(snap));tampered.state.pools[0].syncs[0][0]=999;
    assert.throws(()=>E.restoreCheckpoint(tampered));
  }
});
test('DCFR state files are refused by studies with other weightings and vice versa',{skip,timeout:60000},()=>{
  const d=nativeTrain(E.MultiwayGame({...river3,weighting:'dcfr'}).nativeSpec(),5,1).state;
  const linearSpec=E.MultiwayGame(river3).nativeSpec();
  const f=path.join(tmp,'x.state');fs.writeFileSync(f,d);
  const r=mw(linearSpec,1,1,['1024',f]);assert.equal(r.status,1);assert.match(r.err,/different study|weighting/);
  assert.throws(()=>E.MultiwayGame(river3).importNative(d));
  assert.throws(()=>E.MultiwayGame({...river3,weighting:'dcfr',traversal:'full'}),/external-sampling/);
  assert.throws(()=>E.MultiwayGame({...river3,weighting:'dcfr',dcfrAlpha:-1}),/nonnegative/);
  assert.throws(()=>E.MultiwayGame({...river3,weighting:'dcfr',dcfrGamma:NaN}),/finite/);
  const spec=E.MultiwayGame({...river3,weighting:'dcfr'}).nativeSpec();
  assert.equal(mw({...spec,dcfrAlpha:-1}).status,1);assert.equal(mw({...spec,dcfrEager:1}).status,1);
});
test('DCFR memory stops leave the committed state unchanged and resume to the uninterrupted result',{skip,timeout:240000},()=>{
  const spec=E.MultiwayGame({...six,weighting:'dcfr'}).nativeSpec();
  for(const mib of [0.75,1.5]){
    const stopped=nativeTrain(spec,400,2,{memoryMiB:mib});
    assert.equal(stopped.info.limitReached,true,'expected a memory stop at '+mib+' MiB');
    const U=stopped.info.iterations;assert.ok(U>0&&U<400);
    const reference=nativeTrain(spec,U,2,{memoryMiB:1024});
    assert.ok(Buffer.compare(reference.state,stopped.state)===0,'stopped state differs from the uninterrupted state at '+U);
    const resumed=nativeTrain(spec,400-U,2,{memoryMiB:1024,from:stopped.state}),full=nativeTrain(spec,400,2,{memoryMiB:1024});
    assert.ok(Buffer.compare(resumed.state,full.state)===0,'resume differs');
  }
});
test('Allocation fault injection: every failed DCFR and linear update rolls back exactly and resumes',{skip:skip||process.platform!=='linux',timeout:600000},()=>{
  const native=path.join(__dirname,'../native'),exe=path.join(tmp,'es_faults');
  execFileSync('gcc',['-O1','-c',path.join(native,'json.c'),'-o',exe+'.json.o']);
  execFileSync('g++',['-std=c++20','-O1','-ffp-contract=off','-I'+native,path.join(__dirname,'es_faults.cpp'),path.join(native,'mw.cpp'),exe+'.json.o','-lpthread','-ldl','-o',exe]);
  const specs=[JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/es-six-weighted.json'))),
    E.MultiwayGame({...six,weighting:'dcfr'}).nativeSpec(),E.MultiwayGame({...river3,weighting:'dcfr'}).nativeSpec(),
    E.MultiwayGame({...pf8,weighting:'dcfr',batchDeals:1,actionStreams:'shared'}).nativeSpec()];
  for(const spec of specs){
    const f=path.join(tmp,'fault'+(++seq)+'.json');fs.writeFileSync(f,JSON.stringify(spec));
    const out=execFileSync(exe,[f],{encoding:'utf8'});
    const count=+/(\d+) allocation failures rolled back exactly/.exec(out)[1];assert.ok(count>0,out);
  }
});
test('DCFR with alpha = beta = gamma = 1 reproduces linear MCCFR (independent identity)',{skip,timeout:120000},()=>{
  // prod_{u=t..T-1} u/(u+1) = t/T, so DCFR(1,1,1) regrets and averages are linear CFR's
  // divided by T: identical regret-matching policies and normalized average strategies.
  for(const cfg of [river3,{...six,batchDeals:4}]){
    const lin=nativeTrain(E.MultiwayGame(cfg).nativeSpec(),200,1),d=nativeTrain(E.MultiwayGame({...cfg,weighting:'dcfr',dcfrAlpha:1,dcfrBeta:1,dcfrGamma:1}).nativeSpec(),200,1);
    const L=rowsOf(lin.state),D=rowsOf(d.state);assert.equal(L.rows.size,D.rows.size);let worst=0;
    const norm=v=>{const s=v.reduce((a,b)=>a+Math.max(0,b),0);return v.map(x=>s?Math.max(0,x)/s:1/v.length);};
    for(const [key,row] of L.rows){const o=D.rows.get(key),k=row.vals.length/2;assert.ok(o,key);
      const a=norm(row.vals.slice(k)),b=norm(o.vals.slice(k));a.forEach((x,i)=>worst=Math.max(worst,Math.abs(x-b[i])));
      // Regrets: DCFR rows still to be brought to iteration 200 by prod_{u=sync+1..200} u/(u+1) = (sync+1)/201.
      const f=(o.sync+1)/201;for(let i=0;i<k;i++)worst=Math.max(worst,Math.abs(row.vals[i]/201-o.vals[i]*f)/Math.max(1,Math.abs(row.vals[i]/201)));}
    assert.ok(worst<1e-9,'difference '+worst);
  }
});

// ---------------- Part 3: native Compact and Detailed hand groups ----------------
function keyRows(u8){
  u8=Buffer.from(u8);const hl=u8.readUInt32LE(8),head=JSON.parse(u8.subarray(12,12+hl).toString());let p=12+hl;const sc=u8.readUInt32LE(p);p+=4;
  const paths=[];for(let i=0;i<sc;i++){const par=u8.readUInt32LE(p),slot=u8[p+4];paths.push(i?paths[par]+(slot===7?'c':slot):'r');p+=9;}
  const c=u8.readUInt32LE(p);p+=4;const m=new Map(),extra=head.rowSync?4:0;
  for(let i=0;i<c;i++){const st=u8.readUInt32LE(p);let id,k,at;
    if(head.rowKeys){const l=u8.readUInt16LE(p+4);id=u8.subarray(p+6,p+6+l).toString();k=u8[p+6+l];at=p+7+l;}
    else{id=u8.readUInt16LE(p+4)+'|'+u8.subarray(p+6,p+11).toString('hex');k=u8[p+11];at=p+12;}
    assert.ok(!m.has(paths[st]+'|'+id),'duplicate row');m.set(paths[st]+'|'+id,u8.subarray(at,at+16*k+extra).toString('hex'));p=at+16*k+extra;}
  assert.equal(p,u8.length);return {head,rows:m};
}
function sameKeyRows(a,b){const x=keyRows(a),y=keyRows(b);assert.ok(x.rows.size>0);assert.equal(x.rows.size,y.rows.size,'rows');for(const [k,v] of x.rows)assert.equal(y.rows.get(k),v,'row '+k);return x;}
const flop3g={...flop3,ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d,22+,A2s+','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc:0.5,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd']};
const turnBig={...flop3g,board:'Ks8d5h2c',ranges:Array(3).fill('22+,A2s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+'),streets:{turn:{bets:'60',raises:'',maxBets:1},river:{bets:'75,a',raises:'',maxBets:1}}};
const groupCases=[
  ['Compact 3-seat flop',flop3g,{abstraction:'compact'},150,1],
  ['Detailed 3-seat flop',flop3g,{abstraction:'detailed'},150,1],
  ['Detailed 6-seat flop, weighted ranges, all-ins, per-deal streams, 2 threads',six,{abstraction:'detailed'},30,2],
  ['Compact 8-seat linked preflop (169 classes) to river',pf8,{abstraction:'compact'},8,2],
  ['Detailed 8-seat shove/call with ICM',{preflop:{mode:'shove'},dealt:8,common:0,board:'',privateMode:'sampled',stacks:[10,6,14,3,9,12,7.5,11],ranges:Array(8).fill('random'),evaluationDeals:128,icm:{payouts:[50,30,20]},traversal:'external'},{abstraction:'detailed'},40,1],
  ['Compact 3-seat turn above the 3.2 representative limit',turnBig,{abstraction:'compact'},120,1],
  ['Detailed 3-seat flop with DCFR',flop3g,{abstraction:'detailed',weighting:'dcfr'},150,1]];
for(const [name,base,over,its,threads] of groupCases){
  test('native grouped hands match JavaScript bit for bit: '+name,{skip,timeout:300000},()=>{
    const cfg={...base,...over},js=E.MultiwayGame(cfg),nat=E.MultiwayGame(cfg);
    assert.equal(js.nativeSupport(),null);
    const spec=nat.nativeSpec();assert.ok(spec.groupKeys,'grouped-key spec');assert.equal(spec.abstraction,cfg.abstraction);
    if(name.includes('turn above'))assert.ok(53*spec.hands.reduce((a,r)=>a+r.length,0)>32768,'turn exceeds the 3.2 table');
    const {info,state}=nativeTrain(spec,its,threads);
    assert.equal(info.handGroups.native,true);assert.equal(info.handGroups.abstraction,cfg.abstraction);
    js.iterate(its);
    const x=sameKeyRows(js.exportNative(),state);assert.equal(x.head.rowKeys,1);
    assert.equal(info.trainingDeals,js.trainingDeals);assert.equal(info.stateVisits,js.metrics().stateVisits);
    // Grouped rows really share information sets across physical hands.
    assert.ok(info.handGroups.keys<spec.hands.reduce((a,r)=>a+r.length,0)*(spec.board.length===5?1:8),'keys '+info.handGroups.keys);
    nat.importNative(state);sameKeyRows(js.exportNative(),nat.exportNative());
    // Same strategy, same terminal utilities and evaluation in the imported study.
    const strip=m=>{const {infos,strategyMiB,memoryBudgetMiB,trainingEngine,...rest}=m;return rest;};
    assert.deepEqual(strip(nat.metrics()),strip(js.metrics()));
    assert.deepEqual(nat.view([]),js.view([]));
  });
}
test('grouped native checkpoints resume bit for bit, and memory stops on the key dictionary roll back',{skip,timeout:300000},()=>{
  const cfg={...six,abstraction:'detailed'},spec=E.MultiwayGame(cfg).nativeSpec();
  const full=nativeTrain(spec,40,2),part=nativeTrain(spec,15,2),resumed=nativeTrain(spec,25,2,{from:part.state});
  sameKeyRows(full.state,resumed.state);
  const js=E.MultiwayGame(cfg);js.iterate(15);sameKeyRows(nativeTrain(spec,25,1,{from:js.exportNative()}).state,full.state);
  const stopped=nativeTrain(spec,400,2,{memoryMiB:0.75});assert.equal(stopped.info.limitReached,true);
  const U=stopped.info.iterations;assert.ok(U>0&&U<400,'stopped at '+U);
  sameKeyRows(nativeTrain(spec,U,2).state,stopped.state);
  sameKeyRows(nativeTrain(spec,400-U,2,{from:stopped.state}).state,nativeTrain(spec,400,2).state);
  // Grouped files are refused by exact-card studies and corrupt keys are refused.
  const exact=E.MultiwayGame(six).nativeSpec(),f=path.join(tmp,'g.state');fs.writeFileSync(f,part.state);
  assert.equal(mw(exact,1,1,['1024',f]).status,1);
  assert.throws(()=>E.MultiwayGame(six).importNative(part.state));
});
test('grouped specs are validated (abstraction, range-size flags, combo identifiers)',{skip,timeout:60000},()=>{
  const spec=E.MultiwayGame({...flop3g,abstraction:'compact'}).nativeSpec();
  for(const mutate of [s=>{s.groupKeys.abstraction='exact';},s=>{s.groupKeys.small=[true];},s=>{s.groupKeys.small[0]=1;},s=>{s.groupKeys=[];},
                       s=>{s.hands[0][0][0]=(s.hands[0][0][0]+1)%1326;}]){
    const s=clone(spec);mutate(s);assert.equal(mw(s).status,1);
  }
});

// ---------------- Part 4: calibrated automatic traversal selection ----------------
test('automatic traversal uses the calibrated cost model and records its reasoning; manual choices are kept',{timeout:60000},()=>{
  const base={board:'Qs9h4d2c',common:10,stacks:[40,40],ranges:['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd','QcJc,TdTc,As4s,KdJd,6s5s,9d8d'],privateMode:'sampled',abstraction:'exact',evaluationDeals:128,engine:'native'};
  const turn3={...base,streets:{turn:{bets:'33,75,a',raises:'2.5x,a',maxBets:3},river:{bets:'33,75,a',raises:'2.5x,a',maxBets:3}}};
  const way3={board:'Ks8d5h2c',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs','AsKd,KcJc,5d5c,8h7h','Kc9c,QsQc,7d7c,Ah5s'],streets:{turn:{bets:'50',raises:'',maxBets:1},river:{bets:'50,a',raises:'',maxBets:1}},privateMode:'sampled',abstraction:'exact',evaluationDeals:128,engine:'native'};
  // validation/3.3/traversal-calibration.json: full traversal reached lower exact gain at equal time
  // on both trees (paired, 5 seeds); 3.2 chose external sampling for them.
  for(const cfg of [turn3,way3]){
    const s=E.MultiwayGame(cfg).traversalSelection;
    assert.equal(s.requested,'auto');assert.equal(s.chosen,'full traversal');assert.equal(s.gainRatio,3);
    assert.ok(s.states<=s.sampledWork);assert.match(s.reason,/full traversal/);
  }
  for(const traversal of ['full','external']){const s=E.MultiwayGame({...turn3,traversal}).traversalSelection;assert.equal(s.reason,'selected manually');assert.equal(s.chosen,traversal==='full'?'full traversal':'external sampling');}
  const d=E.MultiwayGame({...turn3,weighting:'dcfr'});assert.equal(d.traversalSelection.chosen,'external sampling');assert.match(d.traversalSelection.reason,/DCFR/);
  // Flops, preflop and 4+ seats keep the 3.2 prior (no exact reference is tractable there).
  const big=E.MultiwayGame({...six,traversal:'auto',engine:'native'}).traversalSelection;assert.equal(big.chosen,'external sampling');
  // A checkpoint keeps the traversal it was trained with whatever the rule says now.
  const restored=E.MultiwayGame(turn3,{restoredExternal:true}).traversalSelection;assert.equal(restored.chosen,'external sampling');assert.match(restored.reason,/checkpoint/);
  assert.ok(E.MultiwayGame(turn3).diagnostics().traversalSelection);
  const diag=E.MultiwayGame({...turn3,traversal:'external',weighting:'dcfr'}).diagnostics();
  assert.equal(diag.algorithm,'external-sampling DCFR');assert.match(diag.measures.throughput,/speed only/);assert.match(diag.measures.quality,/exact/);
  assert.match(E.MultiwayGame(six).diagnostics().measures.quality,/approximate unilateral/);
});
