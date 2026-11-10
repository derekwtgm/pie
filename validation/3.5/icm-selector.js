// node icm-selector.js timed-training output.json
const E=require('../../source/tools/loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river'])require('../../source/web/'+l);
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const [timer,out]=process.argv.slice(2),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'em-icm-'));
const config={board:'2c4d7h9sJc',common:4,stacks:[4,8,13,20],ranges:['QhQd,9c9d','AsAd,KsTh','JhJd,8s8d','AcKd,5c5d'],bets:'a',raises:'',maxBets:1,privateMode:'sampled',engine:'native',abstraction:'exact',icm:{payouts:[50,30,20]},batchDeals:1,evaluationDeals:128};
const rows=[];
try{
 for(const seed of [1,2,3,4,5])for(const traversal of seed%2?['full','external']:['external','full']){
  const cfg={...config,privateSeed:seed,traversal},g=E.MultiwayGame(cfg);
  const spec=path.join(tmp,'spec'),state=path.join(tmp,'state');fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));
  const seconds=Number(cp.execFileSync(timer,[spec,'250','1',state]));g.importNative(fs.readFileSync(state));
  const q=E.exactCheckSampled(cfg,g);if(!q.available)throw Error(q.reason);
  rows.push({seed,traversal,seconds,deals:g.trainingDeals,maxUnilateralGainPrizeUnits:q.maxGain});
 }
 fs.writeFileSync(out,JSON.stringify({config,auto:E.MultiwayGame({...config,traversal:'auto'}).traversalSelection,budgetMs:250,threads:1,rows},null,1));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
