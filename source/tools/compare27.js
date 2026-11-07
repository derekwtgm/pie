'use strict';
// Each version runs in a fresh process. Exact best responses evaluate sampled
// average strategies; intervals are across independent training seeds.
const fs=require('fs'),path=require('path'),os=require('os');
const root=path.resolve(process.argv[2]),out=process.argv[3],variant=process.argv[4]||'baseline';
const E=require(path.join(root,'tools/loadlib.js'));
for(const l of ['lib_runouts','lib_wide','lib_river'])require(path.join(root,'web',l+'.js'));
const cfg={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',traversal:'full',evaluationDeals:128};
const report={version:fs.readFileSync(path.join(root,'VERSION'),'utf8').trim(),variant,cfg,host:{cpu:os.cpus()[0].model,node:process.version,platform:process.platform},seeds:variant==='exact'?[1]:[1,2,3],rows:[],note:'Exact unilateral response gain in this restricted three-player river game, not full-poker exploitability. Batch modes perform more deals per iteration. Timings include competing benchmark processes.'};
const thresholds=process.env.EM_THRESHOLDS?JSON.parse(process.env.EM_THRESHOLDS):process.env.EM_QUICK?[1000,5000]:[1000,5000,10000,25000,50000,100000,250000];
for(const seed of report.seeds){
 const c={...cfg,privateSeed:seed,...(variant==='exact'?{privateMode:'exact'}:variant==='batch'?{batchDeals:4}:variant==='plus'?{batchDeals:4,regretMatching:'plus'}:{})},g=E.MultiwayGame(c);let done=0,seconds=0;
 for(const iterations of thresholds){const t=performance.now();g.iterate(iterations-done);seconds+=(performance.now()-t)/1000;done=iterations;const m=variant==='exact'?g.metrics():E.exactCheckSampled(c,g);report.rows.push({seed,iterations,trainingDeals:iterations*(c.batchDeals||1),seconds,maxGain:m.maxGain,gain:m.gain,rssMiB:process.memoryUsage().rss/2**20});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(variant,seed,iterations,m.maxGain.toFixed(6),seconds.toFixed(2));}
}
report.summary=thresholds.map(iterations=>{const r=report.rows.filter(x=>x.iterations===iterations),mean=r.reduce((s,x)=>s+x.maxGain,0)/r.length,sd=Math.sqrt(r.reduce((s,x)=>s+(x.maxGain-mean)**2,0)/(r.length-1));return {iterations,mean,ci95HalfWidth:4.303*sd/Math.sqrt(r.length),meanSeconds:r.reduce((s,x)=>s+x.seconds,0)/r.length};});fs.writeFileSync(out,JSON.stringify(report,null,2));
