// A fresh-study, explicit pilot race. Every candidate receives the same
// time allowance and independent seed set. Training samples never enter the
// user's strategy, and a restored study retains its saved settings.
(function(EM){
'use strict';
const calibration=new Map();
function calibrationKey(cfg,context){
  // User cfg is finite data. Sorting keys makes independently reconstructed studies
  // equivalent; array order, range weights, payout, seeds and device settings matter.
  function stable(value){
    if(!value||typeof value!=='object')return value;
    if(Array.isArray(value)||ArrayBuffer.isView(value))return Array.from(value,stable);
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  }
  return JSON.stringify(stable([cfg,context]));
}
async function selectByTrials(cfg,run,notify=()=>{},cancel=()=>false,study=null){
  const key=study?calibrationKey(cfg,study.backend):null;
  if(study && calibration.has(key)){
    const value=calibration.get(key);calibration.delete(key);calibration.set(key,value);
    return {...value,cfg:{...cfg,...value.choice},trials:[],reused:true,reason:'Reused measured calibration for this study and execution configuration'};
  }
  if(study && study.updates<=256){
    return {cfg,reason:'Short study uses the static accuracy and memory selector to avoid pilot startup',trials:[],earlyExit:true};
  }
  const current=EM.MultiwayGame(cfg),settings=current.traversalSelection;
  const wideCfg=current.resolvedConfig||cfg;
  if(!settings)return {cfg:wideCfg,reason:'Exact enumeration selected for this study',trials:[]};
  const diag=current.diagnostics();
  const finite=EM.planMultiwayMode({...wideCfg,privateMode:'exact'}).chosen==='exact';
  const base={traversal:settings.chosen==='external sampling'?'external':'full',weighting:cfg.weighting||'linear',regretMatching:cfg.regretMatching||'standard',terminalExpectation:!!cfg.terminalExpectation};
  const manual=cfg.traversal&&cfg.traversal!=='auto',fullOK=base.traversal==='full'||(typeof settings.states==='number'&&settings.states<=2048&&settings.estimatedFullTreeMiB<diag.budgetMiB/4);
  const eligible=[base,{traversal:'external',weighting:'linear',regretMatching:'standard',terminalExpectation:false},
    {traversal:'external',weighting:'linear',regretMatching:'standard',terminalExpectation:true},{traversal:'external',weighting:'dcfr',regretMatching:'standard',terminalExpectation:false},
    {traversal:'full',weighting:'uniform',regretMatching:'standard',terminalExpectation:false},{traversal:'full',weighting:'linear',regretMatching:'plus',terminalExpectation:false}];
  const seen=new Set(),candidates=eligible.filter(a=>{
    if((manual&&a.traversal!==cfg.traversal)||(cfg.weighting&&a.weighting!==cfg.weighting)||(cfg.regretMatching&&a.regretMatching!==cfg.regretMatching)||
      (cfg.terminalExpectation!==undefined&&a.terminalExpectation!==cfg.terminalExpectation)||(a.traversal==='full'&&!fullOK)||
      (a.traversal==='external'&&cfg.riverStrata&&!cfg.externalRiverStrata)||(cfg.updates&&cfg.updates!=='simultaneous'&&a.traversal!==base.traversal))return false;
    const k=JSON.stringify(a);if(seen.has(k))return false;seen.add(k);return true;
  });
  if(study&&candidates.length===1)return {cfg:{...wideCfg,...candidates[0]},trials:[],earlyExit:true,reason:'Only one candidate meets the manual settings and resource constraints'};
  const ms=cfg.accuracyPreset==='high'?180:cfg.accuracyPreset==='fast'?60:100,seeds=[17,127,991],trials=[];
  for(let si=0;si<seeds.length;si++){
    for(let j=0;j<candidates.length;j++){
      if(cancel())throw Error('Algorithm calibration stopped');
      const ci=(j+si)%candidates.length,choice=candidates[ci],pilot={...wideCfg,...choice,privateSeed:((cfg.privateSeed??17)^seeds[si])>>>0,evaluationDeals:finite?128:512};
      notify('Testing algorithm '+(j+1)+' of '+candidates.length+' · seed '+(si+1)+' of 3');
      const g=EM.MultiwayGame(pilot),sample=await run(g,ms,pilot);
      if(!sample||!g.iterations||g.limitReached)throw Error('Pilot exceeded its resource budget');
      let gain,se=0;
      if(finite){const q=EM.exactCheckSampled(pilot,g);if(!q.available)throw Error(q.reason);
        gain=q.gain.length===2?(q.gain[0]+q.gain[1])/2:q.maxGain;}
      else{const probe=g.responseProbe(si%cfg.stacks.length);probe.iterate(128);const q=probe.finish();gain=q.gain;se=q.se;}
      trials.push({candidate:ci,seed:seeds[si],seat:finite?null:si%cfg.stacks.length,gain,se,...sample,deals:g.trainingDeals,budgetMs:ms});
    }
  }
  const by=candidates.map((_,i)=>trials.filter(t=>t.candidate===i));let best=0,margin=0;
  for(let i=1;i<candidates.length;i++){
    const change=by[0].map((x,j)=>x.gain-by[i][j].gain),mean=change.reduce((a,b)=>a+b,0)/3;
    const error=Math.sqrt(change.reduce((s,x)=>s+(x-mean)**2,0)/6);
    const holdout=Math.sqrt(by[0].reduce((s,t,j)=>s+t.se*t.se+by[i][j].se**2,0))/3;
    // Short pilot races are advisory. Require a positive paired lower estimate
    // before overriding the established choice; no equilibrium bound is inferred.
    const lower=mean-4.303*error-1.96*holdout;if(lower>margin){margin=lower;best=i;}
  }
  const metric=finite?(cfg.stacks.length===2?'exact exploitability':'exact finite-game largest unilateral gain'):'approximate held-out unilateral gain';
  const result={cfg:{...wideCfg,...candidates[best]},selected:best,candidates,trials,metric,
    reason:best?'Lower '+metric+' in paired timed pilots':'Pilot evidence retained the starting algorithm',
    inputs:{players:cfg.stacks.length,street:diag.startStreet,utility:diag.utility,abstraction:diag.abstraction,tableMiB:diag.budgetMiB,tree:settings.states??null,precision:cfg.accuracyPreset||'balanced',eligibility:settings.reason}};
  if(study && key.length<=262144){
    const choice={...candidates[best],privateMode:wideCfg.privateMode};
    if(calibration.size===8)calibration.delete(calibration.keys().next().value);
    calibration.set(key,{choice,selected:best,metric,inputs:result.inputs});
  }
  return result;
}
EM.selectByTrials=selectByTrials;
})(globalThis.EM||(globalThis.EM={}));
