// EightMax 3.8: ten-scenario comparison of the 3.7 and 3.8 native engines (copied from validation/3.7/scenarios.js; labels changed only).
// usage: node tools/scenarios34.js <mwcli-3.6> <timed-3.6> <mwcli-3.7> <timed-3.7> <peak_rss> <out.json> [--quick]
// Every scenario uses one identical spec (3.7 JavaScript nativeSpec, default
// linear external-sampling MCCFR) for both engines.
//   equal updates: wall time, deals, state visits, peak process RSS, and whether
//                  the two engines' exported tables are byte-identical;
//   equal time:    2 s per run (tools/timed_training.cpp), deals reached and the
//                  quality of the resulting strategy:
//                  - exact: largest exact unilateral gain (finite enumerable games);
//                  - approximate: tools trained-response probe for seat 0 (paired
//                    holdout estimate of one sampled unilateral deviation, BB or
//                    prize units). Not exploitability and not a Nash certificate.
// VRAM: external sampling runs on the CPU in both versions (gpuBufferPeakBytes 0).
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync,execFileSync}=require('node:child_process');
const E=require('../../source/tools/loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../../source/web/'+l);
const [cli32,timed32,cli33,timed33,rss,out]=process.argv.slice(2),quick=process.argv.includes('--quick');
const r6='22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6';
const scenarios=[
  ['Heads-up turn',{board:'Qs9h4d2c',common:10,stacks:[40,40],ranges:['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd','QcJc,TdTc,As4s,KdJd,6s5s,9d8d'],streets:{turn:{bets:'60',raises:'',maxBets:1},river:{bets:'75,a',raises:'',maxBets:1}}},20000,'exact'],
  ['Heads-up river',{board:'Qs9h4d2c7s',common:10,stacks:[40,40],ranges:['AsQd,KhQh,9s9c,JhTh,8d7d,AhKd,Ts8s,AcAd,5h5d','QcJc,TdTc,As4s,KdJd,6s5s,9d8d,7c7d,AhJh,Kc2s'],streets:{river:{bets:'50,a',raises:'2.5x',maxBets:2}}},20000,'exact'],
  ['Three-player river',{board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}}},20000,'exact'],
  ['Six-player flop',{board:'Td7c2h',dealt:8,common:1.5,stacks:[40,35,30,50,45,26],prior:Array(6).fill(2.5),ranges:Array(6).fill(r6),streets:{flop:{bets:'33,75',raises:'3x',maxBets:2},turn:{bets:'66',raises:'a',maxBets:2},river:{bets:'75,a',raises:'',maxBets:1}},batchDeals:16,actionStreams:'deal'},300,'approximate'],
  ['Eight-player preflop shove/call',{preflop:{mode:'shove'},dealt:8,common:0,board:'',stacks:[10,6,14,3,9,12,7.5,11],ranges:Array(8).fill('random'),batchDeals:16,actionStreams:'deal'},2000,'approximate'],
  ['Eight-player linked preflop to river',{preflop:{mode:'linked',opens:'2,a',raises:'2.75x,a',maxBets:3},board:'',dealt:8,common:0,stacks:[24.9,18,40,12,30,9,55,20],ranges:Array(8).fill('random'),streets:{flop:{bets:'33,75',raises:'3x',maxBets:2},turn:{bets:'66',raises:'a',maxBets:2},river:{bets:'75,a',raises:'',maxBets:1}},batchDeals:16,actionStreams:'deal'},300,'approximate'],
  ['Short-stack multiway all-ins (6-seat flop)',{board:'Td7c2h',dealt:8,common:1.5,stacks:[20,35,8,50,14,3],prior:Array(6).fill(2.5),folded:[1,2.5],ranges:Array(6).fill(r6),streets:{flop:{bets:'33,a',raises:'3x,a',maxBets:3},turn:{bets:'50,g',raises:'a',maxBets:2},river:{bets:'75,150',raises:'a',maxBets:2}},batchDeals:4,actionStreams:'deal'},500,'approximate'],
  ['Tournament bubble ICM (4 left, 3 paid, shove/call)',{preflop:{mode:'shove'},dealt:4,common:0,board:'',stacks:[12,7,20,4],ranges:Array(4).fill('random'),icm:{payouts:[50,30,20]},batchDeals:16,actionStreams:'deal'},3000,'approximate'],
  ['Eight-player final-table ICM (linked preflop)',{preflop:{mode:'linked',opens:'2.2,a',raises:'a',maxBets:2},board:'',dealt:8,common:0,stacks:[30,22,15,40,9,18,25,12],ranges:Array(8).fill('random'),icm:{payouts:[30,20,14,11,9,7,5,4]},streets:{flop:{bets:'50',raises:'',maxBets:1},turn:{bets:'a',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}},batchDeals:16,actionStreams:'deal'},200,'approximate'],
  ['Four-player flop (3 sizes)',{board:'Ks8d5h',dealt:8,common:1.5,stacks:Array(4).fill(60),prior:Array(4).fill(2.5),ranges:Array(4).fill('random'),streets:{flop:{bets:'33,75,a',raises:'3x,a',maxBets:3},turn:{bets:'50,100',raises:'a',maxBets:2},river:{bets:'75,150,a',raises:'a',maxBets:2}},batchDeals:16,actionStreams:'deal'},150,'approximate']];
const seeds=quick?[1,2,3]:[1,2,3],budgetMs=quick?150:2000,threads=Math.min(4,os.cpus().length);
const tq={2:12.706,3:4.303,4:3.182,5:2.776};
const sum=v=>{const m=v.reduce((a,b)=>a+b,0)/v.length,sd=v.length>1?Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length-1)):0;return {median:[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)],max:Math.max(...v),mean:m,ci95:v.length>1?tq[v.length]*sd/Math.sqrt(v.length):null,n:v.length};};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'em33-scen-'));
const body=b=>crypto.createHash('sha256').update(b.subarray(12+b.readUInt32LE(8))).digest('hex');
function quality(kind,cfg,state){
  const g=E.MultiwayGame(cfg);g.importNative(state);
  if(kind==='exact'){const x=E.exactCheckSampled(cfg,g);return {kind:'exact largest unilateral gain',value:x.maxGain,exploitabilityBB:x.gain.length===2?(x.gain[0]+x.gain[1])/2:null};}
  const probe=g.responseProbe(0);probe.iterate(quick?300:3000);const r=probe.finish();
  return {kind:'approximate seat-0 trained-response gain (paired holdout)',value:r.gain,se:r.se};
}
const result={generated:new Date().toISOString(),cpu:os.cpus()[0].model,logicalProcessors:os.cpus().length,threads,budgetMs,node:process.version,scenarios:[]};
try{
  for(const [name,over,targetUpdates,kind] of scenarios){
    if(process.env.EM_SCENARIO && !name.startsWith(process.env.EM_SCENARIO))continue;
    const updates=quick && kind==='approximate'?Math.min(80,targetUpdates):targetUpdates;
    const rows=[];
    for(const seed of seeds){
      const cfg={privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:1024,...over,privateSeed:seed};
      const spec=path.join(dir,'spec.json');fs.writeFileSync(spec,JSON.stringify(E.MultiwayGame(cfg).nativeSpec()));
      if(process.env.EM_SPEC_DIR){fs.mkdirSync(process.env.EM_SPEC_DIR,{recursive:true});fs.copyFileSync(spec,path.join(process.env.EM_SPEC_DIR,seed+'.json'));continue;}
      const row={seed};
      const versions=[['3.7',cli32,timed32],['3.8',cli33,timed33]];
      for(const [v,cli,timed] of seed%2?versions:versions.reverse()){
        const st=path.join(dir,v+'.state'),r=spawnSync(rss,[cli,spec,String(updates),String(threads),st,'2048'],{encoding:'utf8'});
        if(r.status!==0)throw Error(name+' '+v+': '+r.stderr);
        const info=JSON.parse(r.stdout),bytes=fs.readFileSync(st);
        const tst=path.join(dir,v+'.timed'),secs=+execFileSync(timed,[spec,String(budgetMs),String(threads),tst]);const tb=fs.readFileSync(tst);
        const timedHead=JSON.parse(tb.toString("utf8",12,12+tb.readUInt32LE(8)));
        row[v]={equalUpdates:{seconds:info.wallSeconds,deals:info.trainingDeals,stateVisits:info.stateVisits,visitsPerSecond:info.stateVisits/info.wallSeconds,
            peakRssMiB:+/peakRssKiB=(\d+)/.exec(r.stderr)[1]/1024,tableMiB:info.tableMiB,workerThreads:info.threads,devicePath:info.devicePath,gpuBufferPeakBytes:info.gpuBufferPeakBytes,bodySHA256:body(bytes)},
          equalTime:{seconds:secs,deals:timedHead.trainingDeals,quality:quality(kind,cfg,tb)},equalUpdatesQuality:quality(kind,cfg,bytes)};
      }
      row.identicalTablesAtEqualUpdates=row['3.7'].equalUpdates.bodySHA256===row['3.8'].equalUpdates.bodySHA256;
      rows.push(row);process.stderr.write(name+' seed '+seed+' done\n');
    }
    if(process.env.EM_SPEC_DIR)continue;
    const pick=(v,f)=>sum(rows.map(r=>f(r[v])));
    result.scenarios.push({name,config:over,updates,qualityKind:kind,rows,summary:{
      identicalTablesAtEqualUpdates:rows.every(r=>r.identicalTablesAtEqualUpdates),
      seconds:{'3.7':pick('3.7',x=>x.equalUpdates.seconds),'3.8':pick('3.8',x=>x.equalUpdates.seconds)},
      peakRssMiB:{'3.7':pick('3.7',x=>x.equalUpdates.peakRssMiB),'3.8':pick('3.8',x=>x.equalUpdates.peakRssMiB)},
      equalTimeDeals:{'3.7':pick('3.7',x=>x.equalTime.deals),'3.8':pick('3.8',x=>x.equalTime.deals)},
      equalTimeQuality:{'3.7':pick('3.7',x=>x.equalTime.quality.value),'3.8':pick('3.8',x=>x.equalTime.quality.value)},
      equalTimeQualityPairedReduction:sum(rows.map(r=>r['3.7'].equalTime.quality.value-r['3.8'].equalTime.quality.value)),
      equalUpdatesQuality:{'3.7':pick('3.7',x=>x.equalUpdatesQuality.value),'3.8':pick('3.8',x=>x.equalUpdatesQuality.value)}}});
    fs.writeFileSync(out,JSON.stringify(result,null,1));
  }
}finally{fs.rmSync(dir,{recursive:true,force:true});}
