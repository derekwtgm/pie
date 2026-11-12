'use strict';
// EightMax 4.1: send one malformed numeric request per case to a FRESH
// sanitizer-built host (tools/build_sanitized_host.sh) and record whether the
// host reported undefined behaviour (UBSan runtime error / process abort) or
// answered with a 4xx. Used to show which input paths were unsafe in 4.0 and
// that 4.1 refuses all of them before conversion.
// usage: node numeric_ub_probe41.js <sanitized eightmax> <source dir> <report.json>
const {spawn}=require('node:child_process'),os=require('node:os'),fs=require('node:fs'),net=require('node:net'),path=require('node:path');
const [exe,srcArg,report]=process.argv.slice(2),src=require('node:path').resolve(srcArg);
const E=require(path.join(src,'tools/loadlib'));for(const l of ['lib_runouts','lib_wide','lib_river'])require(path.join(src,'web',l));
const spec=JSON.stringify(E.MultiwayGame({privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:128,board:'Ks8d5h2c2s',common:10,stacks:[20,20],ranges:['AhKh,KdQd,8s8h','AsKd,KcJc,5d5c'],streets:{river:{bets:'50,a',raises:'a',maxBets:2}},privateSeed:3}).nativeSpec());
const W=Array.from({length:1326},(_,i)=>i>1250?1:0),cfg={board:[0,9,22,31,36],pot:10,stack:10,ranges:[W,W],sizes:{bet:[['',''],['',''],['','100']],raise:[['',''],['',''],['','']]},maxBets:1};
const cfgText=JSON.stringify(cfg);
const cases=[
 ['jobs/ev memoryMiB','mw',['mw/jobs/ev','{"hands":[0],"memoryMiB":1e300}']],
 ['jobs/ev timeLimitMs','mw',['mw/jobs/ev','{"hands":[0],"timeLimitMs":-1e300}']],
 ['jobs/response-gain memoryMiB','mw',['mw/jobs/response-gain','{"method":"sampled","memoryMiB":1e19}']],
 ['jobs/config workers','mw',['mw/jobs/config','{"workers":1e999}']],
 ['mw/node offset','mw',['mw/node','{"path":[],"offset":1e300}']],
 ['mw/train iterations','mw',['mw/train','{"iterations":1e300}']],
 ['mw/init tableLimitMiB','none',['mw/init',spec.replace(/^\{/,'{"tableLimitMiB":1e300,')]],
 ['equity threads','none',['equity','{"hands":[[0,1],[2,3]],"threads":1e300}']],
 ['equity card','none',['equity','{"hands":[[0,1],[1e300,3]]}']],
 ['build iso','none',['build',cfgText.replace('"maxBets":1','"maxBets":1,"iso":1e300')]],
 ['build ICM utility (float)','none',['build',cfgText.replace('"maxBets":1','"maxBets":1,"icm":{"u0":[0,1e300],"u1":[0,1]}')]],
 ['solve maxIter','legacy',['solve','{"maxIter":1e300}']],
 ['solve power','legacy',['solve','{"maxIter":10,"power":-1e300}']],
 ['node path','legacy',['node','{"path":[1e300]}']],
 ['lock strategy (float)','legacy',['lock','{"path":[],"strategy":[1e300,0]}']],
 ['report flop weight','none',['report',JSON.stringify({cfg:cfgText,flops:[[0,9,22,1]],maxIter:1}).replace('[[0,9,22,1]]','[[0,9,22,1e300]]')]],
];
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
(async()=>{
 const out={host:exe,sanitizers:'undefined,float-cast-overflow (no recover)',cases:[]};
 for(const [name,setup,[route,body]] of cases){
  const port=await freePort(),home=fs.mkdtempSync(path.join(os.tmpdir(),'emub-'));
  const p=spawn(exe,['--no-browser','--port='+port],{env:{...process.env,HOME:home,USERPROFILE:home,EIGHTMAX_GPU:'off',EIGHTMAX_THREADS:'2'},stdio:['ignore','ignore','pipe']});let err='';p.stderr.on('data',d=>err+=d);
  const api=(r,b)=>fetch('http://127.0.0.1:'+port+'/api/'+r,b===undefined?{}:{method:'POST',headers:{'X-EightMax':'1'},body:b});
  for(let i=0;i<200;i++){try{if((await api('info')).ok)break}catch{}await new Promise(r=>setTimeout(r,25))}
  if(setup==='mw'){await api('mw/init',spec);}
  if(setup==='legacy'){await api('build',cfgText);}
  let status=null;try{status=(await api(route,body)).status;}catch(e){status='connection lost'}
  await new Promise(r=>setTimeout(r,200));
  const ub=err.split('\n').find(l=>/runtime error/.test(l));
  out.cases.push({name,route,status,undefinedBehaviour:!!ub,report:ub?ub.replace(/^.*\/native\//,'native/'):null,hostAlive:p.exitCode===null&&p.signalCode===null});
  console.log(name.padEnd(30),String(status).padEnd(16),ub?'UB: '+ub.replace(/^.*\/native\//,''):'no UB');
  p.kill();fs.rmSync(home,{recursive:true,force:true});
 }
 out.totals={cases:out.cases.length,undefinedBehaviour:out.cases.filter(c=>c.undefinedBehaviour).length,refused4xx:out.cases.filter(c=>typeof c.status==='number'&&c.status>=400&&c.status<500).length};
 if(report)fs.writeFileSync(report,JSON.stringify(out,null,1));
 console.log(JSON.stringify(out.totals));
})();
