// Compare the two release entry points on the same finite grouped-hand river.
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {execFileSync} = require('node:child_process');
const [baseline, timed, output, mode, seed] = process.argv.slice(2);
if (mode) {
  const source = mode === 'js31' ? path.resolve(baseline) : path.resolve(__dirname, '..');
  const E = require(path.join(source, 'tools/loadlib'));
  for (const lib of ['lib_runouts','lib_wide','lib_river']) require(path.join(source,'web',lib));
  const cfg = {board:'Ks8d5h2c2s', common:12, stacks:[30,30], ranges:['QQ+,AKs:0.7','JJ+,AQs:0.8'],
    streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}}, privateMode:'sampled', abstraction:'compact',
    traversal:'external', batchDeals:4, actionStreams:'deal', evaluationDeals:128, privateSeed:Number(seed)};
  const game = E.MultiwayGame(cfg);
  let seconds;
  if (mode === 'js31') {
    const start = performance.now();
    do { game.iterate(32); } while (performance.now()-start < 400);
    seconds = (performance.now()-start)/1000;
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'group-gain-'));
    try {
      const spec = path.join(dir,'spec'), state = path.join(dir,'state');
      fs.writeFileSync(spec, JSON.stringify(game.nativeSpec()));
      seconds = Number(execFileSync(timed,[spec,'400','2',state]));
      game.importNative(fs.readFileSync(state));
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  }
  const check = E.exactCheckSampled(cfg,game);
  if (!check.available || !Number.isFinite(check.maxGain)) throw Error(check.reason);
  console.log(JSON.stringify({mode,seed:Number(seed),cfg,seconds,deals:game.trainingDeals,maxGainBb:check.maxGain}));
} else {
  const rows = [], differences = [];
  for(let s=1;s<=5;s++) {
    for(const m of s%2 ? ['js31','native32'] : ['native32','js31']) {
      rows.push(JSON.parse(execFileSync(process.execPath,[__filename,baseline,timed,output,m,String(s)])));
    }
    const gain = m=>rows.find(r=>r.seed===s&&r.mode===m).maxGainBb;
    differences.push(gain('js31')-gain('native32'));
  }
  const mean = differences.reduce((a,b)=>a+b)/5;
  const half = 2.776*Math.sqrt(differences.reduce((a,b)=>a+(b-mean)**2,0)/20);
  fs.writeFileSync(output,JSON.stringify({cpu:os.cpus()[0].model,trainingBudgetMs:400,rows,differences,
    meanGainReductionBb:mean,paired95CI:[mean-half,mean+half]},null,2));
}
