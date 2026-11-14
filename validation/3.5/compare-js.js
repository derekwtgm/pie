// node compare-js.js baseline-source candidate-source report.json [--fixed] [--profile]
const fs=require('fs'),cp=require('child_process'),path=require('path'),os=require('os');
const [base,current,out]=process.argv.slice(2),point=path.resolve(__dirname,'../3.4/time-to-target.js');
const rows=[],fixed=process.argv.includes('--fixed'),prof=process.argv.includes('--profile'),cases=[['baseline',base],['candidate',current]];
for(const seed of [1,2,3,4,5])for(const [version,src] of (seed%2?cases:[...cases].reverse())){
 for(const h of [1000,4000,16000,64000]){
  const args=[point,'--point',path.resolve(src),'unused','.','javascript',String(seed),String(h),fixed?'external':'auto'];
  if(prof)args.unshift('--cpu-prof','--cpu-prof-name='+version+'-'+seed+'-'+h+'.cpuprofile');
  const row=JSON.parse(cp.execFileSync(process.execPath,args));rows.push({version,...row});if(row.largestExactGainBB<=0.7)break;
 }
 fs.writeFileSync(out,JSON.stringify({cpu:os.cpus()[0].model,node:process.version,targetBB:0.7,rows},null,1));
}
