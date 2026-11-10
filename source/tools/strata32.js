'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
const E=require('./loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const [cli,out]=process.argv.slice(2),dir=fs.mkdtempSync(path.join(os.tmpdir(),'strata32-')),rows=[];
try{
  for(const seed of [1,2,3,4,5])for(const stratified of [false,true]){
    const cfg={board:'2c4d7h9sJc',common:10,stacks:[11,20,32],ranges:['QhQd:0.8,9c9d','AsAd,KsTh:0.4','JhJd,8s8d'],
      privateMode:'sampled',abstraction:'exact',traversal:'external',externalRiverStrata:stratified,
      bets:'50,100',raises:'a',maxBets:2,privateSeed:seed,batchDeals:4,evaluationDeals:128};
    const g=E.MultiwayGame(cfg),spec=path.join(dir,'spec'),state=path.join(dir,'state');
    fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));
    const info=JSON.parse(execFileSync(cli,[spec,'2048','1',state,'64']));
    g.importNative(fs.readFileSync(state));const check=E.exactCheckSampled(cfg,g);
    if(!check.available)throw Error(check.reason);
    rows.push({seed,stratified,deals:info.trainingDeals,seconds:info.wallSeconds,maxUnilateralGainBB:check.maxGain});
  }
  fs.writeFileSync(out,JSON.stringify({rows},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
