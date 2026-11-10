// node time-to-target.js <3.3 source> <3.3 Linux mwcli> <3.4 source> <3.4 Linux mwcli> <output.json>
// Each point is an independently started solve. Timed work includes making the game,
// building a native spec, startup, training, checkpoint export and JS strategy import.
// The exhaustive best-response evaluation happens outside the timer.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const args=process.argv.slice(2);
if(args[0]==='--point'){
 const [,src,cli,dir,engine,seed,horizon,kind]=args;
 const E=require(path.resolve(src,'tools/loadlib'));for(const lib of ['lib_runouts','lib_wide','lib_river'])require(path.resolve(src,'web',lib));
 const cfg={board:'Qs9h4d2c',common:10,stacks:[24,24],ranges:['AsQd:0.6,KhQh,9s9c,JhTh,8d7d,AhKd','QcJc,TdTc,As4s,KdJd,6s5s,9d8d'],bets:'60',raises:'',maxBets:1,privateMode:'sampled',abstraction:'detailed',traversal:kind,batchDeals:4,engine,privateSeed:+seed,evaluationDeals:128};
 const start=performance.now(),g=E.MultiwayGame(cfg);let peakNativeMiB=null,route='JavaScript';
 if(engine==='native' && !g.nativeSupport()){
  route='native C++';const spec=path.join(dir,'spec'),st=path.join(dir,'state');
  fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));const result=JSON.parse(cp.execFileSync(cli,[spec,horizon,'1',st,'512']));
  peakNativeMiB=result.processPeakRssMiB;g.importNative(fs.readFileSync(st));
 }else g.iterate(+horizon);
 const elapsedMs=performance.now()-start,quality=E.exactCheckSampled(cfg,g);
 if(!quality.available)throw Error(quality.reason);
 console.log(JSON.stringify({seed:+seed,horizon:+horizon,elapsedMs,route,chosen:g.traversalSelection.chosen,deals:g.trainingDeals,visits:g.diagnostics().stateVisits,
  largestExactGainBB:quality.maxGain,exploitabilityBB:quality.gain.reduce((a,b)=>a+b,0)/2,peakNativeMiB,jsHighWaterIncludingOracleMiB:process.resourceUsage().maxRSS/1024}));return;
}
const [a,cliA,b,cliB,out]=args,dir=fs.mkdtempSync(path.join(os.tmpdir(),'em34-target-'));
const report={cpu:os.cpus()[0].model,platform:process.platform,units:'BB',target:0.7,fixture:'weighted heads-up turn, Detailed, four deals per frozen update',rows:[],firstMeasuredCrossings:[]};
try{
 for(const [v,src,cli] of [['3.3',a,cliA],['3.4',b,cliB]])for(const engine of ['native','javascript'])for(const seed of [1,2,3]){
  let first=null;
  for(const h of [1000,4000,16000,64000]){
    const row={version:v,engine,...JSON.parse(cp.execFileSync(process.execPath,[__filename,'--point',src,cli,dir,engine,String(seed),String(h),'auto']))};
    report.rows.push(row);
    if(row.largestExactGainBB<=report.target){first=row;break;}
  }
  report.firstMeasuredCrossings.push({version:v,engine,seed,found:!!first,updates:first?.horizon,elapsedMs:first?.elapsedMs});
  fs.writeFileSync(out,JSON.stringify(report,null,2));
 }
}finally{fs.rmSync(dir,{recursive:true,force:true});}
