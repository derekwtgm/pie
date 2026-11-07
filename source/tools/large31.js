// EightMax 3.1 large-game benchmark: JavaScript external sampling (the 3.0 path
// for these studies) against 3.1 native external sampling at equal wall time.
//
// usage: node tools/large31.js <timed-3.1> <out.json> [--quick]
//   timed-3.1  tools/timed_training.cpp built against 3.1 mw.cpp
// Exact best responses are intractable here. Reported measures:
//   - sampled deals per second (the JavaScript and native shared-stream engines
//     run the identical algorithm and produce identical strategies per deal);
//   - seed-to-seed dispersion of the first decision's action frequencies at an
//     equal training time: the mean over actions of the standard deviation across
//     independent seeds. Lower dispersion indicates a more settled strategy. It is
//     a stability diagnostic, not an equilibrium or exploitability bound.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const E=require('./loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const [timed,out]=process.argv.slice(2),quick=process.argv.includes('--quick');
const streets={flop:{bets:'33,75',raises:'3x',maxBets:2},turn:{bets:'66',raises:'a',maxBets:2},river:{bets:'75,a',raises:'',maxBets:1}};
const scenarios={
  'six-player flop, unequal stacks':{board:'Td7c2h',dealt:8,common:1.5,stacks:[20,35,18,50,24,26],prior:Array(6).fill(2.5),ranges:Array(6).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+'),streets},
  'eight-player linked preflop to river, 25 bb':{preflop:{mode:'linked',opens:'2.2,a',raises:'2.75x,a',maxBets:3,limps:true},board:'',dealt:8,common:0,stacks:Array(8).fill(25),ranges:Array(8).fill('random'),streets},
  'eight-player final table shove/call ICM':{preflop:{mode:'shove'},dealt:8,common:0,board:'',stacks:[12,9,15,6,11,8,20,14],ranges:Array(8).fill('random'),icm:{payouts:[30,20,14,10,8,7,6,5]}},
  'bubble ICM, five left, four paid, shove/call':{preflop:{mode:'shove'},dealt:5,common:0,board:'',stacks:[18,7,12,25,4],ranges:Array(5).fill('random'),icm:{payouts:[40,30,20,10]}},
  'four-way short-stack flop all-ins':{board:'9h8h3c',dealt:8,common:2.3,stacks:[6,9,4,12],prior:[2,2,2,2],ranges:Array(4).fill('random'),streets:{flop:{bets:'50,a',raises:'a',maxBets:2},turn:{bets:'a',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}}},
  'six-player linked preflop to river with ICM':{preflop:{mode:'linked',opens:'2.2,a',raises:'a',maxBets:2,limps:false},board:'',dealt:6,common:0,stacks:[30,22,15,40,18,25],ranges:Array(6).fill('random'),icm:{payouts:[50,30,20]},streets}
};
const engines=[
  {label:'3.0 path: JavaScript external sampling',js:true,over:{}},
  {label:'3.1 native external sampling, shared stream, 1 thread',over:{},threads:1},
  {label:'3.1 native external sampling, per-deal streams, batch 16, '+Math.min(4,os.cpus().length)+' threads',over:{batchDeals:16,actionStreams:'deal'},threads:Math.min(4,os.cpus().length)}
];
const seeds=quick?[1,2,3]:[1,2,3,4,5],budgets=quick?[1000]:[2000,8000];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'em31-large-')),rows=[];
const sd=v=>{const m=v.reduce((a,b)=>a+b,0)/v.length;return Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length-1));};
try{
  for(const [name,base] of Object.entries(scenarios))for(const eng of engines)for(const ms of budgets)for(const seed of seeds){
    const cfg={...base,privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:1024,evaluationSeed:424242,privateSeed:seed,...eng.over};
    const g=E.MultiwayGame(cfg);let seconds;
    if(eng.js){const t=performance.now();do{g.iterate(16);}while(performance.now()-t<ms);seconds=(performance.now()-t)/1000;}
    else{
      const spec=path.join(dir,'spec.json'),state=path.join(dir,'state');fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));
      seconds=+execFileSync(timed,[spec,String(ms),String(eng.threads),state]);g.importNative(fs.readFileSync(state));
    }
    // Root action frequencies of the average strategy over 256 fixed evaluation deals
    // (the same deals for every engine and seed of a scenario).
    const root=g.rootFrequencies();
    rows.push({scenario:name,engine:eng.label,budgetMs:ms,seed,seconds,deals:g.trainingDeals,dealsPerSecond:g.trainingDeals/seconds,
      strategyMiB:g.strategyMiB,root:root.map(a=>a.frequency),rootActions:root.map(a=>a.label)});
    process.stderr.write(name+' | '+eng.label+' | '+ms+' ms | seed '+seed+'\n');
  }
  const summary=[];
  for(const name of Object.keys(scenarios))for(const eng of engines)for(const ms of budgets){
    const r=rows.filter(x=>x.scenario===name&&x.engine===eng.label&&x.budgetMs===ms);
    const k=r[0].root.length,disp=Array.from({length:k},(_,a)=>sd(r.map(x=>x.root[a]))).reduce((a,b)=>a+b,0)/k;
    summary.push({scenario:name,engine:eng.label,budgetMs:ms,meanDealsPerSecond:r.reduce((a,x)=>a+x.dealsPerSecond,0)/r.length,
      meanDeals:r.reduce((a,x)=>a+x.deals,0)/r.length,rootDispersion:disp,seeds:r.length});
  }
  fs.writeFileSync(out,JSON.stringify({cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,node:process.version,measure:'root-strategy seed dispersion (stability diagnostic) and deals/s',summary,rows},null,1));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
