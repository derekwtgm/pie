// EightMax 3.3 accuracy benchmark: 3.2 native engines against 3.3 native engines
// (linear MCCFR, CFR+, new external-sampling DCFR, full traversal) on games small
// enough for an exact unilateral best response.
//
// usage: node tools/bench33.js <mwcli-3.2> <timed-3.2> <mwcli-3.3> <timed-3.3> <out.json> [--quick] [--game=name]
//   mwcli-*  command-line drivers built from each release's mw.cpp
//   timed-*  tools/timed_training.cpp built against each release's mw.cpp
// Metric: the largest exact unilateral response gain (BB) of any seat against the
// trained average strategy in the configured finite game (exactCheckSampled).
// Heads-up games are two-player zero-sum, so the sum of both seats' gains is the
// exact exploitability of the average profile (reported as sumGainBb). For three
// players this is NOT an equilibrium certificate; it measures how much one seat
// could gain by deviating alone.
// Equal deals and equal wall time are both reported. Intervals: two-sided 95%
// Student t over seeds; "paired" rows difference two engines seed by seed.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const E=require('./loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const [cli32,timed32,cli33,timed33,out]=process.argv.slice(2);
const quick=process.argv.includes('--quick'),only=(process.argv.find(a=>a.startsWith('--game='))||'').slice(7);
const games={
  'heads-up turn':{board:'Qs9h4d2c',common:10,stacks:[40,40],ranges:['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd','QcJc,TdTc,As4s,KdJd,6s5s,9d8d'],
    streets:{turn:{bets:'60',raises:'',maxBets:1},river:{bets:'75,a',raises:'',maxBets:1}},privateMode:'sampled',abstraction:'exact',evaluationDeals:128},
  'heads-up river':{board:'Qs9h4d2c7s',common:10,stacks:[40,40],ranges:['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd,Ts8s,AcAd,5h5d','QcJc,TdTc,As4s,KdJd,6s5s,9d8d,7c7d,AhJh,Kc2s'],
    streets:{river:{bets:'50,a',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',evaluationDeals:128},
  'three-player river':{board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
    streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',evaluationDeals:128}
};
const ES={traversal:'external',batchDeals:1};
const engines=[
  {label:'3.2 external sampling, linear',cli:cli32,timed:timed32,over:{...ES},threads:1},
  {label:'3.3 external sampling, linear',cli:cli33,timed:timed33,over:{...ES},threads:1},
  {label:'3.3 external sampling, CFR+ linear',cli:cli33,timed:timed33,over:{...ES,regretMatching:'plus'},threads:1},
  {label:'3.3 external sampling, DCFR (1.5, 0, 2)',cli:cli33,timed:timed33,over:{...ES,weighting:'dcfr'},threads:1},
  {label:'3.3 external sampling, DCFR (2, 1, 1)',cli:cli33,timed:timed33,over:{...ES,weighting:'dcfr',dcfrAlpha:2,dcfrBeta:1,dcfrGamma:1},threads:1},
  {label:'3.3 external sampling, DCFR, per-deal streams, batch 16, 4 threads',cli:cli33,timed:timed33,over:{traversal:'external',batchDeals:16,actionStreams:'deal',weighting:'dcfr'},threads:4},
  {label:'3.3 full traversal, linear (batch 4)',cli:cli33,timed:timed33,over:{traversal:'full',batchDeals:4},threads:1}
];
const pairs=[['3.3 external sampling, DCFR (1.5, 0, 2)','3.3 external sampling, linear'],['3.3 external sampling, linear','3.2 external sampling, linear'],
  ['3.3 external sampling, CFR+ linear','3.3 external sampling, linear'],['3.3 external sampling, DCFR (2, 1, 1)','3.3 external sampling, linear']];
const seeds=quick?[1,2,3]:[1,2,3,4,5],checkpoints=quick?[4000,20000]:[4000,20000,50000,100000,250000,500000];
const budgets=quick?[250]:[250,1000,4000];
const tq={2:12.706,3:4.303,4:3.182,5:2.776,6:2.571};
const summarize=v=>{const m=v.reduce((a,b)=>a+b,0)/v.length,sd=v.length>1?Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length-1)):0;return {mean:m,ci95:v.length>1?tq[v.length]*sd/Math.sqrt(v.length):null,n:v.length};};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'em33-bench-'));
const result={generated:new Date().toISOString(),cpu:os.cpus()[0].model,threadsAvailable:os.cpus().length,node:process.version,
  metric:'largest exact unilateral response gain (BB); heads-up sumGainBb is exact exploitability of the average profile',games:{}};
function measure(cfg,g){const x=E.exactCheckSampled(cfg,g);if(!x.available)throw Error(x.reason);
  return {maxGainBb:x.maxGain,sumGainBb:x.gain.length===2?x.gain[0]+x.gain[1]:null};}
try{
  for(const [name,base] of Object.entries(games)){
    if(only && only!==name)continue;
    const rows=[];
    for(const eng of engines)for(const seed of seeds){
      const cfg={...base,...eng.over,privateSeed:seed},spec=path.join(dir,'spec.json'),state=path.join(dir,'state');
      const g0=E.MultiwayGame(cfg);fs.writeFileSync(spec,JSON.stringify(g0.nativeSpec()));
      const B=cfg.batchDeals;let previous=0,seconds=0;
      for(const deals of checkpoints){
        const its=Math.round((deals-previous)/B);
        const info=JSON.parse(execFileSync(eng.cli,[spec,String(its),String(eng.threads),state,'512',...(previous?[state]:[])]));
        seconds+=info.wallSeconds;previous=deals;
        const g=E.MultiwayGame(cfg);g.importNative(fs.readFileSync(state));
        rows.push({kind:'deals',engine:eng.label,seed,deals:g.trainingDeals,seconds,stateVisits:info.stateVisits,...measure(cfg,g)});
      }
      for(const ms of budgets){
        const s2=+execFileSync(eng.timed,[spec,String(ms),String(eng.threads),state]);
        const g=E.MultiwayGame(cfg);g.importNative(fs.readFileSync(state));
        rows.push({kind:'time',engine:eng.label,seed,budgetMs:ms,seconds:s2,deals:g.trainingDeals,...measure(cfg,g)});
      }
      process.stderr.write(name+' | '+eng.label+' | seed '+seed+' done\n');
    }
    const byDeals=[],byTime=[],paired=[];
    for(const eng of engines){
      for(const deals of checkpoints){const r=rows.filter(x=>x.kind==='deals'&&x.engine===eng.label&&x.deals===deals);
        if(r.length)byDeals.push({engine:eng.label,deals,gain:summarize(r.map(x=>x.maxGainBb)),...(r[0].sumGainBb!=null?{exploitability:summarize(r.map(x=>x.sumGainBb))}:{}),seconds:summarize(r.map(x=>x.seconds)).mean});}
      for(const ms of budgets){const r=rows.filter(x=>x.kind==='time'&&x.engine===eng.label&&x.budgetMs===ms);
        byTime.push({engine:eng.label,budgetMs:ms,gain:summarize(r.map(x=>x.maxGainBb)),...(r[0].sumGainBb!=null?{exploitability:summarize(r.map(x=>x.sumGainBb))}:{}),deals:summarize(r.map(x=>x.deals)).mean,seconds:summarize(r.map(x=>x.seconds)).mean});}
    }
    for(const [a,b] of pairs){
      for(const deals of checkpoints){const d=seeds.map(s=>{const x=rows.find(r=>r.kind==='deals'&&r.engine===a&&r.seed===s&&r.deals===deals),y=rows.find(r=>r.kind==='deals'&&r.engine===b&&r.seed===s&&r.deals===deals);return y.maxGainBb-x.maxGainBb;});
        paired.push({better:a,than:b,deals,reductionBb:summarize(d)});}
      for(const ms of budgets){const d=seeds.map(s=>{const x=rows.find(r=>r.kind==='time'&&r.engine===a&&r.seed===s&&r.budgetMs===ms),y=rows.find(r=>r.kind==='time'&&r.engine===b&&r.seed===s&&r.budgetMs===ms);return y.maxGainBb-x.maxGainBb;});
        paired.push({better:a,than:b,budgetMs:ms,reductionBb:summarize(d)});}
    }
    result.games[name]={config:base,seeds,byDeals,byTime,paired,rows};fs.writeFileSync(out,JSON.stringify(result,null,1));
  }
  fs.writeFileSync(out,JSON.stringify(result,null,1));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
