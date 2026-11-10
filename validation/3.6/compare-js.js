// Compare the worker's JavaScript algorithm with the native CPU on the same samples.
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const E=require('../../source/tools/loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../../source/web/'+l);
const [cli,out,id,seed]=process.argv.slice(2),sc=require('./scenarios.json').scenarios;
if(id===undefined){
 const rows=[];for(let i=0;i<sc.length;i++)for(const seed of [3,17,67]){rows.push(JSON.parse(cp.execFileSync(process.execPath,[__filename,cli,out,String(i),String(seed)])));fs.writeFileSync(out,JSON.stringify({rows},null,1));}
}else{
 const row=sc[+id],cfg={privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:1024,...row.config,privateSeed:+seed};
 const updates=Math.min(row.updates,row.qualityKind==='exact'?800:24),g=E.MultiwayGame(cfg),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'em36ref-'));
 try{const spec=path.join(tmp,'s'),state=path.join(tmp,'b');fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));
  const t=performance.now();g.iterate(updates);const jsSeconds=(performance.now()-t)/1000,jsPeakMiB=process.resourceUsage().maxRSS/1024;
  const info=JSON.parse(cp.execFileSync(cli,[spec,String(updates),'4',state,'2048'])),copy=E.MultiwayGame(cfg);copy.importNative(fs.readFileSync(state));
  function gain(x){if(row.qualityKind==='exact')return E.exactCheckSampled(cfg,x).maxGain;const p=x.responseProbe(0);p.iterate(300);return p.finish().gain;}
  const jsGain=gain(g),nativeGain=gain(copy),ev=g.metrics(128).ev,nativeEv=copy.metrics(128).ev;
  const diff=Math.max(Math.abs(jsGain-nativeGain),...ev.map((v,i)=>Math.abs(v-nativeEv[i])));
  if(diff>1e-10||g.trainingDeals!==info.trainingDeals)throw Error('Parity loss in '+row.name);
  console.log(JSON.stringify({name:row.name,seed:+seed,updates,deals:g.trainingDeals,jsSeconds,nativeSeconds:info.wallSeconds,jsPeakMiB,nativePeakMiB:info.processPeakRssMiB,jsGain,nativeGain,maxDifference:diff}));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
