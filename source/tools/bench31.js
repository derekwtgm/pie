// EightMax 3.1 accuracy benchmark: 3.0 native full traversal against the 3.1
// native engines on games small enough for an exact unilateral best response.
//
// usage: node tools/bench31.js <mwcli-3.0> <mwcli-3.1> <timed-3.0> <timed-3.1> <out.json> [--quick] [--game=name]
//   mwcli-*  command-line drivers built from each release's mw.cpp
//   timed-*  tools/timed_training.cpp built against each release's mw.cpp
// Metric: the largest exact unilateral response gain (BB) of any seat against the
// trained average strategy in the configured finite game (exactCheckSampled).
// For three players this is NOT an equilibrium certificate; it measures how much
// one seat could gain by deviating alone.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const E=require('./loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const [cli30,cli31,timed30,timed31,out]=process.argv.slice(2);
const quick=process.argv.includes('--quick'),only=(process.argv.find(a=>a.startsWith('--game='))||'').slice(7);
const games={
  'three-player river':{board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
    streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',evaluationDeals:128},
  'heads-up turn':{board:'Qs9h4d2c',common:10,stacks:[40,40],ranges:['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd','QcJc,TdTc,As4s,KdJd,6s5s,9d8d'],
    streets:{turn:{bets:'60',raises:'',maxBets:1},river:{bets:'75,a',raises:'',maxBets:1}},privateMode:'sampled',abstraction:'exact',evaluationDeals:128}
};
const engines=[
  {label:'3.0 JavaScript external sampling (batch 1)',js:true,over:{traversal:'external',batchDeals:1},maxDeals:100000},
  {label:'3.0 native full traversal (batch 4)',cli:cli30,timed:timed30,over:{traversal:'full',batchDeals:4},threads:1},
  {label:'3.1 native full traversal (batch 4)',cli:cli31,timed:timed31,over:{traversal:'full',batchDeals:4},threads:1},
  {label:'3.1 native external sampling (shared stream, batch 1)',cli:cli31,timed:timed31,over:{traversal:'external',batchDeals:1},threads:1},
  {label:'3.1 native external sampling (per-deal streams, batch 16, 4 threads)',cli:cli31,timed:timed31,over:{traversal:'external',batchDeals:16,actionStreams:'deal'},threads:4}
];
const seeds=quick?[1,2,3]:[1,2,3,4,5],checkpoints=quick?[4000,20000,50000]:[4000,20000,50000,100000,250000,500000];
const budgets=quick?[250,1000]:[250,1000,4000];
const tq={2:12.706,3:4.303,4:3.182,5:2.776,6:2.571};
const summarize=v=>{const m=v.reduce((a,b)=>a+b,0)/v.length,sd=Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length-1));return {mean:m,ci95:tq[v.length]*sd/Math.sqrt(v.length),n:v.length};};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'em31-bench-')),result={cpu:os.cpus()[0].model,threadsAvailable:os.cpus().length,node:process.version,metric:'largest exact unilateral response gain, BB',games:{}};
try{
  for(const [name,base] of Object.entries(games)){
    if(only && only!==name)continue;
    const rows=[];
    for(const eng of engines)for(const seed of seeds){
      const cfg={...base,...eng.over,privateSeed:seed},spec=path.join(dir,'spec.json'),state=path.join(dir,'state');
      const g0=E.MultiwayGame(cfg);fs.writeFileSync(spec,JSON.stringify(g0.nativeSpec()));
      const B=cfg.batchDeals;let previous=0,seconds=0;
      if(eng.js){   // 3.0 trained sampled betting (external) studies in JavaScript; the algorithm is identical to 3.1 native.
        const g=E.MultiwayGame(cfg);
        for(const deals of checkpoints.filter(d=>d<=eng.maxDeals)){const t=performance.now();g.iterate(Math.round((deals-previous)/B));seconds+=(performance.now()-t)/1000;previous=deals;
          rows.push({kind:'deals',engine:eng.label,seed,deals:g.trainingDeals,seconds,maxGainBb:E.exactCheckSampled(cfg,g).maxGain});}
        for(const ms of budgets){const h=E.MultiwayGame(cfg),t=performance.now();do{h.iterate(64);}while(performance.now()-t<ms);
          rows.push({kind:'time',engine:eng.label,seed,budgetMs:ms,seconds:(performance.now()-t)/1000,deals:h.trainingDeals,maxGainBb:E.exactCheckSampled(cfg,h).maxGain});}
        process.stderr.write(name+' | '+eng.label+' | seed '+seed+' done\n');continue;
      }
      for(const deals of checkpoints){
        const its=Math.round((deals-previous)/B);
        const info=JSON.parse(execFileSync(eng.cli,[spec,String(its),String(eng.threads),state,'512',...(previous?[state]:[])]));
        seconds+=info.wallSeconds;previous=deals;
        const g=E.MultiwayGame(cfg);g.importNative(fs.readFileSync(state));
        const x=E.exactCheckSampled(cfg,g);if(!x.available)throw Error(name+': '+x.reason);
        rows.push({kind:'deals',engine:eng.label,seed,deals:g.trainingDeals,seconds,maxGainBb:x.maxGain,unvisited:x.unvisitedInformationSets});
      }
      for(const ms of budgets){
        const seconds2=+execFileSync(eng.timed,[spec,String(ms),String(eng.threads),state]);
        const g=E.MultiwayGame(cfg);g.importNative(fs.readFileSync(state));
        rows.push({kind:'time',engine:eng.label,seed,budgetMs:ms,seconds:seconds2,deals:g.trainingDeals,maxGainBb:E.exactCheckSampled(cfg,g).maxGain});
      }
      process.stderr.write(name+' | '+eng.label+' | seed '+seed+' done\n');
    }
    const byDeals=[],byTime=[];
    for(const eng of engines){
      for(const deals of checkpoints){const r=rows.filter(x=>x.kind==='deals'&&x.engine===eng.label&&x.deals===deals);
        if(r.length)byDeals.push({engine:eng.label,deals,gain:summarize(r.map(x=>x.maxGainBb)),seconds:summarize(r.map(x=>x.seconds)).mean});}
      for(const ms of budgets){const r=rows.filter(x=>x.kind==='time'&&x.engine===eng.label&&x.budgetMs===ms);
        byTime.push({engine:eng.label,budgetMs:ms,gain:summarize(r.map(x=>x.maxGainBb)),deals:summarize(r.map(x=>x.deals)).mean,seconds:summarize(r.map(x=>x.seconds)).mean});}
    }
    result.games[name]={config:base,seeds,byDeals,byTime,rows};
  }
  fs.writeFileSync(out,JSON.stringify(result,null,1));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
