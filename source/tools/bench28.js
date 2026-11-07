'use strict';
// Each version runs in a fresh process. Exact best responses evaluate sampled
// average strategies; intervals are across independent training seeds.
const fs=require('fs'),path=require('path'),os=require('os');
const root=path.resolve(process.argv[2]),out=process.argv[3],variant=process.argv[4]||'baseline';
const E=require(path.join(root,'tools/loadlib.js'));
for(const l of ['lib_runouts','lib_wide','lib_river'])require(path.join(root,'web',l+'.js'));
const cfg={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',traversal:'full',evaluationDeals:128};
const batchDeals=variant==='sequential'?1:4;
const seeds=[1,2,3],rows=[];
const budgets=[4000,20000,50000,100000,250000];
for(const seed of seeds){
 const c={...cfg,batchDeals,riverStrata:variant==='stratified',privateSeed:seed};
 for(const timed of [false,true]){
  const g=E.MultiwayGame(c);let updates=0,seconds=0,cpuMs=0;
  for(const target of timed?[1,3]:budgets){
   const start=performance.now(),cpu=process.cpuUsage();
   if(timed){while(seconds+(performance.now()-start)/1000<target){g.iterate(8);updates+=8;}}
   else{g.iterate(target/batchDeals-updates);updates=target/batchDeals;}
   seconds+=(performance.now()-start)/1000;const used=process.cpuUsage(cpu);cpuMs+=(used.system+used.user)/1000;
   const result=E.exactCheckSampled(c,g);
   rows.push({seed,timed,target,updates,deals:g.trainingDeals??updates*batchDeals,seconds,cpuMs,
    peakProcessMiB:process.resourceUsage().maxRSS/1024,updatesPerSecond:updates/seconds,dealsPerSecond:updates*batchDeals/seconds,
    gains:result.gain,maxGain:result.maxGain});
  }
 }
}
const summary=[];
for(const timed of [false,true])for(const target of timed?[1,3]:budgets){
 const r=rows.filter(x=>x.target===target&&x.timed===timed),mean=k=>r.reduce((a,v)=>a+v[k],0)/r.length;
 const gain=mean('maxGain');summary.push({timed,target,meanGain:gain,ci95Half:4.303*Math.sqrt(r.reduce((a,v)=>a+(v.maxGain-gain)**2,0)/6),meanSeconds:mean('seconds'),meanDealsPerSecond:mean('dealsPerSecond')});
}
fs.writeFileSync(out,JSON.stringify({version:fs.readFileSync(path.join(root,'VERSION'),'utf8').trim(),variant,batchDeals,cfg,seeds,cpu:os.cpus()[0].model,rows,summary},null,2));
