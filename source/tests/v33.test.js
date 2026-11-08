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
