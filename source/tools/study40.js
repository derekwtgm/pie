// EightMax 4.0 test-study builder: node study40.js <sourceDir> <name> <iterations> <threads> <outDir> [mwcli]
const path=require('path'),fs=require('fs'),cp=require('child_process');
const [src,name,iters,threads,out,cli,seed]=process.argv.slice(2);
const E=require(path.join(src,'tools/loadlib'));
for (const l of ['lib_runouts','lib_wide','lib_river','lib_pushfold','lib_explorer']) require(path.join(src,'web/'+l));
const base={privateMode:'sampled',abstraction:'exact',traversal:'external',evaluationDeals:128};
const R3=['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd','Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'];
const studies={
 huRiver:{...base,board:'Ks8d5h2c2s',common:10,stacks:[20,20],ranges:R3.slice(0,2),streets:{river:{bets:'50,a',raises:'a',maxBets:2}},privateSeed:3},
 threeSide:{...base,board:'Ks8d5h2c2s',common:6,stacks:[4,12,30],ranges:R3,streets:{river:{bets:'75,a',raises:'a',maxBets:2}},privateSeed:5},
 threeIcm:{...base,board:'Ks8d5h2c2s',common:6,stacks:[4,12,30],ranges:R3,icm:{payouts:[50,30,20],others:[10]},streets:{river:{bets:'75,a',raises:'a',maxBets:2}},privateSeed:5},
 huTurn:{...base,board:'Ks8d5h2c',common:8,stacks:[12,12],ranges:['AhKh,KdQd,8s8h,JsTs','AsKd,5d5c,8h7h,JdTd'],streets:{turn:{bets:'a',raises:'',maxBets:1},river:{bets:'50',raises:'',maxBets:1}},privateSeed:7},
 bubble:{...base,preflop:{mode:'shove'},dealt:4,common:0,board:'',stacks:[12,7,20,4],ranges:Array(4).fill('random'),icm:{payouts:[50,30,20]},batchDeals:4,actionStreams:'deal',privateSeed:8},
 icmFinal:{...base,preflop:{mode:'linked',opens:'2.2,a',raises:'a',maxBets:2},board:'',dealt:8,common:0,stacks:[30,22,15,40,9,18,25,12],ranges:Array(8).fill('random'),icm:{payouts:[30,20,14,11,9,7,5,4]},streets:{flop:{bets:'50',raises:'',maxBets:1},turn:{bets:'a',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}},batchDeals:4,actionStreams:'deal',privateSeed:4},
 push8:{...base,preflop:{mode:'shove'},board:'',dealt:8,common:0,stacks:[30,22,15,40,9,18,25,12],ranges:['AsAh','KsKh','QsQh','JsJh','TsTh','9s9h','8s8h','7s7h'],icm:{payouts:[30,20,14,11,9,7,5,4]},batchDeals:4,actionStreams:'deal',privateSeed:4},
 push8chip:{...base,preflop:{mode:'shove'},board:'',dealt:8,common:0,stacks:[30,22,15,40,9,18,25,12],ranges:['AsAh','KsKh','QsQh','JsJh','TsTh','9s9h','8s8h','7s7h'],batchDeals:4,actionStreams:'deal',privateSeed:4},
 linked8fixed:{...base,preflop:{mode:'linked',opens:'2.2,a',raises:'a',maxBets:2},board:'',dealt:8,common:0,stacks:[30,22,15,40,9,18,25,12],ranges:['AsAh','KsKh','QsQh','JsJh','TsTh','9s9h','8s8h','7s7h'],icm:{payouts:[30,20,14,11,9,7,5,4]},streets:{flop:{bets:'50',raises:'',maxBets:1},turn:{bets:'a',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}},batchDeals:4,actionStreams:'deal',privateSeed:4},
 six:{...base,board:'Ks8d5h',common:9,stacks:[30,30,30,30,30,30],ranges:['AhKh,8s8h','AsKd,5d5c','QsQc,7d7c','JsTs,Td9d','AcQc,6c6d','KcJc,9c9d'],streets:{flop:{bets:'a',raises:'',maxBets:1},turn:{bets:'a',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}},privateSeed:6},
 four:{...base,board:'Ks8d5h',common:8,stacks:[20,20,20,20],ranges:['AhKh,KdQd,8s8h,JsTs','AsKd,5d5c,8h7h,JdTd','Kc9c,QsQc,7d7c,Ah5s','AdQd,Td9d,JhJc,6c6d'],streets:{flop:{bets:'a',raises:'',maxBets:1},turn:{bets:'a',raises:'',maxBets:1},river:{bets:'a',raises:'',maxBets:1}},privateSeed:6},
};
if(!studies[name])throw Error('unknown '+name);
fs.mkdirSync(out,{recursive:true});
const spec=path.join(out,'spec.json'),state=path.join(out,'state');
fs.writeFileSync(spec,JSON.stringify(E.MultiwayGame({...studies[name],...(seed?{privateSeed:+seed}:{})}).nativeSpec()));
const r=cp.execFileSync(cli||path.join(src,'build/linux/mwcli'),[spec,iters,threads,state,512],{encoding:'utf8'});
console.log(r.slice(0,200));
