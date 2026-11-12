// Execute on a fixed river with overlapping weighted ranges. Compare identical
// group semantics and identical physical deals. Exact cards is a separate model.
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
const E=require('./loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const [cli,out]=process.argv.slice(2),dir=fs.mkdtempSync(path.join(os.tmpdir(),'group32-')),rows=[];
try{
 for(const abstraction of ['compact','detailed','exact'])for(const seed of [1,2,3]){
  const cfg={board:'Ks8d5h2c2s',common:12,streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},stacks:[30,30,30],ranges:Array(3).fill('22+,A2s+,K9s+,QTs+,ATo+:0.6'),privateMode:'sampled',abstraction,traversal:'external',batchDeals:4,actionStreams:'deal',evaluationDeals:128,privateSeed:seed};
  const js=E.MultiwayGame(cfg),spec=path.join(dir,'spec'),state=path.join(dir,'state');
  fs.writeFileSync(spec,JSON.stringify(js.nativeSpec()));const start=performance.now();js.iterate(2000);
  const jsSeconds=(performance.now()-start)/1000;
  const info=JSON.parse(execFileSync(cli,[spec,'2000','2',state,'64']));
  if(info.iterations!==2000||!info.rows)throw Error('Untrained benchmark fixture');
  rows.push({abstraction,seed,deals:info.trainingDeals,jsSeconds,nativeSeconds:info.wallSeconds,nativeRows:info.rows,nativeCapacityBytes:info.tableCapacityBytes,jsEstimatedBytes:js.strategyMiB*1048576});
 }
 fs.writeFileSync(out,JSON.stringify({cpu:os.cpus()[0].model,rows},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
