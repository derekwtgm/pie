(function (EM) {
'use strict';
// Message handler shared by the real Web Worker and the main-thread fallback.
EM.workerMain = function (self) {
let game = null, stopFlag = false;
let river = null, riverBusy = false, riverStop = false;
let riverConfig=null, riverResult=null;
const post = (m) => self.postMessage(m);

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'pf-solve') pfSolve(m);
    else if (m.type === 'post-build') postBuild(m);
    else if (m.type === 'post-estimate') post({ type: 'result', id: m.id, result: { stats: EM.PostflopGame(EM.postflopEngineCfg(m.cfg)).stats } });
    else if (m.type === 'post-solve') postSolve(m);
    else if (m.type === 'post-stop') stopFlag = true;
    else if (m.type === 'post-node') postNode(m);
    else if (m.type === 'post-runouts') { if (!game) throw new Error('No solution loaded'); post({ type: 'result', id: m.id, result: game.runouts(m.path) }); }
    else if (m.type === 'post-free') { game = null; post({ type: 'result', id: m.id, result: { ok: true } }); }
    else if (m.type === 'post-lock') { if (!game) throw new Error('No solution loaded'); post({ type: 'result', id: m.id, result: { ok: true, locks: game.lock(m.path, m.strategy) } }); }
    else if (m.type === 'post-reset') { if (!game) throw new Error('No solution loaded'); game.reset(); post({ type: 'result', id: m.id, result: { ok: true } }); }
    else if (m.type === 'report-start') reportStart(m);
    else if (m.type === 'report-stop') { reportStop = true; }
    else if (m.type === 'deep-solve') deepSolve(m);
    else if (m.type === 'river-solve' || m.type === 'multi-solve') multiwaySolve(m);
    else if (m.type === 'multi-check') multiwayCheck(m);
    else if (m.type === 'multi-export' || m.type === 'multi-load' || m.type === 'multi-recover') checkpointFile(m);
    else if (m.type === 'multi-resume') multiwayResume(m);
    else if (m.type === 'river-stop' || m.type === 'multi-stop') { riverStop=true; post({type:'result',id:m.id,result:true}); }
    else if (m.type === 'river-node' || m.type === 'multi-node') {
      if (!river || riverBusy) throw new Error('Finish the postflop solve first');
      post({type:'result',id:m.id,result:river.view(m.path)});
    }
  } catch (e) {
    post({ type: 'error', id: m.id, message: (e && e.message) || String(e) });
  }
};

function multiwaySolve(m) {
  if (riverBusy) throw new Error('A multiway solve is already running');
  let max=Number(m.maxIter);const target=Number(m.target);
  const auto=m.cfg?.privateMode==='auto';
  if (!Number.isInteger(max) || max<1 || max>(auto||m.cfg?.privateMode==='sampled'?1000000:250000) || !Number.isFinite(target) || target<0)
    throw new Error('Choose a positive number of iterations (up to 1,000,000 for wide ranges or 250,000 for enumeration)');
  const g=m.type==='river-solve'?EM.RiverGame(m.cfg):EM.MultiwayGame(m.cfg);
  // Automatic mode resolves to exact or sampled deals; later resumes, checks and
  // checkpoints use the resolved configuration. Exact runs keep their 250,000 cap
  // and stop early at the target gain.
  const resolved=g.resolvedConfig||EM.copyStudyConfig(m.cfg), wide=resolved.privateMode==='sampled';
  if(!wide)max=Math.min(max,250000);
  river=g;riverConfig=resolved;riverResult=null;
  trainMultiway(m,g,max,target,wide);
}
function trainMultiway(m,g,max,target,wide){
  let interval=Number(m.autosaveSeconds??0);
  if(!Number.isInteger(interval)||interval<0||interval>3600)throw Error('Checkpoint interval must be 0–3600 seconds');
  riverBusy=true;riverStop=false;
  const started=performance.now(),initialDeals=g.trainingDeals||0;
  let lastSave=started,saveStatus='';
  async function autosave(final){
    if(!interval||(!final&&performance.now()-lastSave<interval*1000))return;
    try{
      await EM.autosaveTraining(await EM.encodeCheckpoint(g.snapshot(m.labels)),m.checkpointHost);
      saveStatus='Checkpoint saved at update '+g.iterations.toLocaleString();lastSave=performance.now();
    }catch(e){saveStatus='Automatic checkpoint failed: '+e.message;interval=0;}
  }
  const diagnosticInterval=Math.max(1000,Math.ceil((max-g.iterations)/20));
  let next=wide?Math.min(max,g.iterations+diagnosticInterval):g.iterations+25,lastMetrics=null;
  const checkpoints=[];
  async function step() {
    try {
      const until=performance.now()+55;
      while (!riverStop && !g.limitReached && g.iterations<Math.min(max,next) && performance.now()<until) g.iterate();
      if (riverStop || g.limitReached || g.iterations>=next || g.iterations>=max) {
        const finalWide=wide&&(riverStop||g.limitReached||g.iterations>=max);
        lastMetrics=wide&&!finalWide?g.metrics(256):g.metrics();
        if(wide){
          const actions=g.rootFrequencies(),previous=checkpoints.at(-1);
          const rootStrategyDelta=previous&&previous.actions.length===actions.length?
            Math.max(0,...actions.map((a,i)=>Math.abs((a.frequency||0)-(previous.actions[i].frequency||0)))):null;
          checkpoints.push({iterations:g.iterations,ev:lastMetrics.ev,se:lastMetrics.se,
            actions,rootStrategyDelta,note:'Root strategy drift is a stability diagnostic, not an equilibrium bound.'});
        }
        if(riverStop || g.limitReached || g.iterations>=max || lastMetrics.maxGain<=target) {
          await autosave(true);riverBusy=false;
          const reason=riverStop?'stopped':g.limitReached?'memory budget reached':wide?'training budget reached':lastMetrics.maxGain<=target?'target reached':'iteration limit';
          riverResult={metrics:lastMetrics,node:g.view([]),reason,checkpoints,saveStatus};
          post({type:'result',id:m.id,result:riverResult}); return;
        }
        next=wide?Math.min(max,g.iterations+diagnosticInterval):g.iterations+Math.min(100,Math.max(25,Math.floor(g.iterations/2)));
      }
      await autosave(false);
      const elapsed=(performance.now()-started)/1000;
      post({type:'progress',id:m.id,it:g.iterations,elapsed,trainingDeals:g.trainingDeals,strategyMiB:g.strategyMiB,
        dealsPerSecond:elapsed?(g.trainingDeals-initialDeals)/elapsed:0,saveStatus,gap:lastMetrics?lastMetrics.maxGain:null});
      setTimeout(step,0);
    } catch(e) { riverBusy=false; river=null; post({type:'error',id:m.id,message:e.message}); }
  }
  setTimeout(step,0);
}

function multiwayResume(m){
  if(riverBusy || !river || !riverResult)throw Error('Load or finish a multiway solve before resuming');
  const wide=riverConfig.privateMode==='sampled',more=Number(m.iterations),target=Number(m.target??0);
  if(!Number.isInteger(more)||more<1||more>(wide?1000000:250000)||river.iterations+more>1e9||!Number.isFinite(target)||target<0)
    throw Error('Choose up to 1,000,000 extra wide-range iterations or 250,000 exact iterations');
  if(wide && m.memoryMiB!==undefined){
    river.increaseBudget(Number(m.memoryMiB));riverConfig={...riverConfig,strategyBudgetMiB:Number(m.memoryMiB)};
  }
  if(river.limitReached)throw Error('Increase the strategy memory budget to continue this solve');
  trainMultiway(m,river,river.iterations+more,target,wide);
}
async function checkpointFile(m){
  if(riverBusy){post({type:'error',id:m.id,message:'Finish or stop the current operation first'});return;}
  riverBusy=true;
  try{
    if(m.type==='multi-export'){
      if(!river || !riverResult)throw Error('Solve a spot before saving training');
      const text=await EM.encodeCheckpoint(river.snapshot(m.labels));
      post({type:'result',id:m.id,result:{text,iterations:river.iterations}});
    }else{
      const loaded=m.type==='multi-recover'?await EM.recoverTraining(m.checkpointHost):EM.restoreCheckpoint(await EM.decodeCheckpoint(m.text));
      // Only commit after both validation and evaluation succeed.
      const result={metrics:loaded.game.metrics(),node:loaded.game.view([]),reason:'loaded training checkpoint',checkpoints:[]};
      river=loaded.game;riverConfig=loaded.cfg;riverResult=result;
      post({type:'result',id:m.id,result:{...result,cfg:loaded.cfg,labels:loaded.labels}});
    }
  }catch(e){post({type:'error',id:m.id,message:e.message});}
  finally{riverBusy=false;}
}

async function multiwayCheck(m) {
  if(riverBusy || !river || !riverResult){
    post({type:'error',id:m.id,message:'Finish a multiway solve before running checks'});return;
  }
  // No await until validation is complete. Rejected settings leave the current
  // strategy and explorer available.
  let plan;
  const checkMax=riverResult.metrics.iterations;
  try{
    if(checkMax<1)throw new Error('Train at least one iteration before checking accuracy');
    plan=EM.multiwayCheckPlan(riverConfig,m.options || {});}
  catch(e){post({type:'error',id:m.id,message:e.message});return;}
  riverBusy=true;riverStop=false;
  const baseGame=river, baseResult=riverResult;
  const report={status:'running',runs:[],responses:[],added:plan.added,
    privateMode:riverConfig.privateMode,requestedRuns:plan.seeds.length,errors:[]};
  function progress(stage,it,max){post({type:'progress',id:m.id,stage,it,max});}
  async function train(candidate,stage,max) {
    return new Promise((resolve,reject)=>{
      function step(){
        try{
          const until=performance.now()+45;
          while(!riverStop && !candidate.limitReached && candidate.iterations<max && performance.now()<until)candidate.iterate();
          progress(stage,candidate.iterations,max);
          if(riverStop || candidate.limitReached || candidate.iterations>=max){resolve();return;}
          setTimeout(step,0);
        }catch(e){reject(e);}
      }
      setTimeout(step,0);
    });
  }
  try{
    report.runs.push(EM.multiwayRunSummary('base',plan.seeds[0],baseResult));
    for(const variant of ['base','expanded']){
      if(variant==='expanded' && !plan.expanded)continue;
      for(let index=variant==='base'?1:0;index<plan.seeds.length && !riverStop;index++){
        const seed=plan.seeds[index], stage=(variant==='base'?'Seed check':'Added bet sizes')+' '+(index+1)+' / '+plan.seeds.length;
        try{
          const cfg=EM.multiwayCheckConfig(variant==='base'?riverConfig:plan.expanded,seed,baseResult.metrics.evaluationSeed);
          const candidate=EM.MultiwayGame(cfg);
          await train(candidate,stage,checkMax);
          if(riverStop)break;
          const metrics=candidate.metrics();
          report.runs.push(EM.multiwayRunSummary(variant,seed,{metrics,node:candidate.view([]),
            reason:candidate.limitReached?'memory budget reached':'training budget reached'}));
        }catch(e){report.errors.push({variant,seed,message:e.message});}
      }
    }
    if(baseGame.responseProbe && !riverStop){
      for(let seat=0;seat<riverConfig.stacks.length && !riverStop;seat++){
        const probe=baseGame.responseProbe(seat);
        await train(probe,'Testing response for seat '+(seat+1),plan.responseIterations);
        if(!riverStop)report.responses.push(probe.finish());
      }
    }
    if(baseGame.averageAt && !riverStop){
      progress('Exact cross-check',0,1);
      try{report.exact=EM.exactCheckSampled(riverConfig,baseGame);}
      catch(e){report.exact={available:false,reason:e.message};}
    }
    report.status=riverStop?'stopped':report.errors.length?'completed with errors':'completed';
    report.summary=EM.multiwayCheckSummary(report.runs);
    riverResult={...baseResult,audit:report};
    post({type:'result',id:m.id,result:riverResult});
  }catch(e){
    report.status='interrupted';report.errors.push({message:e.message});
    report.summary=EM.multiwayCheckSummary(report.runs);
    riverResult={...baseResult,audit:report};
    post({type:'result',id:m.id,result:riverResult});
  }finally{river=baseGame;riverBusy=false;}
}

function pfSolve(m) {
  let last = 0;
  if (m.cfg.fgs) m.cfg.fgs.onProgress = (k, total) => { const now = Date.now(); if (now - last > 120 || k === total) { last = now; post({ type: 'progress', id: m.id, it: 0, ex: 0, stage: 'Simulating future hands ' + k + '/' + total }); } };
  const s = EM.PushFold(m.cfg);
  s.solve({
    maxIter: m.maxIter || 6000, tol: m.tol || 2e-6,
    onProgress: (it, ex) => { const now = Date.now(); if (now - last > 120) { last = now; post({ type: 'progress', id: m.id, it, ex }); } }
  });
  post({ type: 'result', id: m.id, result: s.results() });
}

function postBuild(m) {
  game = null;
  const c = m.cfg;
  const t0 = Date.now();
  game = EM.PostflopGame(EM.postflopEngineCfg(c));
  post({ type: 'result', id: m.id, result: { stats: game.stats, combos: [Array.from(game.combos[0]), Array.from(game.combos[1])], buildMs: Date.now() - t0 } });
}

function postSolve(m) {
  if (!game) throw new Error('Set up the spot first');
  stopFlag = false;
  const target = m.target || 0.5, maxIter = m.maxIter || 1000;
  const t0 = performance.now();
  // exploitability checks cost about an iteration each: after two, the decay rate predicts when the target
  // is reached and the next check lands there; otherwise checks stay a small share of the time
  let ex = null, checkCost = 0, iterCost = 0, nextCheck = 3, lastIt = 0, lastEx = -1, exIt = -1;
  const schedule = (it, e) => {
    const r = checkCost / Math.max(iterCost, 1e-3);
    // at least one check every ~8 s, and at most +50% iterations per check (early decay rates under-predict)
    const gapMin = Math.max(3, Math.ceil(12 * r)), gapMax = Math.max(gapMin, Math.min(400, Math.floor(it / 2), Math.floor(8000 / Math.max(iterCost, 1e-3))));
    let gap = gapMin;
    if (lastIt > 0 && lastEx > e && e > target && it > lastIt) {
      const k = Math.log(lastEx / e) / Math.log(it / lastIt);
      if (k > 0.2) gap = Math.max(Math.max(1, Math.floor(gapMin / 4)), Math.min(gapMax, Math.ceil(it * Math.pow(e / target, 1 / k)) - it));
    }
    lastIt = it; lastEx = e;
    return it + gap;
  };
  const step = () => {
    try {
      if (stopFlag) return finish(true);
      const cs = performance.now(), i0 = game.iterations;
      do { game.iterate(1); } while (performance.now() - cs < 150 && game.iterations < maxIter && game.iterations < nextCheck);
      if (game.iterations > i0) { const c = (performance.now() - cs) / (game.iterations - i0); iterCost = iterCost > 0 ? 0.7 * iterCost + 0.3 * c : c; }
      const due = game.iterations >= maxIter || game.iterations >= nextCheck;
      if (due) {
        const c0 = performance.now();
        ex = game.exploitability(); exIt = game.iterations;
        checkCost = performance.now() - c0;
        nextCheck = schedule(game.iterations, ex.pct);
      }
      post({ type: 'progress', id: m.id, it: game.iterations, ex: ex ? ex.pct : null, elapsed: (performance.now() - t0) / 1000, engine: game.engine });
      if ((ex && due && ex.pct <= target && game.iterations >= 10) || game.iterations >= maxIter) return finish(false);
      setTimeout(step, 0);
    } catch (e) { post({ type: 'error', id: m.id, message: e.message || String(e) }); }
  };
  const finish = (stopped) => {
    const e = exIt === game.iterations && ex ? ex : game.exploitability();
    post({ type: 'result', id: m.id, result: { it: game.iterations, ex: e.pct, chips: e.chips, elapsed: (performance.now() - t0) / 1000, stopped, engine: game.engine } });
  };
  setTimeout(step, 0);
}

let reportStop = false;
function summary(info) {
  if (!info || info.type !== 'player') return null;
  const q = info.player, o = 1 - q, nq = info.reach[q].length, nA = info.actions.length;
  const fr = new Float64Array(nA); let w = 0, ev = 0, eq = 0, wo = 0, evo = 0, eqo = 0;
  for (let h = 0; h < nq; h++) {
    const r = info.reach[q][h]; if (!r || !Number.isFinite(info.ev[q][h])) continue;
    w += r; ev += r * info.ev[q][h]; eq += r * (Number.isFinite(info.equity[q][h]) ? info.equity[q][h] : 0);
    for (let a = 0; a < nA; a++) fr[a] += r * info.strategy[a * nq + h];
  }
  for (let h = 0; h < info.reach[o].length; h++) {
    const r = info.reach[o][h]; if (!r || !Number.isFinite(info.ev[o][h])) continue;
    wo += r; evo += r * info.ev[o][h]; eqo += r * (Number.isFinite(info.equity[o][h]) ? info.equity[o][h] : 0);
  }
  return { type: 'player', player: q, pot: info.pot, actions: info.actions.map(a => ({ kind: a.kind, amt: a.amt, label: a.label, pctPot: a.pctPot })),
    freq: Array.from(fr, x => x / (w || 1)), evAvg: ev / (w || 1), eqAvg: eq / (w || 1), evOpp: evo / (wo || 1), eqOpp: eqo / (wo || 1) };
}
function reportStart(m) {
  reportStop = false;
  const c = m.cfg, flops = m.flops, target = m.target || 1, maxIter = m.maxIter || 300;
  let i = 0, g = null, t0 = 0;
  const step = () => {
    try {
      if (reportStop) { post({ type: 'result', id: m.id, result: { stopped: true, done: i } }); return; }
      if (!g) {
        if (i >= flops.length) { post({ type: 'result', id: m.id, result: { stopped: false, done: i } }); return; }
        t0 = performance.now();
        g = EM.PostflopGame(EM.postflopEngineCfg(c, flops[i].slice(0, 3)));
      }
      const cs = performance.now();
      do { g.iterate(1); } while (performance.now() - cs < 200 && g.iterations < maxIter);
      let done = g.iterations >= maxIter, ex = null;
      if (done || g.iterations % 10 === 0) { ex = g.exploitability().pct; if (ex <= target && g.iterations >= 10) done = true; }
      post({ type: 'progress', id: m.id, current: { flop: flops[i].slice(0, 3), it: g.iterations, ex } });
      if (done) {
        const e = g.exploitability();
        const root = summary(g.nodeInfo([]));
        let after = null; try { const inf = g.nodeInfo([0]); if (inf.type === 'player') after = summary(inf); } catch (x) { after = null; }
        post({ type: 'progress', id: m.id, row: { board: flops[i].slice(0, 3), weight: flops[i][3], it: g.iterations, ex: e.pct, secs: (performance.now() - t0) / 1000, root, afterCheck: after } });
        g = null; i++;
      }
      setTimeout(step, 0);
    } catch (e) { post({ type: 'error', id: m.id, message: e.message || String(e) }); }
  };
  setTimeout(step, 0);
}
function deepSolve(m) {
  const d = EM.DeepTree(m.cfg);
  let last = 0;
  const ex = d.solve({ maxIter: m.maxIter || 1500, tol: m.tol || 0.002, onProgress: (it, e) => { const now = Date.now(); if (now - last > 150) { last = now; post({ type: 'progress', id: m.id, it, ex: e }); } } });
  post({ type: 'result', id: m.id, result: { packed: d.pack(), it: d.iterations, ex } });
}
function postNode(m) {
  if (!game) throw new Error('No solution loaded');
  const info = game.nodeInfo(m.path, m.opts || {});
  delete info.combos;
  post({ type: 'result', id: m.id, result: info });
}
};
})(globalThis.EM || (globalThis.EM = {}));
