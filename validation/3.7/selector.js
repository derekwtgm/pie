// Supply the extracted 3.6 source directory, current source directory and output JSON.
'use strict';
const fs=require('fs'),cp=require('child_process'),path=require('path');
async function measure(source){
 const root=path.resolve(source),E=require(path.join(root,'tools/loadlib.js'));for(const k of ['lib_runouts','lib_wide','lib_river','lib_select'])require(path.join(root,'web',k+'.js'));
 const cfg={board:'Qs9h4d2c7s',common:8,stacks:[18,20],ranges:['AsQd,KhQh,9s9c','QcJc,TdTc,As4s'],bets:'50,a',raises:'2.5x',maxBets:2,privateMode:'sampled',abstraction:'exact',evaluationDeals:128,batchDeals:4,accuracyPreset:'fast',traversal:'external',weighting:'linear',regretMatching:'standard',privateSeed:839};
 const rows=[];
 for(const [study,updates,extra] of [['short',64,{}],['single eligible',2000,{traversal:'full',terminalExpectation:false}],['cold',10000,{}],['repeat',10000,{}]]){
  let calls=0,deals=0;const start=performance.now();const r=await E.selectByTrials({...cfg,...extra},async(g,ms)=>{
   const t=performance.now();calls++;do{g.iterate(1);}while(performance.now()-t<ms&&!g.limitReached);deals+=g.trainingDeals;return {seconds:(performance.now()-t)/1000};
  },undefined,undefined,{updates,backend:{engine:'js',device:'cpu',threads:1}});
  rows.push({study,updates,calls,pilotDeals:deals,wallMs:performance.now()-start,reason:r.reason,reused:!!r.reused,algorithm:r.cfg.traversal});
 }return rows;
}
if(process.argv[2]==='--worker')measure(process.argv[3]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
else{const o={method:'Each version in its own Node process. Real 60 ms pilots and finite best responses. One observation for each condition.'};
 for(const [v,src] of [['3.6',process.argv[2]],['3.7',process.argv[3]]])o[v]=JSON.parse(cp.execFileSync(process.execPath,[__filename,'--worker',src]));
 fs.writeFileSync(process.argv[4],JSON.stringify(o,null,2));}
