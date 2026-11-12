// Matched native CPU runs. Compare independent seeds on one finite river game.
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), {execFileSync}=require('node:child_process');
const [cli,out,label]=process.argv.slice(2);
const E=require('./loadlib'); for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const cfg = { board: 'Ks8d5h2c2s', common: 12, stacks: [30, 30, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
  streets: { river: { bets: '50,125', raises: '2.5x', maxBets: 2 } }, privateMode: 'sampled', abstraction: 'exact', traversal: 'full', evaluationDeals: 128 };

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'em30-bench-')), rows=[];
try {
 for(const seed of [1,2,3]){
  const config={...cfg,batchDeals:4,privateSeed:seed,riverStrata:process.argv.includes("--stratified")}, spec=path.join(dir,'spec'),state=path.join(dir,'state');
  fs.writeFileSync(spec,JSON.stringify(E.MultiwayGame(config).nativeSpec()));
  let previous=0,seconds=0;
  for(const deals of [4000,20000,50000,100000,250000]){
   const args=[spec,String((deals-previous)/4),'1',state,'256',...(previous?[state]:[])];
   const info=JSON.parse(execFileSync(cli,args));seconds+=info.wallSeconds;
   const game=E.MultiwayGame(config);game.importNative(fs.readFileSync(state));
   const metric=E.exactCheckSampled(config,game);
   rows.push({deals,seed,seconds,maxGainBb:metric.maxGain,dealsPerSecond:deals/seconds});
   previous=deals;
  }
 }
 const summary=[...new Set(rows.map(r=>r.deals))].map(deals=>{
  const g=rows.filter(r=>r.deals===deals), mean=g.reduce((s,r)=>s+r.maxGainBb,0)/g.length;
  return {deals,meanGainBb:mean,ci95HalfWidth:4.303*Math.sqrt(g.reduce((s,r)=>s+(r.maxGainBb-mean)**2,0)/6),meanSeconds:g.reduce((s,r)=>s+r.seconds,0)/3};
 });
 fs.writeFileSync(out,JSON.stringify({label,cpu:os.cpus()[0].model,stratified:process.argv.includes("--stratified"),cfg,summary,rows},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
