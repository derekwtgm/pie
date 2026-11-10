// Select on three pilot seeds, freeze the choice, evaluate on seven unseen seeds.
// The CLI train timer excludes evaluation and file export. The separate process
// wall time includes startup and export. Pilot time is reported separately.
const E=require('../../source/tools/loadlib');for(const l of ['lib_runouts','lib_wide','lib_river','lib_select'])require('../../source/web/'+l);
const fs=require('fs'),os=require('os'),cp=require('child_process'),path=require('path');
const [old,neo,timer,report]=process.argv.slice(2),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'em36target-')),cfg=require('./accuracy-river.json').cfg;
const file=path.join(tmp,'spec'),state=path.join(tmp,'state'),target=.15,horizons=[1000,4000,16000,64000];
(async()=>{const started=performance.now();const selected=await E.selectByTrials({...cfg,privateSeed:7409},async(g,ms)=>{
  fs.writeFileSync(file,JSON.stringify(g.nativeSpec()));const time=Number(cp.execFileSync(timer,[file,String(ms),'1',state]));
  g.importNative(fs.readFileSync(state));return {seconds:time,backend:'native CPU'};
});
const setupMs=performance.now()-started,rows=[];
for(const seed of [103,227,347,463,577,691,811]){
 for(const [name,exe,c] of (seed%3?[['3.5',old,cfg],['3.6',neo,selected.cfg]]:[['3.6',neo,selected.cfg],['3.5',old,cfg]])){
  const config={...c,privateSeed:seed},g=E.MultiwayGame(config);fs.writeFileSync(file,JSON.stringify(g.nativeSpec()));const result=[];
  for(const it of horizons){const t=performance.now(),r=JSON.parse(cp.execFileSync(exe,[file,String(it),'1',state,'256']));const processMs=performance.now()-t;
   const copy=E.MultiwayGame(config);copy.importNative(fs.readFileSync(state));const q=E.exactCheckSampled(config,copy),gap=(q.gain[0]+q.gain[1])/2;
   result.push({it,deals:r.trainingDeals,trainingMs:r.wallSeconds*1000,processMs,exactExploitabilityBB:gap});}
  const hit=result.find(x=>x.exactExploitabilityBB<=target);
  rows.push({seed,version:name,traversal:g.traversalSelection,weighting:g.diagnostics().weighting,horizons:result,firstObservedAtTarget:hit||null});
 }
}
fs.writeFileSync(report,JSON.stringify({targetBB:target,horizons,pilotWallMs:setupMs,selected,rows},null,1));})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(tmp,{recursive:true,force:true}));
