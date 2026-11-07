'use strict';
const fs=require('fs'),E=require('./loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const hands=['QhQd:0.6,9c9d','AsAd:0.7,KsTh','JhJd:0.8,8s8d','AcKd:0.7,5c5d','AhKh:0.5,6s6h','TsTc:0.5,7c7d','9h9s:0.3,AdQd','KhQh:0.9,4c4d'];
const rows=[];
for(let n=2;n<=8;n++)for(const icm of [false,true]){
 const board=['2c4d7h','2c4d7h9s','2c4d7h9sJc'][n%3],cfg={board,common:0,dealt:8,prior:Array(n).fill(2),stacks:[1,5,12,25,40,50,70,100].slice(0,n),ranges:hands.slice(0,n),bets:'33,75,a',raises:'2.5x,a',maxBets:2,privateMode:'sampled',traversal:'external',batchDeals:4,privateSeed:11,evaluationDeals:128,...(icm?{icm:{payouts:[50,30,20],others:Array.from({length:8-n},(_,i)=>2+4*i)}}:{})};
 const g=E.MultiwayGame(cfg),t=performance.now();g.iterate(250);const seconds=(performance.now()-t)/1000,m=g.metrics();
 const total=m.ev.reduce((a,x)=>a+x,0);
 if(m.ev.some(x=>!Number.isFinite(x))||(icm?(total>100+1e-8||m.ev.some(x=>x<0)||(n===8&&Math.abs(total-100)>1e-8)):Math.abs(total-(2*n+0.8))>1e-8))throw Error('Utility conservation failed at '+n);
 rows.push({cfg,n,icm,seconds,trainingDeals:g.trainingDeals,rssMiB:process.resourceUsage().maxRSS/1024,ev:m.ev,standardErrors:m.se});
}
fs.writeFileSync(process.argv[2],JSON.stringify({rows},null,2));
