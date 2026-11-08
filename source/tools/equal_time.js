// Compare end-of-training strategy at the same training-time budget.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const E=require('./loadlib'); for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const [old,current,fixture,out]=process.argv.slice(2),{cfg}=JSON.parse(fs.readFileSync(fixture));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'em-time-')),spec=path.join(tmp,'spec'),state=path.join(tmp,'state'),rows=[];
try{
 for(const seed of [1,2,3])for(const label of (seed%2?['2.9 native CPU','3.0 native CPU','3.0 JavaScript']:['3.0 JavaScript','3.0 native CPU','2.9 native CPU'])){
  const config={...cfg,batchDeals:4,privateSeed:seed},g=E.MultiwayGame(config);let seconds;
  if(label.endsWith('JavaScript')){
    const start=performance.now();do{g.iterate(64);}while(performance.now()-start<1000);seconds=(performance.now()-start)/1000;
  }else{
    fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));
    seconds=+execFileSync(label.startsWith('2.9')?old:current,[spec,'1000','1',state]);
    g.importNative(fs.readFileSync(state));
  }
  rows.push({seed,label,seconds,deals:g.trainingDeals,maxGainBb:E.exactCheckSampled(config,g).maxGain});
 }
 fs.writeFileSync(out,JSON.stringify({cpu:os.cpus()[0].model,trainingMilliseconds:1000,rows},null,2));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
