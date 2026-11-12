// Run after extracting the ZIP: node source/tools/device_benchmark.js mwcli.exe results.json
// Reports the observed scoring route so a fallback cannot be mistaken for CUDA.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const E=require('./loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const [exe,out]=process.argv.slice(2),dir=fs.mkdtempSync(path.join(os.tmpdir(),'em-device-')),rows=[];
const config={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],
 ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
 bets:'50,125',raises:'2.5x',maxBets:2,privateMode:'sampled',abstraction:'exact',traversal:'full',batchDeals:16,evaluationDeals:128};
try{
 for(const seed of [1,2,3]){
  const cfg={...config,privateSeed:seed};
  const js=E.MultiwayGame(cfg);const start=performance.now();js.iterate(1250);
  const seconds=(performance.now()-start)/1000,gain=E.exactCheckSampled(cfg,js).maxGain;
  rows.push({seed,mode:'JS',deals:js.trainingDeals,seconds,maxGainBb:gain});
  for(const mode of ['cpu','auto','gpu','hybrid']){
   const threadCounts=mode==='cpu'?[...new Set([1,2,4,8,Math.min(16,os.availableParallelism())])]:[1];
   for(const threads of threadCounts){
    const game=E.MultiwayGame({...cfg,processingMode:mode}),spec=path.join(dir,'spec'),state=path.join(dir,'state');
    fs.writeFileSync(spec,JSON.stringify(game.nativeSpec()));const wall=performance.now();
    const info=JSON.parse(execFileSync(path.resolve(exe),[spec,'1250',String(threads),state,'512']));
    const endToEndSeconds=(performance.now()-wall)/1000;
    game.importNative(fs.readFileSync(state));const maxGainBb=E.exactCheckSampled(cfg,game).maxGain;
    if(maxGainBb!==gain || game.trainingDeals!==js.trainingDeals) throw Error('Strategy quality or deal count mismatch');
    rows.push({seed,mode,threads,observed:info.devicePath,deals:info.trainingDeals,seconds:info.wallSeconds,endToEndSeconds,
      dealsPerSecond:info.trainingDeals/info.wallSeconds,gpuBufferPeakBytes:info.gpuBufferPeakBytes,maxGainBb});
   }
  }
 }
 fs.writeFileSync(out,JSON.stringify({cpu:os.cpus()[0].model,host:os.platform(),logicalAvailable:os.availableParallelism(),config,rows},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
