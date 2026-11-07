(function(EM){
'use strict';
const streets=['flop','turn','river'];
EM.multiwayCheckPlan=function(cfg,options){
  const runs=options.runs??3,responseIterations=options.responseIterations??3000;
  if(!Number.isInteger(runs)||runs<1||runs>5)throw Error('Choose 1 to 5 seed runs');
  if(!Number.isInteger(responseIterations)||responseIterations<100||responseIterations>20000)
    throw Error('Choose 100 to 20,000 response training deals');
  const board=typeof cfg.board==='string'?EM.parseBoard(cfg.board):cfg.board;
  const wide=cfg.privateMode==='sampled', variable=wide || cfg.runouts?.mode==='sampled' && board.length<5;
  const seed=wide?(cfg.privateSeed??17):(cfg.runouts?.seed??17);
  const seeds=Array.from({length:variable?runs:1},(_,i)=>(seed+Math.imul(i,0x9e3779b9))>>>0);
  const expanded={...cfg,streets:{...cfg.streets}},added=[];
  for(const street of (cfg.preflop?.mode==='shove'?[]:streets.slice(Math.max(0,board.length-3)))){
    const before=cfg.streets?.[street]||cfg, extra=options.extra?.[street]||{};
    const after={bets:before.bets||'',raises:before.raises||'',maxBets:before.maxBets??2};
    let changed=false;
    for(const kind of ['bets','raises']){
      const old=EM.multiwaySizeList(before[kind],kind==='raises');
      const more=EM.multiwaySizeList(extra[kind],kind==='raises');
      const key=size=>size.kind+':'+(size.value??'');
      const joined=new Map(old.map(size=>[key(size),size]));
      for(const size of more)joined.set(key(size),size);
      if(joined.size>5)throw Error('Use at most five combined '+kind+' sizes on the '+street);
      if(joined.size!==old.length)changed=true;
      after[kind]=[...joined.values()].map(size=>size.kind==='jam'?'a':size.kind==='multiple'?size.value+'x':String(+(100*size.value).toFixed(8))).join(',');
      if(kind==='raises' && more.length && after.maxBets<2){after.maxBets=2;changed=true;}
    }
    expanded.streets[street]=after;
    if(changed)added.push({street,...after});
  }
  return {seeds,expanded:added.length?expanded:null,added,responseIterations};
};
EM.multiwayCheckConfig=function(cfg,seed,evaluationSeed){
  if(cfg.privateMode==='sampled')return {...cfg,privateSeed:seed,evaluationSeed};
  return {...cfg,runouts:{...cfg.runouts,seed}};
};
EM.multiwayRunSummary=function(variant,seed,result){
  const m=result.metrics,root=result.node;
  return {variant,seed,iterations:m.iterations,ev:m.ev,se:m.se||m.ev.map(()=>0),
    gain:m.gain||null,algorithm:m.algorithm||'enumerated',reason:result.reason,
    strategyMiB:m.strategyMiB??null,actions:(root.actions||[]).map(a=>({label:a.label,frequency:a.frequency,ev:a.ev}))};
};
EM.multiwayCheckSummary=function(runs){
  const base=runs.filter(r=>r.variant==='base'), expanded=runs.filter(r=>r.variant==='expanded');
  if(!base.length)return null;
  const n=base[0].ev.length;
  function group(rows){
    if(!rows.length)return null;
    return {count:rows.length,ev:Array.from({length:n},(_,p)=>{
      const values=rows.map(r=>r.ev[p]);
      return {mean:values.reduce((a,b)=>a+b,0)/values.length,min:Math.min(...values),max:Math.max(...values)};
    })};
  }
  const pairs=expanded.map(e=>({expanded:e,base:base.find(b=>b.seed===e.seed)})).filter(p=>p.base);
  const changes=Array.from({length:n},(_,p)=>pairs.length?
    pairs.reduce((sum,row)=>sum+row.expanded.ev[p]-row.base.ev[p],0)/pairs.length:null);
  const labels=[...new Set(runs.flatMap(r=>r.actions.map(a=>a.label)))];
  const frequency=(run,label)=>run.actions.find(a=>a.label===label)?.frequency??0;
  const actions=labels.map(label=>{
    const values=base.map(run=>frequency(run,label));
    return {label,base:values.reduce((a,b)=>a+b,0)/values.length,
      min:Math.min(...values),max:Math.max(...values),
      expanded:expanded.length?expanded.reduce((sum,run)=>sum+frequency(run,label),0)/expanded.length:null};
  });
  return {base:group(base),expanded:group(expanded),pairedRuns:pairs.length,evChange:changes,actions,
    seedEVSpread:Math.max(...group(base).ev.map(v=>v.max-v.min)),
    rootFrequencySpread:Math.max(0,...actions.map(a=>a.max-a.min))};
};
})(globalThis.EM || (globalThis.EM = {}));
