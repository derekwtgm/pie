(function (EM) {
'use strict';
const streets=['Flop','Turn','River'];
const sourceRanges=['QhQd,9c9d','AsAd,KsTh','JhJd,8s8d','AcKd,5c5d','AhKh,6s6h','TsTc,7c7d','9h9s,AdQd','KhQh,4c4d'];
function multiwayExample(n=3,start='Flop',dealt=8) {
  if(start==='Preflop' || start==='Shove / call') {
    const spot=multiwayExample(n,'Flop',dealt), shove=start!=='Preflop';
    spot.study=shove?'shove':'linked';spot.board='';spot.privateMode='sampled';spot.maxIter=10000;
    spot.seats=Array.from({length:n},(_,i)=>({name:EM.pfPositions(n)[i],stack:String(shove?[8,12,18,25,16,30,22,10][i]:25),prior:'0',range:'random',lead:true}));
    spot.others=Array(Math.max(0,dealt-n)).fill(24.9).join(',');
    spot.tree={flop:{bets:'50',raises:'',maxBets:1},turn:{bets:'75',raises:'',maxBets:1},river:{bets:'100',raises:'',maxBets:1}};
    spot.notes=shove?'Shove/call study: every seat can respond, overcall or isolate all-in. Any chips left after preflop check down to showdown.':'Linked study: preflop decisions train with the configured flop, turn and river actions. Seats outside this study are assumed already folded.';
    return spot;
  }
  const short=n>=4 && start!=='River';
  const deep=[16,22,26,30,24], riverStacks=[16,32,26,30,24];
  const tree={};
  streets.forEach((street,i)=>{
    if(n>=6) {
      tree[street.toLowerCase()]={bets:['25,50','50,100','75,125'][i],raises:'2.5x',maxBets:2};
      return;
    }
    tree[street.toLowerCase()]=start==='River' && i===2
      ? {bets:'50,100',raises:'2.5x',maxBets:2}
      : {bets:short?'100':['50','75','100'][i],raises:'',maxBets:1};
  });
  return {study:'postflop',anteType:'classic',ante:'',anteSeat:'-1',payoff:'chip',startStacks:'',abstraction:'detailed',memoryMiB:112,precision:'balanced',batchDeals:4,payouts:'50,30,20',others:Array(Math.max(0,dealt-n)).fill(24.9).join(','),preOpen:'2',preRaises:'3x,a',preCap:3,preLimps:true,privateMode:'auto',privateSeed:17,board:['2c 4d 7h','2c 4d 7h 9s','2c 4d 7h 9s Jc'][streets.indexOf(start)],
    dealt,common:'0',folded:'',tree,mode:start==='Flop'?'sampled':'exact',count:n>=6?2:4,seed:17,
    maxIter:10000,target:0.02,notes:n>=6?['Six','Seven','Eight'][n-6]+' players put in 2 bb each from 25 bb starting stacks. Two bet sizes and a 2.5x raise are available on each street. Edit the sizes to study another line.':'',seats:Array.from({length:n},(_,i)=>({
      name:'Seat '+(i+1),prior:'2',stack:String(n>=6?22.9:short?2*n+EM.tableAntes(dealt):(start==='River'?riverStacks:deep)[i]),
      range:sourceRanges[i],lead:true}))};
}
EM.multiwayExample=multiwayExample;
function multiwaySpotConfig(spot) {
  const number=v=>String(v).trim()===''?NaN:Number(v);
  const a=String(spot.ante??'').trim();
  const anteCfg=()=>({anteType:spot.anteType||'classic',ante:a===''?undefined:Number(a),anteSeat:Number(spot.anteSeat??-1)});
  const parseFolded=()=>String(spot.folded||'').trim()?String(spot.folded).trim().split(/[\s,]+/).map(number):[];
  const settings={};
  for(const s of streets){const k=s.toLowerCase(),row=spot.tree[k];settings[k]={bets:row.bets,raises:row.raises,maxBets:number(row.maxBets)};}
  const cfg={...anteCfg(),riverStrata:spot.riverStrata===true,batchDeals:Number(spot.batchDeals??1),abstraction:spot.abstraction,strategyBudgetMiB:number(spot.memoryMiB),privateMode:spot.privateMode,privateSeed:number(spot.privateSeed),board:spot.board,dealt:number(spot.dealt),common:number(spot.common),streets:settings,
    runouts:{mode:spot.mode,count:spot.mode==='sampled'?number(spot.count):4,seed:spot.mode==='sampled'?number(spot.seed):17},
    folded:parseFolded(),
    stacks:spot.seats.map(s=>number(s.stack)),prior:spot.seats.map(s=>number(s.prior)),
    ranges:spot.seats.map(s=>s.range),lead:spot.seats.map(s=>s.lead)};
  if(spot.study!=='postflop')cfg.preflop={mode:spot.study,opens:spot.preOpen,raises:spot.preRaises,maxBets:number(spot.preCap),limps:spot.preLimps};
  if(spot.payoff==='icm')cfg.icm={payouts:spot.payouts.trim().split(/[\s,]+/).filter(Boolean).map(Number),others:spot.others.trim().split(/[\s,]+/).filter(Boolean).map(Number)};
  if(cfg.icm && spot.study==='postflop' && spot.startStacks.trim())cfg.icm.startStacks=spot.startStacks.trim().split(/[\s,]+/).map(Number);
  return cfg;
}
EM.multiwaySpotConfig=multiwaySpotConfig;
EM.multiwayPanel = function(root, call, esc, pct, fmt) {
  const streets=['Flop','Turn','River'];
  const example=EM.multiwayExample;
  let spot=example(), pristine=true, busy=false, result=null, pos=[], current=null;
  let error='',progress='',revision=0,transferring=false,restoredConfig=null;
  const resume={iterations:10000,memoryMiB:112};
  const checks={runs:3,responseIterations:3000,extra:{
    flop:{bets:'75',raises:''},turn:{bets:'75',raises:''},river:{bets:'50',raises:''}}};
  const val=s=>esc(String(s));
  const num=(v,d=3)=>v==null?'—':fmt(v,d);
  const el=k=>root.querySelector('#rv-'+k);
  const unit=()=>result?.metrics.unit || (spot.payoff==='icm'?'prize units':'bb');
  const activeStreets=()=>spot.study==='shove'?[]:streets.slice(Math.max(0,boardLength()-3));
  const cardText=c=>'<b class="suit-'+EM.SC[c&3]+'">'+val(EM.RC[c>>2]+EM.SUIT_SYM[c&3])+'</b>';
  function boardLength() {
    try {return EM.parseBoard(spot.board).length;} catch(e) {return 0;}
  }
  function field(id,title,value,type='text',attrs='') {
    return '<label class="field"><span class="label">'+title+'</span><input id="rv-'+id+'" type="'+type+
      '" value="'+val(value)+'" '+attrs+'></label>';
  }
  function results() {
    if(!result || !current)return '';
    const m=result.metrics, seats=spot.seats, street=m.startStreet;
    let h;
    if(m.wide){
      h='<div class="card"><h2>'+val(street)+' solution</h2><p class="note">Wide ranges · seed '+m.seed+' · '+m.iterations.toLocaleString()+' training iterations · '+m.evaluationDeals.toLocaleString()+' evaluation deals · '+val(result.reason)+'</p>';
      if(m.trainingEngine)h+='<p class="note">Training engine: '+val(m.trainingEngine.name)+(m.trainingEngine.threads?' · '+m.trainingEngine.threads+' threads · '+num(m.trainingEngine.seconds,1)+' s native training':'')+(m.trainingEngine.fallbackReason?' (native not used: '+val(m.trainingEngine.fallbackReason)+')':'')+'.</p>';
      h+='<table class="rv-table"><thead><tr><th>Player</th><th>Estimated EV ('+unit()+')</th><th>Standard error ('+unit()+')</th></tr></thead><tbody>';
      seats.forEach((s,i)=>{h+='<tr><th>'+val(s.name)+'</th><td>'+num(m.ev[i])+'</td><td>'+num(m.se[i])+'</td></tr>';});
      h+='</tbody></table><p class="note">'+(m.algorithm==='external'?'Sampled betting traversal':'Full betting traversal')+' · '+val(m.dealSampler||'independent rejection')+' · '+num(m.strategyMiB,2)+' / '+num(m.memoryBudgetMiB,0)+' MiB estimated strategy storage · '+val(m.abstraction==='exact'?'Exact cards':m.abstraction==='compact'?'Compact groups':'Detailed groups')+'.</p><p class="note">Standard error measures evaluation sampling noise for this strategy. Detailed groups distinguish blockers, draws and board texture. Exact cards keeps distinct private cards and board histories; deals and betting branches are still sampled. Run the accuracy checks below to compare seeds, test opponent responses and, for spots small enough to enumerate, measure exact best-response gains. Training completion alone does not make a strategy an equilibrium.</p></div>';
    }else{
    const scope=m.runoutMode==='sampled'?'Sampled cards · seed '+m.seed:m.runoutMode==='fixed'?'Fixed river':'All legal future cards';
    h='<div class="card"><h2>'+val(street)+' solution</h2><p class="note">'+val(scope)+' · '+val(result.reason)+' · '+m.iterations+
      ' iterations · '+m.deals.toLocaleString()+' private deals · '+m.nodes.toLocaleString()+' tree states</p>';
    if(m.runoutMode==='sampled')h+='<p class="note">Gains apply to this sampled tree. Change the seed to check sensitivity to the selected cards.</p>';
    h+='<div class="rv-scroll"><table class="rv-table"><thead><tr><th>Player</th><th>EV ('+unit()+')</th><th>Best response ('+unit()+')</th><th>Gain ('+unit()+')</th></tr></thead><tbody>';
    seats.forEach((s,i)=>{h+='<tr><th>'+val(s.name)+'</th><td>'+num(m.ev[i])+'</td><td>'+num(m.best[i])+'</td><td>'+num(m.gain[i],4)+'</td></tr>';});
    h+='</tbody></table></div><p class="note">Chip EV is measured from the start of the spot; ICM is expected remaining prize value. Gain is the most one player can improve against the other fixed strategies using the available bets and runouts.</p></div>';
    }
    if(m.modeSelection)h+='<p class="note">Automatic private-range mode chose '+(m.modeSelection.chosen==='exact'?'exact deal enumeration':'sampled deals (Wide ranges)')+'. '+val(m.modeSelection.reason)+'.</p>';
    if(m.utility==='icm')h+='<p class="note">ICM values are absolute expected remaining prizes in the units of your payouts. Stacks and bet amounts remain in bb. Reporting thresholds use 0.1% of the remaining prize pool.</p>';
    if(spot.study==='shove')h+='<p class="note">Shove/call model: all eligible seats may respond preflop. Any chips left after preflop check down to showdown; later bets are outside this study.</p>';
    h+=trainingControls()+quality();
    h+='<div class="card"><div class="row sb"><h2>Action explorer</h2><span class="small muted">Pot '+num(current.pot,2)+' bb</span></div>';
    if(m.wide)h+='<p class="note">Explorer estimates use '+num(current.effectiveSamples,0)+' effective evaluation deals on this line. Sparse hand-level estimates can vary widely.</p>';
    h+='<div class="rv-board">' +current.board.map(cardText).join(' ')+'</div><div class="crumbs"><button data-rv-back="0">'+street+' start</button>';
    current.line.forEach((x,i)=>{
      const label=x.kind==='card'?x.label:seats[x.seat].name+' '+x.label;
      h+='<button data-rv-back="'+(i+1)+'">'+val(label)+'</button>';
    });
    h+='</div>';
    if(current.kind==='chance') {
      h+='<h3>Deal the '+val(current.nextStreet.toLowerCase())+'</h3><p class="note">'+(current.flopInput?'Enter any compatible flop to inspect the continuation.':'Probabilities reflect the ranges, blockers and betting line.')+'</p><div class="rv-cards">';
      if(current.flopInput)h+=field('flop-card','Flop to inspect (three cards)','2c 4d 7h')+'<button class="btn" data-rv-flop="1">Inspect flop</button>';
      else for(const c of current.cards)h+='<button class="btn" data-rv-card="'+c.card+'" aria-label="'+val(c.label)+'">'+cardText(c.card)+'<small>'+pct(c.prob,1)+'</small></button>';
      h+='</div>';
    } else if(current.kind==='terminal') {
      h+='<h3>Pot settlement</h3>';
      for(const layer of current.pots)h+='<p class="note">'+num(layer.amount,2)+' bb eligible to '+layer.eligible.map(i=>val(seats[i].name)).join(', ')+'</p>';
      if(current.runoutAveraged)h+='<p class="note">All betting is complete. Payouts average the remaining runouts in this solve.</p>';
      if(current.prob>0)h+='<p class="small">Expected value · '+current.ev.map((v,i)=>val(seats[i].name)+' '+num(v)+' '+unit()).join(' · ')+'</p>';
    } else {
      h+='<div class="row sb"><h3>'+val(seats[current.seat].name)+' to act</h3><span class="small muted">'+num(current.behind[current.seat],2)+' bb behind</span></div><div class="row">';
      current.actions.forEach((a,i)=>{h+='<button class="btn" data-rv-act="'+i+'">'+val(a.label)+(a.frequency==null?'':' · '+pct(a.frequency,1))+(m.wide && a.ev!=null?' · '+num(a.ev,2)+' '+unit():'')+'</button>';});
      h+='</div>';
      if(current.hands.length) {
        h+='<div class="rv-scroll"><table class="rv-table"><thead><tr><th>Hand</th>'+current.actions.map(a=>'<th>'+val(a.label)+'</th>').join('')+'</tr></thead><tbody>';
        for(const hand of current.hands)h+='<tr><th>'+val(hand.cards)+(m.wide?'<small class="rv-ev">n ≈ '+num(hand.effectiveSamples,0)+'</small>':'')+'</th>'+hand.mix.map((f,a)=>'<td>'+pct(f,1)+'<small class="rv-ev">'+num(hand.ev[a],2)+' '+unit()+'</small></td>').join('')+'</tr>';
        h+='</tbody></table></div><p class="note">Each cell shows action frequency and continuation EV. Chip values start at this decision; ICM values are expected remaining prizes.</p>';
      } else h+='<p class="note">'+(m.wide?'No evaluation deals reached this line.':'This line has zero probability under the displayed strategy.')+'</p>';
    }
    return h+'</div>';
  }
  function trainingControls(){
    return '<div class="card"><h2>Save and continue training</h2><fieldset '+(busy?'disabled':'')+'><button class="btn" data-rv-save="1">Save training</button><div class="fields">'+
      field('resume-iterations','Additional iterations',resume.iterations,'number','min="1" max="'+(result.metrics.wide?100000:5000)+'"')+
      (result.metrics.wide?field('resume-memory','Strategy budget (MiB)',resume.memoryMiB,'number','min="'+result.metrics.memoryBudgetMiB+'" max="256" step="1"'):'')+
      '</div><button class="btn" data-rv-resume="1">Continue training</button></fieldset><p class="note">Save downloads an .emstudy file with the setup, regrets, average strategy and random state. Load it above to continue later. Increase the budget after a memory stop. Accuracy reports must be rerun after more training.</p></div>';
  }
  function trainingReady(){
    resume.iterations=result.metrics.wide?10000:500;
    resume.memoryMiB=result.metrics.memoryBudgetMiB || 112;
  }
  async function saveTraining(){
    busy=transferring=true;error='';progress='Preparing training download…';render();
    try{
      const saved=await call('multi-export',{labels:spot.seats.map(s=>s.name)});
      const url=URL.createObjectURL(new Blob([saved.text],{type:'application/json'})),link=document.createElement('a');
      link.href=url;link.download='EightMax-'+result.metrics.startStreet+'-'+saved.iterations+'.emstudy';
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      progress='Training download prepared. Keep the .emstudy file to resume later.';
    }catch(e){error=e.message;progress='';}finally{busy=transferring=false;render();}
  }
  function checkpointSpot(cfg,labels){
    const n=cfg.stacks.length,start=cfg.preflop?(cfg.preflop.mode==='shove'?'Shove / call':'Preflop'):streets[(typeof cfg.board==='string'?EM.parseBoard(cfg.board):cfg.board).length-3];
    const next=example(n,start,cfg.dealt??Math.max(n,n+(cfg.folded?.length||0)));
    next.board=typeof cfg.board==='string'?cfg.board:cfg.board.map(EM.cardStr).join(' ');
    next.common=String(cfg.common-(cfg.dealt===undefined?0.1*next.dealt:0));
    next.folded=(cfg.folded||[]).join(',');next.privateMode=cfg.privateMode||'exact';next.privateSeed=cfg.privateSeed??17;
    next.riverStrata=cfg.riverStrata===true;next.batchDeals=cfg.batchDeals??1;next.precision='custom';next.abstraction=cfg.abstraction||'detailed';next.memoryMiB=cfg.strategyBudgetMiB??112;
    next.anteType=cfg.anteType||'classic';next.ante=cfg.ante==null?'':String(cfg.ante);next.anteSeat=String(cfg.anteSeat??-1);
    next.mode=cfg.runouts?.mode||'exact';next.count=cfg.runouts?.count??4;next.seed=cfg.runouts?.seed??17;
    next.payoff=cfg.icm?'icm':'chip';next.payouts=(cfg.icm?.payouts||[50,30,20]).join(',');
    next.others=(cfg.icm?.others||[]).join(',');next.startStacks=(cfg.icm?.startStacks||[]).join(',');
    if(cfg.preflop){next.preOpen=cfg.preflop.opens??'2';next.preRaises=cfg.preflop.raises??'3x,a';next.preCap=cfg.preflop.maxBets??3;next.preLimps=cfg.preflop.limps!==false;}
    for(const street of streets){const k=street.toLowerCase(),row=cfg.streets?.[k]||cfg;next.tree[k]={bets:row.bets||'',raises:row.raises||'',maxBets:row.maxBets??2};}
    next.seats=cfg.stacks.map((stack,i)=>({name:labels[i]||'Seat '+(i+1),stack:String(stack),prior:String(cfg.prior?.[i]||0),lead:cfg.lead?.[i]!==false,
      range:typeof cfg.ranges[i]==='string'?cfg.ranges[i]:Array.from(cfg.ranges[i],(w,c)=>w>0?EM.comboStr(c)+':'+w:'').filter(Boolean).join(',')}));
    next.notes='Loaded training setup. Continue training keeps the saved configuration and strategy. Editing the setup starts a new study.';
    return next;
  }
  async function loadTraining(file,recover=false){
    if(!file&&!recover)return;
    if(file?.size>EM.checkpointMaxBytes){error='Training files must be at most 512 MiB';status();return;}
    busy=transferring=true;error='';progress='Validating saved training…';render();
    try{
      const loaded=recover?await call('multi-recover',{}):await call('multi-load',{text:await file.text()});
      spot=checkpointSpot(loaded.cfg,loaded.labels);restoredConfig=loaded.cfg;
      result=loaded;current=loaded.node;pos=[];revision++;pristine=false;trainingReady();progress='Training loaded.';
    }catch(e){error=e.message;progress='';}finally{busy=transferring=false;render();}
  }
  function trainingProgress(m){
    let message='Update '+m.it.toLocaleString();
    if(Number.isFinite(m.trainingDeals))message+=' · '+m.trainingDeals.toLocaleString()+' sampled deals · '+Math.round(m.dealsPerSecond)+' deals/s · '+num(m.strategyMiB,1)+' MiB strategy';
    if(Number.isFinite(m.elapsed))message+=' · '+Math.round(m.elapsed)+' s';
    if(m.gap!=null)message+=' · largest measured gain '+num(m.gap,4)+' '+unit();
    return message+(m.saveStatus?' · '+m.saveStatus:'');
  }
  async function resumeTraining(){
    resume.iterations=number(el('resume-iterations').value);
    if(el('resume-memory'))resume.memoryMiB=number(el('resume-memory').value);
    busy=true;error='';progress='Continuing saved training…';render();
    try{
      result=await call('multi-resume',{iterations:resume.iterations,autosaveSeconds:Number(spot.autosaveSeconds||0),labels:spot.seats.map(s=>s.name),memoryMiB:resume.memoryMiB,target:number(spot.target)},m=>{
        progress=trainingProgress(m);status();
      });
      current=result.node;pos=[];revision++;spot.memoryMiB=resume.memoryMiB;
      if(restoredConfig)restoredConfig.strategyBudgetMiB=resume.memoryMiB;
      progress=result.saveStatus||'';
    }catch(e){error=e.message;progress='';}finally{busy=false;render();}
  }
  function quality(){
    const audit=result.audit, summary=audit?.summary, seats=spot.seats;
    let h='<div class="card"><h2>Accuracy and bet sizes</h2>';
    const checkpoints=result.checkpoints||[];
    if(checkpoints.length>1){
      const first=checkpoints[0],last=checkpoints[checkpoints.length-1];
      const change=Math.max(0,...last.actions.map(a=>Math.abs((a.frequency||0)-(first.actions.find(b=>b.label===a.label)?.frequency||0))));
      h+='<p class="note">Root action frequencies changed by up to '+num(100*change,1)+' percentage points between iterations '+first.iterations.toLocaleString()+' and '+last.iterations.toLocaleString()+'.</p>';
    }
    h+='<fieldset '+(busy?'disabled':'')+'><div class="fields">'+
      '<label class="field"><span class="label">Seed runs</span><select id="rv-check-runs">'+[1,3,5].map(n=>'<option '+(checks.runs===n?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
      field('check-response','Response training deals per seat',checks.responseIterations,'number','min="100" max="20000"')+'</div>'+
      '<p class="note">The checks repeat training at the same iteration budget, re-solve with the extra sizes below, and train a separate response for each seat in wide-range mode. Exact fixed-card enumeration uses one run. Added raises use a cap of at least two.</p>'+
      '<div class="rv-scroll"><table class="rv-table"><thead><tr><th>Street</th><th>Extra bets (% pot)</th><th>Extra raises (× or % pot)</th></tr></thead><tbody>'+
      activeStreets().map(street=>{
        const key=street.toLowerCase(),row=checks.extra[key];
        return '<tr><th>'+street+'</th><td><input id="rv-check-bets-'+key+'" aria-label="'+street+' extra bets" value="'+val(row.bets)+'"></td>'+
          '<td><input id="rv-check-raises-'+key+'" aria-label="'+street+' extra raises" value="'+val(row.raises)+'"></td></tr>';
      }).join('')+'</tbody></table></div><button class="btn" data-rv-check="1">Check accuracy and bet sizes</button></fieldset>';
    if(audit){
      h+='<p class="note">'+val(audit.status)+' · '+audit.runs.length+' recorded solves · '+audit.responses.length+' tested responses.</p>';
      if(audit.added.length){
        h+='<p class="note">Compared tree · '+audit.added.map(row=>val(row.street)+' bets '+val(row.bets||'none')+', raises '+val(row.raises||'none')+', cap '+row.maxBets).join(' · ')+'</p>';
      }
      if(summary){
        h+='<p class="note">Largest seat EV spread across original-tree seeds '+num(summary.seedEVSpread)+' '+unit()+' · largest root frequency spread '+num(100*summary.rootFrequencySpread,1)+' percentage points.</p>'+
          '<div class="rv-scroll"><table class="rv-table"><thead><tr><th>Seat</th><th>Original EV mean ('+unit()+')</th><th>Seed range ('+unit()+')</th><th>Expanded EV mean ('+unit()+')</th><th>Paired EV change ('+unit()+')</th></tr></thead><tbody>';
        seats.forEach((seat,p)=>{
          const base=summary.base.ev[p],expanded=summary.expanded?.ev[p];
          h+='<tr><th>'+val(seat.name)+'</th><td>'+num(base.mean)+'</td><td>'+num(base.min)+' to '+num(base.max)+'</td><td>'+num(expanded?.mean)+'</td><td>'+num(summary.evChange[p])+'</td></tr>';
        });
        h+='</tbody></table></div><p class="note">EV changes use '+summary.pairedRuns+' matched seeds. Seed ranges include training variation and evaluation noise. Re-solving all players measures sensitivity to the added sizes.</p>';
        if(summary.actions.length){
          h+='<table class="rv-table"><thead><tr><th>Root action</th><th>Original mean</th><th>Seed range</th><th>Expanded mean</th></tr></thead><tbody>';
          summary.actions.forEach(a=>{h+='<tr><th>'+val(a.label)+'</th><td>'+pct(a.base,1)+'</td><td>'+pct(a.min,1)+' to '+pct(a.max,1)+'</td><td>'+(a.expanded===null?'—':pct(a.expanded,1))+'</td></tr>';});
          h+='</tbody></table>';
        }
      }
      const flags=[], threshold=result.metrics.reportThreshold??0.1, thresholdText=num(threshold)+' '+unit();
      if(summary?.seedEVSpread>threshold)flags.push('Original-tree seed EV spread exceeds '+thresholdText+'.');
      if(summary?.rootFrequencySpread>0.05)flags.push('Root frequency spread exceeds 5 percentage points across seeds.');
      if(summary?.evChange.some(v=>v!==null && Math.abs(v)>threshold))flags.push('Added sizes change a seat’s mean EV by more than '+thresholdText+'.');
      if(summary?.actions.some(a=>a.expanded!==null && Math.abs(a.expanded-a.base)>0.05))flags.push('Added sizes change a root action frequency by more than 5 percentage points.');
      for(const response of audit.responses){
        if(response.gain>threshold && response.gain>1.96*response.se)flags.push(seats[response.seat].name+' has a tested response gain above '+thresholdText+' and two standard errors.');
        if(response.limitReached)flags.push(seats[response.seat].name+' response training reached its memory budget.');
      }
      if(audit.runs.some(run=>run.reason==='memory budget reached'))flags.push('At least one solve reached its memory budget.');
      if(flags.length)h+='<ul>'+flags.map(text=>'<li>'+val(text)+'</li>').join('')+'</ul><p class="note">These reporting thresholds help identify results for further study. Each interval describes one tested response.</p>';
      if(audit.responses.length){
        h+='<table class="rv-table"><thead><tr><th>Seat</th><th>Tested response gain ('+unit()+')</th><th>Approx. 95% interval ('+unit()+')</th></tr></thead><tbody>';
        audit.responses.forEach(r=>{h+='<tr><th>'+val(seats[r.seat].name)+'</th><td>'+num(r.gain)+'</td><td>'+num(r.gain-1.96*r.se)+' to '+num(r.gain+1.96*r.se)+'</td></tr>';});
        h+='</tbody></table><p class="note">Responses train against the original strategy and use separate evaluation deals. Gains cover the tested policies within the original bets and hand groups. Untried deviations and grouping error remain unmeasured.</p>';
      }
      if(audit.exact?.available){
        h+='<table class="rv-table"><thead><tr><th>Seat</th><th>Exact best-response gain ('+unit()+')</th></tr></thead><tbody>';
        audit.exact.gain.forEach((g,i)=>{h+='<tr><th>'+val(seats[i].name)+'</th><td>'+num(g,4)+'</td></tr>';});
        h+='</tbody></table><p class="note">Exact cross-check: this spot is small enough to enumerate, so the sampled average strategy was copied into the enumerated game ('+audit.exact.deals+' deals) and each seat’s full best response was computed there. This is the exact unilateral gain within the configured bets; it is not a multiplayer equilibrium certificate. '+audit.exact.unvisitedInformationSets+' of '+audit.exact.informationSets+' information sets were never sampled and play uniformly.</p>';
      }else if(audit.exact)h+='<p class="note">Exact cross-check unavailable: '+val(audit.exact.reason)+'. Tested responses above are lower bounds on the true gain.</p>';
      h+='<details><summary>Individual runs</summary><div class="rv-scroll"><table class="rv-table"><thead><tr><th>Tree</th><th>Seed</th><th>Iterations</th><th>Traversal</th><th>Result</th></tr></thead><tbody>'+
        audit.runs.map(r=>'<tr><td>'+val(r.variant)+'</td><td>'+r.seed+'</td><td>'+r.iterations+'</td><td>'+val(r.algorithm)+'</td><td>'+val(r.reason)+'</td></tr>').join('')+'</tbody></table></div></details>';
      for(const item of audit.errors)h+='<p class="err">'+val([item.variant,item.seed,item.message].filter(x=>x!==undefined).join(' · '))+'</p>';
    }
    return h+'</div>';
  }
  function readChecks(){
    if(!el('check-runs'))return;
    checks.runs=Number(el('check-runs').value);
    checks.responseIterations=number(el('check-response').value);
    for(const street of streets){
      const key=street.toLowerCase();
      for(const field of ['bets','raises'])if(el('check-'+field+'-'+key))checks.extra[key][field]=el('check-'+field+'-'+key).value;
    }
  }
  async function checkAccuracy(){
    readChecks();busy=true;error='';progress='Starting accuracy checks…';render();
    try{
      result=await call('multi-check',{options:checks},m=>{
        progress=m.stage+' · '+m.it.toLocaleString()+' / '+m.max.toLocaleString();status();
      });
      current=result.node;pos=[];progress='';
    }catch(e){error=e.message;progress='';}
    finally{busy=false;render();}
  }
  function status() {
    const info=el('status'), out=el('output');
    if(info){info.textContent=error||progress;info.className=error?'err':'small muted num';}
    if(out)out.innerHTML=results();
  }
  function updateControls() {
    const length=boardLength(), start=spot.study==='postflop'?streets[length-3]:'Preflop';
    const preview=el('pot-preview');
    if(preview){
      let model;try{model=EM.anteModel(anteCfg());}catch(e){preview.textContent=e.message;model=null;}
      if(model){
      const dealt=Number(spot.dealt),ante=model.total(dealt), folded=parseFolded(), n=spot.seats.length;
      const chips=spot.study==='postflop'?[number(spot.common),...spot.seats.map(s=>number(s.prior)),...folded]:spot.seats.map((s,p)=>Math.min(Math.max(0,number(s.stack)-model.seat(p===n-1)),p===n-1?1:p===n-2?0.5:0));
      const total=chips.every(x=>Number.isFinite(x)&&x>=0) && n+folded.length<=dealt
        ? ' · Starting pot '+fmt(chips.reduce((a,b)=>a+b,ante),2)+' bb' : '';
      preview.textContent=(model.type==='classic'?model.amount+' bb × '+dealt+' dealt = '+fmt(ante,1)+' bb in antes':model.label(dealt))+total;
      }
      if(el('ante'))el('ante').disabled=spot.anteType==='none';
      if(el('anteSeat-field'))el('anteSeat-field').hidden=spot.study!=='postflop'||spot.anteType!=='bba';
    }
    const solve=el('solve');if(solve)solve.textContent=start?'Solve '+start.toLowerCase():'Solve spot';
    streets.forEach((street,i)=>{
      const row=el('row-'+street.toLowerCase());
      if(row)row.hidden=Boolean(start && i<length-3);
    });
    const run=el('chance-settings'), sample=el('sampling');
    if(run)run.hidden=length===5 || spot.privateMode==='sampled';
    if(el('wide-controls'))el('wide-controls').hidden=spot.privateMode==='exact';
    if(el('target'))el('target').disabled=spot.privateMode==='sampled';
    if(sample)sample.hidden=spot.mode!=='sampled';
    if(el('icm-settings'))el('icm-settings').hidden=spot.payoff!=='icm';
    if(el('target-label'))el('target-label').textContent='Largest seat gain target ('+unit()+')';
    if(el('privateMode'))el('privateMode').disabled=spot.study!=='postflop';
  }
  function render() {
    const n=spot.seats.length, pre=spot.study!=='postflop', shove=spot.study==='shove';
    const seatRows=spot.seats.map((s,i)=>'<tr><td><input id="rv-name'+i+'" aria-label="Seat '+(i+1)+' name" value="'+val(s.name)+'"></td>'+
      '<td><input id="rv-stack'+i+'" aria-label="Seat '+(i+1)+' chips behind" type="number" min="0" step="any" value="'+val(s.stack)+'"></td>'+
      '<td><input id="rv-prior'+i+'" aria-label="Seat '+(i+1)+' earlier wagers" type="number" min="0" step="any" value="'+val(s.prior)+'" '+(pre?'disabled':'')+'></td>'+
      '<td><input id="rv-range'+i+'" aria-label="Seat '+(i+1)+' range" value="'+val(s.range)+'"></td>'+
      '<td><input id="rv-lead'+i+'" aria-label="Seat '+(i+1)+' can open bet" type="checkbox" '+(s.lead?'checked':'')+'></td></tr>').join('');
    const sizeRows=streets.map(street=>{
      const key=street.toLowerCase(),t=spot.tree[key];
      return '<tr id="rv-row-'+key+'"><th>'+street+'</th><td><input id="rv-bets-'+key+'" aria-label="'+street+' bets" value="'+val(t.bets)+'"></td>'+
        '<td><input id="rv-raises-'+key+'" aria-label="'+street+' raises" value="'+val(t.raises)+'"></td>'+
        '<td><input id="rv-cap-'+key+'" aria-label="'+street+' bet cap" type="number" min="1" max="5" value="'+val(t.maxBets)+'"></td></tr>';
    }).join('');
    root.innerHTML='<div class="card"><div class="row sb"><h2>Multiway studies</h2><span class="small muted">'+(pre?(shove?'Shove / call · 2–8 players':'Preflop → river · 2–8 players'):'Postflop · 2–8 players')+'</span></div>'+
      '<fieldset class="rv-inputs" '+(busy?'disabled':'')+'><label class="field"><span class="label">Load saved training (.emstudy)</span><input id="rv-load" type="file" accept=".emstudy,application/json"></label><button type="button" class="btn sm" data-rv-recover="1">Recover automatic checkpoint</button>'+field('autosaveSeconds','Automatic checkpoint interval (seconds, 0 disables)',spot.autosaveSeconds||0,'number','min="0" max="3600"')+'<div class="rv-examples"><span class="label">Load example</span>'+
      ['Preflop','Shove / call',...streets].map(s=>'<button type="button" class="btn sm" data-rv-example="'+s+'">'+s+'</button>').join('')+'<button type="button" class="btn sm" data-dp-wide25="1">25 bb button vs blinds</button></div>'+
      '<div class="fields">'+field('board',pre?'Board (dealt during the solve)':'Board (3, 4 or 5 cards)',spot.board,'text',pre?'disabled':'')+
      '<label class="field"><span class="label">Players in the pot</span><select id="rv-count">'+[2,3,4,5,6,7,8].map(k=>'<option '+(n===k?'selected':'')+'>'+k+'</option>').join('')+'</select></label>'+
      '<label class="field"><span class="label">Players dealt in</span><select id="rv-dealt">'+
      Array.from({length:9-n},(_,i)=>i+n).map(k=>'<option '+(Number(spot.dealt)===k?'selected':'')+'>'+k+'</option>').join('')+'</select></label>'+
      field('common','Other common chips (bb)',spot.common,'number','min="0" step="any" '+(pre?'disabled':''))+
      '<label class="field"><span class="label">Ante</span><select id="rv-anteType">'+[['classic','Each dealt player'],['bba','Big blind ante'],['none','No ante']].map(([k,l])=>'<option value="'+k+'" '+(spot.anteType===k?'selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
      field('ante','Ante amount (bb, blank = 0.1 each or 1 BB ante)',spot.ante,'number','min="0" step="any"')+
      '<label class="field" id="rv-anteSeat-field"><span class="label">Live seat that posted the BB ante</span><select id="rv-anteSeat"><option value="-1">None (BB folded)</option>'+spot.seats.map((x,i)=>'<option value="'+i+'" '+(String(spot.anteSeat)===String(i)?'selected':'')+'>'+val(x.name)+'</option>').join('')+'</select></label></div>'+
      '<p id="rv-pot-preview" class="small num" aria-live="polite"></p>'+
      (shove?'<p class="note">Shove/call allows overcalls and all-in isolation raises. If several players still have chips when preflop closes, the rest of the hand checks down.</p>':'')+
      (spot.notes?'<p class="note" id="rv-notes">'+val(spot.notes)+'</p>':'')+
      '<p class="note">'+(pre?'List players in preflop action order, with SB second last and BB last. Both blinds must be included. Other dealt seats are assumed folded.':'List seats in postflop action order.')+' Enter random for all hands, a range such as QQ+,AKs, or exact hands such as QhQd,KsTh:0.5.</p>'+
      '<div class="rv-scroll"><table class="rv-table rv-setup"><thead><tr><th>Player</th><th>'+(pre?'Before posting (bb)':'Behind (bb)')+'</th><th>Earlier wagers</th><th>Range</th><th>Can open postflop</th></tr></thead><tbody>'+seatRows+'</tbody></table></div>'+
       '<p class="note">'+(pre?'Enter stacks before posting. The solver posts the antes you chose (each dealt seat, or the big blind only) and the 0.5/1 bb blinds. Chip EV is measured before posting.':'The solver adds the antes from every dealt seat, including preflop folds. Enter stacks behind after posting and betting. Put live bets and blinds under earlier wagers.')+'</p>'+
      '<div class="fields"><label class="field"><span class="label">Payoff</span><select id="rv-payoff"><option value="chip" '+(spot.payoff==='chip'?'selected':'')+'>Chip EV</option><option value="icm" '+(spot.payoff==='icm'?'selected':'')+'>Tournament ICM</option></select></label></div>'+
      '<div id="rv-icm-settings"><div class="fields">'+field('payouts','Remaining payouts, largest first',spot.payouts)+field('others','All other remaining stacks (bb)',spot.others)+field('startStacks','Live seats’ hand-start stacks (optional, bb)',spot.startStacks,'text',pre?'disabled':'')+'</div><p class="note">Include every other player still in the tournament, including folded seats, using chips left after their bets and antes. Up to 16 total players. Omitted payout places pay zero. Values use your payout units. Leave hand-start stacks blank to derive them from chips behind, earlier wagers and antes; enter them in seat order if needed for simultaneous bust ranking. This models regular prizes, without bounties.</p></div>'+
      (pre&&!shove?'<h3>Preflop actions</h3><div class="fields">'+field('preOpen','Opening raise-to sizes (bb)',spot.preOpen)+field('preRaises','Reraise sizes (× or % pot)',spot.preRaises)+field('preCap','Preflop raise cap',spot.preCap,'number','min="1" max="5"')+'<label class="field"><span class="label">Allow limps</span><input id="rv-preLimps" type="checkbox" '+(spot.preLimps?'checked':'')+'></label></div>':'')+
      '<label class="field"><span class="label">Private ranges</span><select id="rv-privateMode"><option value="auto" '+(spot.privateMode==='auto'?'selected':'')+'>Automatic · exact when it fits</option><option value="exact" '+(spot.privateMode==='exact'?'selected':'')+'>Enumerate compatible deals</option><option value="sampled" '+(spot.privateMode==='sampled'?'selected':'')+'>Wide ranges · sample fresh deals</option></select></label>'+
      '<div id="rv-wide-controls"><div class="fields">'+field('privateSeed','Training seed',spot.privateSeed,'number','min="0" max="4294967295"')+
      '<label class="field"><span class="label">Stratify compact river batches</span><input type="checkbox" id="rv-strata" '+(spot.riverStrata?'checked':'')+'></label><label class="field"><span class="label">Hand grouping</span><select id="rv-abstraction">'+[['compact','Compact'],['detailed','Detailed'],['exact','Exact cards']].map(([k,label])=>'<option value="'+k+'" '+(spot.abstraction===k?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
      (typeof window!=='undefined'&&window.EM_NATIVE?'<label class="field"><span class="label">Training engine</span><select id="rv-engine"><option value="native" '+(spot.engine!=='javascript'?'selected':'')+'>Native C++ when eligible</option><option value="javascript" '+(spot.engine==='javascript'?'selected':'')+'>JavaScript</option></select></label>':'')+
      '<label class="field"><span class="label">Precision preset</span><select id="rv-precision">'+[['fast','Fast'],['balanced','Balanced'],['high','High accuracy'],['custom','Custom']].map(([k,l])=>'<option value="'+k+'" '+(spot.precision===k?'selected':'')+'>'+l+'</option>').join('')+'</select></label>'+field('batchDeals','Deals per update',spot.batchDeals??1,'number','min="1" max="64"')+field('memoryMiB','Strategy budget (MiB)',spot.memoryMiB,'number','min="1" max="256" step="1"')+'</div><p class="note">Detailed groups separate more blockers and draws while remembering earlier streets. Exact cards keeps every private hand and board history distinct. Finer groups use more memory and need more training. This budget estimates strategy storage, not total app memory.</p><p class="note">Each iteration draws fresh compatible hands and community cards. Start with 10,000 iterations and one opening size per street.</p></div>'+
      '<div '+(shove?'hidden':'')+'><h3>Bet sizes by street</h3><div class="rv-scroll"><table class="rv-table rv-sizes"><thead><tr><th>Street</th><th>Opening bets (% pot)</th><th>Raises (× or % pot)</th><th>Bet / raise cap</th></tr></thead><tbody>'+sizeRows+'</tbody></table></div>'+
      '<p class="note">Separate sizes with commas. Use a for all-in, 2.5x for a raise multiple, or an empty box to omit those actions.</p></div>'+
      '<div id="rv-chance-settings"><h3>Future board cards</h3><label class="field"><span class="label">Runouts</span><select id="rv-mode">'+
      '<option value="exact" '+(spot.mode==='exact'?'selected':'')+'>All legal cards</option><option value="sampled" '+(spot.mode==='sampled'?'selected':'')+'>Seeded sample</option></select></label>'+
      '<div id="rv-sampling"><div class="fields">'+field('samplecount','Cards per next street',spot.count,'number','min="1" max="20" step="1"')+
      field('seed','Sample seed',spot.seed,'number','min="0" max="4294967295" step="1"')+'</div><p class="note">The same seed repeats the public cards. Extra cards are included if a private deal blocks the entire sample.</p></div></div>'+
      '<div class="fields">'+field('folded','Earlier folded wagers (optional)',spot.folded,'text',pre?'disabled':'')+field('iterations','Maximum iterations',spot.maxIter,'number','min="1" max="1000000"')+
      field('target','<span id="rv-target-label">Largest seat gain target ('+unit()+')</span>',spot.target,'number','min="0" step="any"')+'</div>'+
      '<p class="note">Enumeration includes every compatible private deal. Wide-range mode samples betting branches automatically for larger trees and stops at its strategy memory budget.</p>'+
      '<button id="rv-solve" class="btn primary big" data-rv-solve="1">Solve spot</button></fieldset>'+
      (busy&&!transferring?'<button class="btn" data-rv-stop="1">Stop and view current strategy</button>':'')+
      '<div aria-live="polite" id="rv-status"></div></div><div id="rv-output"></div>';
    updateControls();status();
  }
  function read() {
    if(!el('board'))return;
    for(const k of ['board','dealt','common','folded','mode','seed','privateMode','privateSeed','payoff','payouts','others','startStacks','abstraction','memoryMiB','batchDeals','precision'])spot[k]=el(k).value;
    if(el('engine'))spot.engine=el('engine').value;
    for(const k of ['anteType','ante','anteSeat'])if(el(k))spot[k]=el(k).value;
    for(const k of ['preOpen','preRaises','preCap'])if(el(k))spot[k]=el(k).value;
    if(el('strata'))spot.riverStrata=el('strata').checked;
    if(el('autosaveSeconds'))spot.autosaveSeconds=el('autosaveSeconds').value;
    if(el('preLimps'))spot.preLimps=el('preLimps').checked;
    spot.count=el('samplecount').value;spot.maxIter=el('iterations').value;spot.target=el('target').value;
    for(const street of streets){
      const k=street.toLowerCase();spot.tree[k]={bets:el('bets-'+k).value,raises:el('raises-'+k).value,maxBets:el('cap-'+k).value};
    }
    spot.seats.forEach((s,i)=>{
      for(const f of ['name','stack','prior','range'])s[f]=el(f+i).value;
      s.lead=el('lead'+i).checked;
    });
  }
  function clearResult(){restoredConfig=null;revision++;result=current=null;pos=[];error=progress='';}
  function number(v){return String(v).trim()===''?NaN:Number(v);}
  function anteCfg(){const a=String(spot.ante??'').trim();return {anteType:spot.anteType||'classic',ante:a===''?undefined:Number(a),anteSeat:Number(spot.anteSeat??-1)};}
  function parseFolded() {return spot.folded.trim()?spot.folded.trim().split(/[\s,]+/).map(number):[];}
  async function solve() {
    read();const loaded=restoredConfig;clearResult();busy=true;progress='Building the betting and runout trees…';render();
    try{
      const cfg=EM.multiwaySpotConfig(spot);
      // Desktop app: train eligible sampled studies in the native engine (Exact cards,
      // chip EV, full betting tree); everything else and every failure uses JavaScript.
      const nativeHost=typeof window!=='undefined'&&window.EM_NATIVE&&spot.engine!=='javascript'?
        {base:location.origin,threads:Math.max(1,Number(EM.NATIVE_INFO?.logicalCPUs||1))}:null;
      if(nativeHost&&!loaded)cfg.engine='native';
      result=await call('multi-solve',{native:nativeHost,cfg:loaded||cfg,autosaveSeconds:Number(spot.autosaveSeconds||0),labels:spot.seats.map(s=>s.name),maxIter:number(spot.maxIter),target:number(spot.target)},m=>{
        progress=trainingProgress(m);status();
      });
      current=result.node;trainingReady();progress=result.saveStatus||'';
    }catch(e){error=e.message;progress='';}finally{busy=false;render();}
  }
  async function view(path){
    const token=++revision;
    try{const got=await call('multi-node',{path});if(token===revision){current=got;pos=path;status();}}
    catch(e){if(token===revision){error=e.message;status();}}
  }
  root.addEventListener('input',e=>{
    if(busy || !e.target.id.startsWith('rv-') || e.target.id==='rv-count')return;
    if(e.target.id==='rv-flop-card' || e.target.id==='rv-load')return;
    if(e.target.id.startsWith('rv-resume-')){resume.iterations=number(el('resume-iterations').value);if(el('resume-memory'))resume.memoryMiB=number(el('resume-memory').value);return;}
    if(e.target.id.startsWith('rv-check-')){readChecks();return;}
    read();
    if(e.target.id==='rv-precision'){
      const preset={fast:[1,48,'compact',1000],balanced:[4,112,'detailed',10000],high:[16,224,'exact',50000]}[spot.precision];
      if(preset){[spot.batchDeals,spot.memoryMiB,spot.abstraction,spot.maxIter]=preset;clearResult();render();return;}
    }
    if(['rv-batchDeals','rv-memoryMiB','rv-abstraction'].includes(e.target.id)){spot.precision='custom';el('precision').value='custom';}
    if(e.target.id==='rv-privateMode'){spot.maxIter=spot.privateMode==='exact'?500:10000;el('iterations').value=spot.maxIter;}
    if(spot.notes){spot.notes='';if(el('notes'))el('notes').hidden=true;}
    if(e.target.id!=='rv-dealt')pristine=false;
    clearResult();updateControls();status();
  });
  root.addEventListener('change',e=>{
    if(e.target.id==='rv-load' && !busy){loadTraining(e.target.files?.[0]);return;}
    if(e.target.id==='rv-count' && !busy){
      read();const n=+e.target.value, start=spot.study==='linked'?'Preflop':spot.study==='shove'?'Shove / call':streets[boardLength()-3] || 'Flop';
      const dealt=Math.max(n,Number(spot.dealt));
      if(pristine)spot=example(n,start,dealt);
      else {
        const defaults=example(n,start,dealt);
        spot.dealt=dealt;
        spot.seats=Array.from({length:n},(_,i)=>spot.seats[i]||defaults.seats[i]);
        if(spot.study!=='postflop')spot.seats.forEach((seat,i)=>{seat.name=EM.pfPositions(n)[i];});
        spot.notes='';
      }
      clearResult();render();
    }
  });
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(d.rvRecover&&!busy)loadTraining(null,true);
    if(d.rvSave && !busy && result)saveTraining();
    if(d.rvResume && !busy && result)resumeTraining();
    if(d.rvSolve && !busy)solve();
    if(d.rvCheck && !busy && result)checkAccuracy();
    if(d.rvStop && busy)call('multi-stop').catch(e=>{error=e.message;status();});
    if(d.rvExample && !busy){spot=example(Math.min(spot.seats.length,8),d.rvExample,Number(spot.dealt));pristine=true;clearResult();render();}
    if(d.rvAct!=null && result && !busy)view(pos.concat(+d.rvAct));
    if(d.rvFlop && result && !busy){try{view(pos.concat({cards:EM.parseBoard(el('flop-card').value)}));}catch(e){error=e.message;status();}}
    if(d.rvCard!=null && result && !busy)view(pos.concat({card:+d.rvCard}));
    if(d.rvBack!=null && result && !busy)view(pos.slice(0,+d.rvBack));
  });
  return {render,get busy(){return busy;},importSpot(data){
    if(busy)return false;
    spot=Object.assign(example(data.seats.length,'Flop'),data);pristine=false;clearResult();return true;
  }};
};
EM.riverPanel=EM.multiwayPanel;
})(globalThis.EM || (globalThis.EM = {}));
