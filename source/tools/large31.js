// EightMax 3.1 large-game benchmark: JavaScript external sampling (the 3.0 path
// for these studies) against 3.1 native external sampling at equal wall time.
//
// usage: node tools/large31.js <timed-3.1> <out.json> [--quick]
//   timed-3.1  tools/timed_training.cpp built against 3.1 mw.cpp
// Exact best responses are intractable here. Reported measures:
//   - sampled deals per second (the JavaScript and native shared-stream engines
//     run the identical algorithm and produce identical strategies per deal);
//   - seed-to-seed dispersion of the first decision's action frequencies at an
//     equal training time: the mean over actions of the standard deviation across
//     independent seeds. Lower dispersion indicates a more settled strategy. It is
//     a stability diagnostic, not an equilibrium or exploitability bound.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const E=require('./loadlib');for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l);
const [timed,out]=process.argv.slice(2),quick=process.argv.includes('--quick');
const streets={flop:{bets:'33,75',raises:'3x',maxBets:2},turn:{bets:'66',raises:'a',maxBets:2},river:{bets:'75,a',raises:'',maxBets:1}};
const scenarios={
  'six-player flop, unequal stacks':{board:'Td7c2h',dealt:8,common:1.5,stacks:[20,35,18,50,24,26],prior:Array(6).fill(2.5),ranges:Array(6).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+'),streets},
  'eight-player linked preflop to river, 25 bb':{preflop:{mode:'linked',opens:'2.2,a',raises:'2.75x,a',maxBets:3,limps:true},board:'',dealt:8,common:0,stacks:Array(8).fill(25),ranges:Array(8).fill('random'),streets},
  'eight-player final table shove/call ICM':{preflop:{mode:'shove'},dealt:8,common:0,board:'',stacks:[12,9,15,6,11,8,20,14],ranges:Array(8).fill('random'),icm:{payouts:[30,20,14,10,8,7,6,5]}},
  'bubble ICM, five left, four paid, shove/call':{preflop:{mode:'shove'},dealt:5,common:0,board:'',stacks:[18,7,12,25,4],ranges:Array(5).fill('random'),icm:{payouts:[40,30,20,10]}},
  'four-way short-stack flop all-ins':{board:'9h8h3c',dealt:8,common:2.3,stacks:[6,9,4,12],prior:[2,2,2,2],ranges:Array(4).fill('random'),streets:{flop:{bets:'50,a',raises:'a',maxBets:2},turn:{bets:'a',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}}},
  'six-player linked preflop to river with ICM':{preflop:{mode:'linked',opens:'2.2,a',raises:'a',maxBets:2,limps:false},board:'',dealt:6,common:0,stacks:[30,22,15,40,18,25],ranges:Array(6).fill('random'),icm:{payouts:[50,30,20]},streets}
};
const engines=[
  {label:'JavaScript external sampling',js:true,over:{}},
  {label:'3.1 native external sampling, shared stream, 1 thread',over:{},threads:1},
  {label:'3.1 native external sampling, per-deal streams, batch 16, '+Math.min(4,os.cpus().length)+' threads',over:{batchDeals:16,actionStreams:'deal'},threads:Math.min(4,os.cpus().length)}
];
// Each run has its own process. This also makes process high-water marks
// meaningful and frees JS heap and native checkpoint buffers between seeds.
const worker=process.argv.indexOf('--run');
const version=process.env.EM_BENCH_VERSION||'3.1';
const key=(name,e,ms,seed)=>JSON.stringify([name,e,ms,seed]);
if(worker>=0){
  const [name,e,ms,seed]=JSON.parse(process.argv[worker+1]);
  const eng=engines[e],base=scenarios[name];
  const cfg={...base,privateMode:'sampled',abstraction:'exact',traversal:'external',...(eng.js?{}:{engine:'native',strategyBudgetMiB:2048}),evaluationDeals:1024,evaluationSeed:424242,privateSeed:seed,...eng.over};
  const g=E.MultiwayGame(cfg),dir=fs.mkdtempSync(path.join(os.tmpdir(),'em-large-'));
  try {
    let seconds,childPeakKiB=null, visits, root;
    if(eng.js){
      const t=performance.now();
      do { g.iterate(16); } while(performance.now()-t<ms && !g.limitReached);
      seconds=(performance.now()-t)/1000;
    } else {
      const spec=path.join(dir,'spec'),state=path.join(dir,'state');
      fs.writeFileSync(spec,JSON.stringify(g.nativeSpec()));
      const args=[spec,String(ms),String(eng.threads),state];
      if(process.platform==='linux'){
        const measure='import subprocess,resource,sys,json; s=subprocess.check_output(sys.argv[1:]);print(json.dumps([float(s),resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss]))';
        [seconds,childPeakKiB]=JSON.parse(execFileSync('python3',['-c',measure,timed,...args]));
      } else seconds=+execFileSync(timed,args);
      g.importNative(fs.readFileSync(state));
    }
    const diagnostic=g.diagnostics();visits=diagnostic.stateVisits;
    root=g.rootFrequencies();
    const seat=(seed-1)%cfg.stacks.length;
    const probe=g.responseProbe(seat);probe.iterate(256);
    const tested=probe.finish();
    const response={...tested,ci95:[tested.gain-1.96*tested.se,tested.gain+1.96*tested.se],
      units:cfg.icm?'prize units':'BB',interpretation:'one trained unilateral deviation; paired holdout Monte Carlo interval conditional on fitted policies'};

    process.stdout.write(JSON.stringify({scenario:name,config:cfg,response,measuredTimeFraction:seconds/(ms/1000),engine:eng.label.replace('3.1',version),engineIndex:e,budgetMs:ms,seed,seconds,deals:g.trainingDeals,stateVisits:visits,dealsPerSecond:g.trainingDeals/seconds,strategyMiB:g.strategyMiB,trainerPeakRSSKiB:eng.js?process.resourceUsage().maxRSS:childPeakKiB,peakVRAMBytes:0,root:root.map(a=>a.frequency),rootActions:root.map(a=>a.label)}));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
} else {
  const names=Object.keys(scenarios),seeds=quick?[1,2,3]:[1,2,3,4,5],budgets=quick?[1000]:[2000,8000];
  const metadata={concurrentRuns:Number(process.env.EM_BENCH_JOBS||1),version,cpu:os.cpus()[0].model,platform:os.platform(),arch:os.arch(),node:process.version,driverHash:require('crypto').createHash('sha256').update(fs.readFileSync(timed)).digest('hex'),quick};
  const saved=fs.existsSync(out)?JSON.parse(fs.readFileSync(out)):null;
  if(saved&&JSON.stringify(metadata)!==JSON.stringify(saved.metadata))throw Error('Benchmark metadata mismatch');
  const rows=saved?.rows||[],seen=new Set(rows.map(r=>key(r.scenario,r.engineIndex,r.budgetMs,r.seed)));
  if(seen.size!==rows.length)throw Error('Duplicate benchmark runs');
  function save(){fs.writeFileSync(out+'.tmp',JSON.stringify({metadata,rows},null,1));fs.renameSync(out+'.tmp',out);}
  const queue=[];
  for(const name of names)for(let e=0;e<engines.length;e++)for(const ms of budgets)for(const seed of seeds){
    const id=key(name,e,ms,seed);if(seen.has(id))continue;
    queue.push(id);
  }
  async function runner(){while(queue.length){const id=queue.shift();
    const stdout=await new Promise((resolve,reject)=>require('child_process').execFile(process.execPath,[__filename,timed,out,'--run',id],{timeout:300000},(err,result)=>err?reject(err):resolve(result)));
    const row=JSON.parse(stdout);
    rows.push(row);seen.add(id);save();
    console.error(rows.length,id);
  }}
  Promise.all(Array.from({length:Number(process.env.EM_BENCH_JOBS||1)},runner)).then(()=>{
  let report='# Large-game benchmark '+version+'\n\nEach run includes one independently trained unilateral response for the seat identified in its JSON record. The interval covers holdout sampling uncertainty. Root frequency dispersion is the mean across actions of the sample standard deviation across seeds. It measures stability. Elapsed time is training only. RSS is a process high-water mark.\n\n| Scenario | Engine | Target ms | Seeds | Mean deals/s | Root dispersion |\n|---|---|---:|---:|---:|---:|\n';
  for(const name of names)for(let e=0;e<engines.length;e++)for(const ms of budgets){
    const r=rows.filter(x=>x.scenario===name&&x.engineIndex===e&&x.budgetMs===ms);
    const mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
    const disp=mean(r[0].root.map((_,i)=>{const v=r.map(x=>x.root[i]),m=mean(v);return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/(v.length-1));}));
    report+='| '+[name,r[0].engine,ms,r.length,mean(r.map(x=>x.dealsPerSecond)).toFixed(1),disp.toFixed(5)].join(' | ')+' |\n';
  }
  fs.writeFileSync(out+'.md',report);
  }).catch(err=>{console.error(err);process.exitCode=1;});
}
