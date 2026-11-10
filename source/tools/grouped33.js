// EightMax 3.3: JavaScript against native Compact/Detailed hand groups on the
// configurations that 3.2 trained in JavaScript only (flop and preflop starts).
// usage: node tools/grouped33.js <mwcli> <peak_rss> <out.json> [--quick]
// For each configuration and seed both engines train the same number of updates;
// the test asserts identical tables (every row, bit for bit), then reports wall
// time, deals per second, state visits per second and peak RSS of each process.
// Identical tables at every iteration mean identical response gain at equal
// updates, so the time to reach any accuracy target scales with seconds/update.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const [cli,rss,out]=process.argv.slice(2),quick=process.argv.includes('--quick');
const lib=path.join(__dirname,'loadlib');
const flop3={board:'Ks8d5h',common:12,stacks:[12,20,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d,22+,A2s+','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc:0.5,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
  streets:{flop:{bets:'33,a',raises:'3x',maxBets:2},turn:{bets:'75,g',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}},privateMode:'sampled',traversal:'external',evaluationDeals:128};
const six={board:'Td7c2h',dealt:8,common:1.5,stacks:[20,35,8,50,14,26],prior:[2.5,2.5,2.5,2.5,2.5,2.5],folded:[1,2.5],ranges:Array(6).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6'),
  privateMode:'sampled',traversal:'external',evaluationDeals:128,streets:{flop:{bets:'33',raises:'',maxBets:1},turn:{bets:'50',raises:'',maxBets:1},river:{bets:'75',raises:'',maxBets:1}},batchDeals:4,actionStreams:'deal'};
const pf8={preflop:{mode:'linked',opens:'2',raises:'3x,a',maxBets:3},board:'',dealt:8,common:0,stacks:Array(8).fill(25),ranges:Array(8).fill('random'),privateMode:'sampled',evaluationDeals:128,
  bets:'50',raises:'',maxBets:1,traversal:'external',batchDeals:2,actionStreams:'deal'};
const configs=[['Compact 3-seat flop',{...flop3,abstraction:'compact'},quick?300:3000,1],['Detailed 3-seat flop',{...flop3,abstraction:'detailed'},quick?300:3000,1],
  ['Detailed 6-seat flop (4 deals/update)',{...six,abstraction:'detailed'},quick?40:400,1],['Detailed 6-seat flop (4 deals/update, 4 threads)',{...six,abstraction:'detailed'},quick?40:400,4],
  ['Compact 8-seat linked preflop (2 deals/update)',{...pf8,abstraction:'compact'},quick?20:200,1]];
const seeds=quick?[1]:[1,2,3];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'em33-grouped-'));
// The JavaScript side runs in its own process so its peak RSS is measured separately.
const jsWorker=`const fs=require('fs'),E=require(${JSON.stringify(lib)});for(const l of ['lib_runouts','lib_wide','lib_river'])require(${JSON.stringify(path.join(__dirname,'../web/'))}+l);
const [cfgFile,its,outFile]=process.argv.slice(2);const cfg=JSON.parse(fs.readFileSync(cfgFile));const g=E.MultiwayGame(cfg);
const t=process.hrtime.bigint();g.iterate(+its);const s=Number(process.hrtime.bigint()-t)/1e9;fs.writeFileSync(outFile,g.exportNative());
console.log(JSON.stringify({seconds:s,deals:g.trainingDeals,visits:g.metrics().stateVisits,peakRssKiB:process.resourceUsage().maxRSS}));`;
fs.writeFileSync(path.join(dir,'js.js'),jsWorker);
function rowsOf(u8){
  const hl=u8.readUInt32LE(8),head=JSON.parse(u8.subarray(12,12+hl).toString());let p=12+hl;const sc=u8.readUInt32LE(p);p+=4;
  const paths=[];for(let i=0;i<sc;i++){const par=u8.readUInt32LE(p),slot=u8[p+4];paths.push(i?paths[par]+(slot===7?'c':slot):'r');p+=9;}
  const c=u8.readUInt32LE(p);p+=4;const m=new Map(),extra=head.rowSync?4:0;
  for(let i=0;i<c;i++){const st=u8.readUInt32LE(p),l=u8.readUInt16LE(p+4),id=u8.subarray(p+6,p+6+l).toString(),k=u8[p+6+l],at=p+7+l;
    m.set(paths[st]+'|'+id,u8.subarray(at,at+16*k+extra).toString('hex'));p=at+16*k+extra;}
  return m;
}
const result={generated:new Date().toISOString(),cpu:os.cpus()[0].model,threads:os.cpus().length,node:process.version,configs:[]};
try{
  for(const [name,cfg,its,threads] of configs){
    const runs=[];
    for(const seed of seeds){
      const c={...cfg,privateSeed:seed},cfgFile=path.join(dir,'cfg.json');fs.writeFileSync(cfgFile,JSON.stringify(c));
      const E=require(lib);for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
      const spec=path.join(dir,'spec.json');fs.writeFileSync(spec,JSON.stringify(E.MultiwayGame(c).nativeSpec()));
      const js=spawnSync(process.execPath,[path.join(dir,'js.js'),cfgFile,String(its),path.join(dir,'js.state')],{encoding:'utf8'});
      if(js.status)throw Error(js.stderr);const j=JSON.parse(js.stdout);
      const nat=spawnSync(rss,[cli,spec,String(its),String(threads),path.join(dir,'n.state'),'2048'],{encoding:'utf8'});
      if(nat.status)throw Error(nat.stderr);const n=JSON.parse(nat.stdout),peak=+/peakRssKiB=(\d+)/.exec(nat.stderr)[1];
      const a=rowsOf(fs.readFileSync(path.join(dir,'js.state'))),b=rowsOf(fs.readFileSync(path.join(dir,'n.state')));
      let same=a.size===b.size;for(const [k,v] of a)if(b.get(k)!==v){same=false;break;}
      if(!same)throw Error(name+': native and JavaScript tables differ');
      runs.push({seed,updates:its,deals:n.trainingDeals,rows:a.size,identicalTables:same,
        js:{seconds:j.seconds,dealsPerSecond:j.deals/j.seconds,visitsPerSecond:j.visits/j.seconds,peakRssMiB:j.peakRssKiB/1024},
        native:{seconds:n.wallSeconds,threads:n.threads,dealsPerSecond:n.trainingDeals/n.wallSeconds,visitsPerSecond:n.stateVisits/n.wallSeconds,peakRssMiB:peak/1024,tableMiB:n.tableMiB,groupKeys:n.handGroups.keys}});
      process.stderr.write(name+' seed '+seed+': JS '+j.seconds.toFixed(2)+' s, native '+n.wallSeconds.toFixed(2)+' s\n');
    }
    const mean=f=>runs.reduce((s,r)=>s+f(r),0)/runs.length;
    result.configs.push({name,config:cfg,runs,summary:{identicalTables:runs.every(r=>r.identicalTables),speedup:mean(r=>r.js.seconds)/mean(r=>r.native.seconds),
      jsDealsPerSecond:mean(r=>r.js.dealsPerSecond),nativeDealsPerSecond:mean(r=>r.native.dealsPerSecond),jsPeakRssMiB:Math.max(...runs.map(r=>r.js.peakRssMiB)),nativePeakRssMiB:Math.max(...runs.map(r=>r.native.peakRssMiB)),
      timeToTargetRatio:mean(r=>r.native.seconds)/mean(r=>r.js.seconds)}});
  }
  fs.writeFileSync(out,JSON.stringify(result,null,1));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
