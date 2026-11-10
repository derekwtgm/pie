// Usage: node source/tools/grouped34.js /path/to/mwcli /path/to/timed_training results.json
// A fresh JS worker measures each run's peak RSS. The native timer stops at a
// progress boundary. Both elapsed times exclude importing a strategy for evaluation.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const E=require('./loadlib');for(const l of ['lib_runouts','lib_river','lib_wide'])require('../web/'+l);
if(process.argv[2]==='--js'){
 const cfg=JSON.parse(fs.readFileSync(process.argv[3])),g=E.MultiwayGame(cfg),start=performance.now();
 g.iterate(1000);const seconds=(performance.now()-start)/1000;
 const gain=E.exactCheckSampled(cfg,g);
 console.log(JSON.stringify({seconds,gain:gain.maxGain,visits:g.diagnostics().stateVisits,peakRSSMiB:process.resourceUsage().maxRSS/1024}));return;
}
const [cli,timed,out]=process.argv.slice(2),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'em34-compare-'));
const file=path.join(tmp,'study'),state=path.join(tmp,'state'),cfgFile=path.join(tmp,'config');
const rows=[],result={cpu:os.cpus()[0].model,platform:process.platform,budgetMs:300,rows};
try{
 for(const board of ['Qs9h4d2c','Qs9h4d2c7s'])for(const abstraction of ['compact','detailed'])for(const seed of [1,2,3]){
  const cfg={board,abstraction,privateSeed:seed,privateMode:'sampled',batchDeals:4,common:10,stacks:[24,24],
    ranges:['AsQd:0.6,KhQh,9s9c,JhTh,8d7d,AhKd','QcJc,TdTc,As4s,KdJd,6s5s,9d8d'],bets:'60',raises:'',maxBets:1,evaluationDeals:128};
  const row={cfg,seed};for(const traversal of ['full','external']){
    const c={...cfg,traversal},g=E.MultiwayGame(c);
    fs.writeFileSync(file,JSON.stringify(g.nativeSpec()));fs.writeFileSync(cfgFile,JSON.stringify(c));
    const start=performance.now();
    const info=JSON.parse(cp.execFileSync(cli,[file,'1000','1',state,'512']));
    const endToEndSeconds=(performance.now()-start)/1000;
    g.importNative(fs.readFileSync(state));
    const finite=E.exactCheckSampled(c,g);if(!finite.available)throw Error(finite.reason);
    const fixed={gain:finite.maxGain,exploitability:finite.gain.reduce((a,b)=>a+b,0)/2,visits:info.stateVisits,
      seconds:info.wallSeconds,endToEndSeconds,peakRSSMiB:info.processPeakRssMiB,visitsPerSecond:info.stateVisits/info.wallSeconds};
    const js=JSON.parse(cp.execFileSync(process.execPath,[__filename,'--js',cfgFile]));
    if(Math.abs(js.gain-fixed.gain)>1e-11||js.visits!==fixed.visits)throw Error('JavaScript/reference discrepancy');
    const seconds=Number(cp.execFileSync(timed,[file,'300','1',state]));
    const deadline=E.MultiwayGame(c);deadline.importNative(fs.readFileSync(state));const q=E.exactCheckSampled(c,deadline);
    row[traversal]={js,fixed,equalTime:{seconds,deals:deadline.trainingDeals,gain:q.maxGain,exploitability:q.gain.reduce((a,b)=>a+b,0)/2}};
  }
  rows.push(row);fs.writeFileSync(out,JSON.stringify(result,null,1));
 }
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
