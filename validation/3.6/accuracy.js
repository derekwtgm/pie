// Native time and work budgets. Evaluation uses a separately constructed full
// enumeration of both hidden ranges and every action in the river abstraction.
const fs=require('fs'),os=require('os'),cp=require('child_process'),path=require('path');
const E=require('../../source/tools/loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../../source/web/'+l);
const [cli,timer,out]=process.argv.slice(2),dir=fs.mkdtempSync(path.join(os.tmpdir(),'em36-math-'));
const cfg={board:'Qs9h4d2c7s',common:10,stacks:[40,40],ranges:['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd,Ts8s,AcAd,5h5d','QcJc,TdTc,As4s,KdJd,6s5s,9d8d,7c7d,AhJh,Kc2s'],streets:{river:{bets:'50,a',raises:'2.5x',maxBets:2}},engine:'native',privateMode:'sampled',abstraction:'exact',batchDeals:1,evaluationDeals:128};
const variants=[
 ['full standard linear',{traversal:'full',regretMatching:'standard',weighting:'linear'}],
 ['external linear',{traversal:'external'}],['external conditional terminals',{traversal:'external',terminalExpectation:true}],
 ['full CFR+ linear',{traversal:'full',regretMatching:'plus'}],['full CFR uniform',{traversal:'full',regretMatching:'standard',weighting:'uniform'}],
 ['external DCFR',{traversal:'external',regretMatching:'standard',weighting:'dcfr'}]];
const rows=[],seeds=[11,29,43,67,89,131,157,193,239];
function solve(config,mode){const g=E.MultiwayGame(config),sp=path.join(dir,'spec'),state=path.join(dir,'state');fs.writeFileSync(sp,JSON.stringify(g.nativeSpec()));
 let seconds,peak=null;if(mode==='work'){const r=JSON.parse(cp.execFileSync(cli,[sp,'4000','1',state,'256']));seconds=r.wallSeconds;peak=r.processPeakRssMiB;}
 else seconds=Number(cp.execFileSync(timer,[sp,'100','1',state]));
 g.importNative(fs.readFileSync(state));const q=E.exactCheckSampled(config,g);if(!q.available)throw Error(q.reason);
 return {deals:g.trainingDeals,seconds,peakRssMiB:peak,exploitabilityBB:(q.gain[0]+q.gain[1])/2,seatGainsBB:q.gain};
}
try{for(let j=0;j<seeds.length;j++){
 for(let i=0;i<variants.length;i++){const [name,over]=variants[(i+j)%variants.length],config={...cfg,...over,privateSeed:seeds[j]};rows.push({seed:seeds[j],variant:name,equalWork:solve(config,'work'),equalTime:solve(config,'time')});}
 fs.writeFileSync(out,JSON.stringify({cfg,variants,threads:1,updates:4000,timeBudgetMs:100,rows},null,1));
}}finally{fs.rmSync(dir,{recursive:true,force:true});}
