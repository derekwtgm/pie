'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const E=require('../../source/tools/loadlib');for(const n of ['lib_runouts','lib_wide','lib_river'])require('../../source/web/'+n);
const [old,ot,now,nt,file]=process.argv.slice(2),seeds=[11,29,43,67,89,131,157],budgets=[4000,20000,50000,100000,250000,500000],times=[250,1000];
const cfg={board:'Qs9h4d2c7s',common:10,stacks:[40,40],ranges:['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd,Ts8s,AcAd,5h5d','QcJc,TdTc,As4s,KdJd,6s5s,9d8d,7c7d,AhJh,Kc2s'],streets:{river:{bets:'50,a',raises:'2.5x',maxBets:2}},engine:'native',privateMode:'sampled',abstraction:'exact',traversal:'external',weighting:'linear',batchDeals:1,evaluationDeals:128};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'em37-river-')),spec=path.join(dir,'spec'),st=path.join(dir,'state'),rows=[];
function quality(c){const g=E.MultiwayGame(c);g.importNative(fs.readFileSync(st));const q=E.exactCheckSampled(c,g);if(!q.available)throw Error(q.reason);
 return {deals:g.trainingDeals,exactExploitabilityBB:(q.gain[0]+q.gain[1])/2,seatGains:q.gain};}
function sum(v){const mean=v.reduce((a,b)=>a+b,0)/v.length;return {mean,ci95HalfWidth:2.447*Math.sqrt(v.reduce((a,b)=>a+(b-mean)**2,0)/(v.length*(v.length-1)))};}
try{
 for(const [j,seed] of seeds.entries()){
  const versions=[['3.6',old,ot],['3.7',now,nt]];for(const [version,cli,timer] of j%2?versions.reverse():versions){
   const c={...cfg,privateSeed:seed,...(version==='3.7'?{terminalBaseline:true}:{})};fs.writeFileSync(spec,JSON.stringify(E.MultiwayGame(c).nativeSpec()));
   let previous=0,seconds=0,processMs=0;
   for(const budget of budgets){const start=performance.now();const info=JSON.parse(cp.execFileSync(cli,[spec,''+(budget-previous),'1',st,'256',...(previous?[st]:[])]));
    seconds+=info.wallSeconds;processMs+=performance.now()-start;rows.push({version,seed,type:'sample',budget,seconds,processSeconds:processMs/1000,visits:info.stateVisits,peakRssMiB:info.processPeakRssMiB,...quality(c)});if(info.trainingDeals!==budget)throw Error('Sampling mismatch');previous=budget;}
   for(const budget of times){const start=performance.now(),seconds=Number(cp.execFileSync(timer,[spec,''+budget,'1',st])),processSeconds=(performance.now()-start)/1000;
    const bytes=fs.readFileSync(st),header=JSON.parse(bytes.toString('utf8',12,12+bytes.readUInt32LE(8)));rows.push({version,seed,type:'time',budget,seconds,processSeconds,visits:header.stateVisits,...quality(c)});}
  }
 }
 const paired=[];
 for(const [type,values] of [['sample',budgets],['time',times]])for(const budget of values){
  const group=rows.filter(r=>r.type===type&&r.budget===budget),v=(id,seed)=>group.find(r=>r.version===id&&r.seed===seed).exactExploitabilityBB;
  paired.push({type,budget,old:sum(seeds.map(s=>v('3.6',s))),updated:sum(seeds.map(s=>v('3.7',s))),reduction:sum(seeds.map(s=>v('3.6',s)-v('3.7',s)))});
 }
 fs.writeFileSync(file,JSON.stringify({method:'Independent finite river best responses, 3.6 baseline vs 3.7 optional fold baseline. Paired two-sided individual 95% t intervals across seven seeds.',cfg,seeds,threads:1,paired,rows},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
