'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
if(process.argv[2]==='child'){
 const root=path.resolve(process.argv[3]),n=+process.argv[4],E=require(path.join(root,'tools/loadlib'));
 for(const lib of ['lib_runouts','lib_wide','lib_river','lib_river_ui'])require(path.join(root,'web',lib));
 const cfg={...E.multiwaySpotConfig(E.multiwayExample(n,'Flop',8)),privateMode:'sampled',evaluationDeals:256,batchDeals:4,privateSeed:17};
 const g=E.MultiwayGame(cfg);g.iterate(100);
 const evaluate=()=>g.rootFrequencies?g.rootFrequencies():g.view([]).actions;
 const frequencies=evaluate().map(x=>x.frequency),times=[];
 for(let i=0;i<7;i++){let t=performance.now();evaluate();times.push(performance.now()-t);}
 console.log(JSON.stringify({n,frequencies,ms:times,medianMs:[...times].sort((a,b)=>a-b)[3]}));
}else{
 const out=[];
 for(const n of [6,7,8]){
  const [before,after]=process.argv.slice(2,4).map(root=>JSON.parse(execFileSync(process.execPath,[__filename,'child',root,n])));
  require('node:assert/strict').deepEqual(before.frequencies,after.frequencies);out.push({before,after,ratio:before.medianMs/after.medianMs});
 }
 fs.writeFileSync(process.argv[4],JSON.stringify(out,null,2));
}
