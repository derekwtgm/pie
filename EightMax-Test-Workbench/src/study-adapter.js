/* Adapter to the unmodified EightMax 5.1 reference modules shipped by the user. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./convergence.js'));else root.WorkbenchStudy=factory(root.WorkbenchConvergence);})(typeof globalThis!=='undefined'?globalThis:this,function(C){
'use strict';
const ENGINE={version:'5.1',build:'7d08acc7eb4577ee'},MAX_ITERATIONS=10000000,MAX_TIME_MS=600000;
const check=(v,m)=>{if(!v)throw Error(m);};
function canonical(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';}
function input(request){
 check(request&&request.config&&typeof request.config==='object','Study configuration is missing');
 const cfg=JSON.parse(JSON.stringify(request.config));check(JSON.stringify(cfg).length<=100000,'Study configuration is too large');
 check(Array.isArray(cfg.stacks)&&cfg.stacks.length>=2&&cfg.stacks.length<=8,'Use 2 to 8 study seats');
 check(cfg.stacks.every(s=>typeof s==='number'&&Number.isFinite(s)&&s>=2&&s<=250),'Study stacks must be 2 to 250 BB');
 check(Array.isArray(cfg.ranges)&&cfg.ranges.length===cfg.stacks.length&&cfg.ranges.every(r=>typeof r==='string'&&r.trim().length>0&&r.length<=2000),'Enter a text range for each seat');
 check(cfg.preflop||cfg.stacks.length<=6,'Postflop workbench studies support up to six seats');
 check(typeof cfg.board==='string'&&cfg.board.length<=30,'Enter the board as text');
 check(typeof cfg.common==='number'&&Number.isFinite(cfg.common)&&cfg.common>=0,'Enter a nonnegative common pot');
 const compactBoard=cfg.board.replace(/[\s,]/g,'');
 check(cfg.preflop?compactBoard.length===0:compactBoard.length>=6&&compactBoard.length<=10,'Board length does not match the study format');
 check(compactBoard.length%2===0&&/^(?:[2-9TJQKA][cdhs])*$/i.test(compactBoard),'Invalid board cards');
 const boardCards=(compactBoard.match(/../g)||[]).map(c=>'23456789TJQKA'.indexOf(c[0].toUpperCase())*4+'cdhs'.indexOf(c[1].toLowerCase()));
 check(new Set(boardCards).size===boardCards.length,'Duplicate board cards');
 check(!cfg.batchSchedule&&!cfg.ownHandEnumeration&&!cfg.chanceSampling&&!cfg.opponentExploration,'Experimental native-only settings are not supported by this adapter');
 check(!cfg.lead||cfg.lead.every(x=>x===true),'Restricted opening permissions are not supported');
 check(request.strategyBudgetMiB===undefined||(Number.isInteger(request.strategyBudgetMiB)&&request.strategyBudgetMiB>=8&&request.strategyBudgetMiB<=1024),'Strategy memory budget must be 8 to 1024 MiB');
 // Consistent portable trainer; native jobs use the same study spec and source identity.
 Object.assign(cfg,{privateMode:'sampled',abstraction:'exact',traversal:'external',engine:'javascript',strategyBudgetMiB:request.strategyBudgetMiB===undefined?32:request.strategyBudgetMiB,batchDeals:1,weighting:'linear',regretMatching:'standard',actionStreams:'shared',evaluationDeals:128});
 const iterations=request.iterations===undefined?1000:request.iterations,timeMs=request.timeMs===undefined?3000:request.timeMs;
 check(Number.isInteger(iterations)&&iterations>=1&&iterations<=MAX_ITERATIONS,'Use 1 to 10,000,000 updates');check(Number.isInteger(timeMs)&&timeMs>=100&&timeMs<=MAX_TIME_MS,'Use a 100 to 600,000 ms (10 minute) study budget');
 return {config:cfg,iterations,timeMs};
}
function prepare(EM,request){
 const options=input(request),game=EM.MultiwayGame(options.config),spec=game.nativeSpec();check(spec.protocol===4&&spec.algorithm==='external','Expected protocol-4 external sampling');check(!game.nativeSupport(),'Unsupported study: '+game.nativeSupport());
 return {options,game,spec};
}
function result(EM,prepared,elapsedMs){
 const {game,spec,options}=prepared,labels=game.rootFrequencies().map(a=>a.label),actor=0;
 const rows=spec.hands[actor].map(([id,a,b,weight])=>{const v=game.averageAt('r',spec.board,actor,{id,a,b,w:weight});return {cards:[a,b],weight,average:v?Array.from(v):null,stored:v!==null};});
 return {format:'eightmax-workbench-study-result',version:1,engine:{...ENGINE,backend:'javascript-reference-cpu'},config:options.config,requestedUpdates:options.iterations,updates:game.iterations,trainingDeals:game.trainingDeals,elapsedMs,stopped:game.limitReached?'strategy-budget':game.iterations<options.iterations?'time-budget':'updates-complete',diagnostics:game.diagnostics(),actor,actions:labels.map((label,slot)=>({slot,label})),hands:rows,quality:{convergenceVerified:false,evAvailable:false,description:'Stored root average strategies from sampled training in the configured abstraction. No full-game equilibrium or EV guarantee.'}};
}
function runSync(EM,request,clock=()=>performance.now()){
 const begin=clock(),p=prepare(EM,request);while(p.game.iterations<p.options.iterations&&!p.game.limitReached&&clock()-begin<p.options.timeMs)p.game.iterate(1);return result(EM,p,clock()-begin);
}
function nativeJob(prepared,id){const {options,spec}=prepared;return {format:'eightmax-workbench-native-job',version:1,id,engine:ENGINE,config:options.config,iterations:options.iterations,threads:2,memoryMiB:256,timeoutSeconds:60,spec:{...spec,device:'cpu',gpuMiB:128},query:{path:[],board:[],offset:0,limit:1326}};}
function normalizeNative(job,query,training,elapsedMs){
 check(job&&job.engine&&job.engine.build===ENGINE.build,'Native result build mismatch');check(query&&query.study&&query.node&&Array.isArray(query.actions)&&query.hands&&query.hands.actingSeat,'Native query has no acting-seat range');
 const requested=training&&training.requestedTotalUpdates!==undefined?training.requestedTotalUpdates:job.iterations;check(Number.isInteger(requested)&&requested>=1&&requested<=MAX_ITERATIONS,'Invalid native cumulative update target');
 return {format:'eightmax-workbench-study-result',version:1,engine:{...ENGINE,backend:'native-cli-cpu'},config:input({config:job.config}).config,requestedUpdates:requested,updates:query.study.updates,trainingDeals:query.study.sampledDeals,elapsedMs,stopped:training&&training.limitReached?'strategy-budget':query.study.updates<requested?'time-budget':'updates-complete',actor:query.node.actor,actions:query.actions.map(a=>({slot:a.slot,label:a.name+(a.to?' '+a.to+' BB':'')})),hands:query.hands.items.map(h=>({cards:h.cards,weight:h.weight,average:h.average||null,stored:!!h.row&&!!h.average})),quality:{convergenceVerified:false,evAvailable:false,description:'Native root average strategy; no action EV or equilibrium bound computed.'}};
}
function validateResult(value){
 let r=value;if(r&&r.format==='eightmax-workbench-native-result'){check(r.version===1&&r.build===ENGINE.build,'Native result build mismatch');r=normalizeNative(r.job,r.query,r.training,r.elapsedMs);}
 check(r&&r.cpuCheckpoint===undefined&&r.cpuCheckpointError===undefined,'CPU training state belongs in a separate checkpoint file');
 check(r&&r.format==='eightmax-workbench-study-result'&&r.version===1&&r.engine&&r.engine.build===ENGINE.build,'Unsupported study result');
 check(['javascript-reference-cpu','native-cli-cpu'].includes(r.engine.backend),'Unknown engine backend');input({config:r.config});
 check(Array.isArray(r.actions)&&r.actions.length>=1&&r.actions.length<=7,'Invalid study actions');r.actions.forEach((a,i)=>check(a.slot===i&&typeof a.label==='string'&&a.label.length<=100,'Invalid action label'));
 check(Number.isInteger(r.updates)&&r.updates>=0&&r.updates<=MAX_ITERATIONS,'Invalid update count');check(Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0,'Invalid study timing');check(Number.isInteger(r.actor)&&r.actor===0,'Expected a root study at seat 1');
 check(Array.isArray(r.hands)&&r.hands.length>0&&r.hands.length<=1326,'Invalid result range');const seen=new Set();
 r.hands.forEach(h=>{check(Array.isArray(h.cards)&&h.cards.length===2&&h.cards.every(c=>Number.isInteger(c)&&c>=0&&c<52)&&h.cards[0]!==h.cards[1],'Invalid result cards');const key=h.cards.slice().sort((a,b)=>a-b).join(',');check(!seen.has(key),'Duplicate result hand');seen.add(key);check(typeof h.weight==='number'&&Number.isFinite(h.weight)&&h.weight>0&&h.weight<=1&&typeof h.stored==='boolean','Invalid result weight');
  if(h.average!==null){check(h.stored,'A returned strategy must have a policy row');check(Array.isArray(h.average)&&h.average.length===r.actions.length&&h.average.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(h.average.reduce((a,b)=>a+b,0)-1)<1e-6,'Invalid strategy probabilities');}else check(!h.stored,'Stored strategy cannot be missing');});
 if(r.cpuContinuation){const c=r.cpuContinuation;check(r.engine.backend==='javascript-reference-cpu'&&c.version===1&&['fresh','resume','inspect'].includes(c.operation)&&Number.isSafeInteger(c.fromUpdates)&&c.fromUpdates>=0&&c.fromUpdates<=r.updates&&Number.isSafeInteger(c.addedUpdates)&&c.addedUpdates===r.updates-c.fromUpdates,'Invalid CPU continuation counters');check(c.operation!=='fresh'||c.fromUpdates===0,'Fresh CPU report cannot claim earlier training');check(c.operation!=='inspect'||c.addedUpdates===0,'Checkpoint inspection cannot claim new training');}
 check(r.quality&&r.quality.convergenceVerified===false&&r.quality.evAvailable===false,'Unsupported result quality claim');if(r.convergence!==undefined){check(C,'Convergence module missing');C.validateSummary(r.convergence);check(r.engine.backend==='native-cli-cpu','Only native results carry engine convergence checks');}return r;
}
const EXAMPLES={
 practice2:{board:'2c3d4h8s9c',common:2.3,stacks:[4,4],ranges:['AsAd','KcKd'],streets:{river:{bets:'50,a',raises:'',maxBets:1}},privateSeed:17},
 river3:{board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd','Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'],streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateSeed:3},
 flop6:{board:'Td7c2h',dealt:8,common:1.5,stacks:[20,35,8,50,14,3],prior:[2.5,2.5,2.5,2.5,2.5,2.5],folded:[1,2.5],ranges:Array(6).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+:0.6'),streets:{flop:{bets:'33,a',raises:'3x,a',maxBets:2},turn:{bets:'50',raises:'a',maxBets:2},river:{bets:'75',raises:'a',maxBets:2}},privateSeed:6},
 preflop8:{board:'',dealt:8,common:0,preflop:{mode:'shove'},stacks:Array(8).fill(25),ranges:Array(8).fill('random'),privateSeed:8}
};
return {ENGINE,MAX_ITERATIONS,MAX_TIME_MS,canonical,input,prepare,result,runSync,nativeJob,normalizeNative,validateResult,EXAMPLES};
});
