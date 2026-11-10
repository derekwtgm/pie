// Produce a real small external-sampling study. The stress generator can
// subsequently enumerate legal river rows to reach a precise file size.
const fs=require('node:fs'),path=require('node:path');
const EM=require('./loadlib');for(const l of ['lib_runouts','lib_wide','lib_river','lib_archive'])require('../web/'+l);
const dir=process.argv[2];fs.mkdirSync(dir,{recursive:true});
const cfg={preflop:{mode:'linked',opens:'2,a',raises:'',maxBets:1},board:'',dealt:8,common:0,
  stacks:[24,18,40,12,30,9,55,20],ranges:Array(8).fill('random'),streets:{flop:{bets:'50',raises:'',maxBets:1},turn:{bets:'50',raises:'',maxBets:1},river:{bets:'20,40,70,125,a',raises:'',maxBets:1}},
  engine:'native',privateMode:'sampled',abstraction:'exact',traversal:'external',batchDeals:1,actionStreams:'deal',strategyBudgetMiB:512,evaluationDeals:128};
const g=EM.MultiwayGame(cfg);fs.writeFileSync(path.join(dir,'spec.json'),JSON.stringify(g.nativeSpec()));g.iterate(128);
g.importNative(g.exportNative());
const state=g.archiveState(['UTG','UTG+1','MP','HJ','CO','BTN','SB','BB']);
fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify(state.meta));fs.writeFileSync(path.join(dir,'small.state'),state.bytes);
(async()=>{const a=await EM.archiveBlob(state);fs.writeFileSync(path.join(dir,'small.emstudy'),Buffer.from(await a.blob.arrayBuffer()));})().catch(e=>{console.error(e);process.exitCode=1;});
