/* Exact public-state matching for manually requested, offline reviewed-position studies. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./observations.js'),require('./round-audit.js'),require('./settlement.js'),require('./study-adapter.js'));
 else root.WorkbenchReviewed=factory(root.WorkbenchObservations,root.WorkbenchRound,root.WorkbenchSettlement,root.WorkbenchStudy);
})(typeof globalThis!=='undefined'?globalThis:this,function(O,R,S,A){
'use strict';
const FORMAT='eightmax-reviewed-position',MAX_STATES=128,MAX_CHARS=200000,MAX_PATH=128;
const copy=x=>JSON.parse(JSON.stringify(x)),ok=(v,m)=>{if(!v)throw Error(m);};
function integer(v,min,max,name){ok(Number.isSafeInteger(v)&&v>=min&&v<=max,'Invalid reviewed '+name);}
function keys(v,fields,name){ok(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.prototype.hasOwnProperty.call(v,k)),'Unsupported '+name+' fields');}
function card(c){return '23456789TJQKA'.indexOf(c[0].toUpperCase())*4+'cdhs'.indexOf(c[1].toLowerCase());}
function near(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-7,128*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b)));}
function validate(value){
 const text=JSON.stringify(value);ok(text&&text.length<=MAX_CHARS,'Reviewed position exceeds 200,000 characters');const p=JSON.parse(text);
 keys(p,['format','version','source','table','hand','frames','states','decisionReady'],'reviewed position');
 ok(p.format===FORMAT&&p.version===1&&p.decisionReady===false&&['synthetic','recorded-observation'].includes(p.source),'Unsupported reviewed position');
 integer(p.table,1,10,'table');ok(typeof p.hand==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(p.hand),'Invalid reviewed hand identity');
 ok(Array.isArray(p.states)&&p.states.length>=1&&p.states.length<=MAX_STATES&&Array.isArray(p.frames)&&p.frames.length===p.states.length,'Use 1 to 128 complete accepted snapshots');
 p.frames.forEach((f,i)=>{integer(f,0,4999,'source index');ok(!i||f>p.frames[i-1],'Reviewed source indices must increase');});
 p.states=p.states.map(O.snapshot);for(const s of p.states){ok(!s.phase&&!s.showdown,'Accounting/exposed-opponent phases are outside reviewed betting studies');if(s.street!=='preflop')ok(s.seats.filter(p=>!p.folded).length<=6,'Reviewed postflop studies support at most six live seats');}
 const root=p.states[0];ok(root.roundStart,'Reviewed study needs an explicit betting anchor');let round=new R.Round(root,root.roundStart.dealer);
 // This also enforces supported street-start stacks/posts and excludes unknown history.
 const base=R.study(root,round,root.seats.map(s=>s.folded?'-':'random')),transitions=[];
 for(let i=1;i<p.states.length;i++){const before=p.states[i-1],after=p.states[i];S.continuity(before,after);const t=round.transition(before,after);round=t.round;transitions.push({action:t.action,streetChanged:t.streetChanged});}
 ok(!round.closed&&p.states.at(-1).actor>=0,'Select an open acting position before round closure or settlement');
 return {proof:p,root,target:p.states.at(-1),originalSeats:base.originalSeats,transitions};
}
function draft(value,ranges){const model=validate(value),round=new R.Round(model.root,model.root.roundStart.dealer),base=R.study(model.root,round,ranges);return {...base,proof:model.proof,scope:'Captured offline betting history. Root ranges/menus are explicit assumptions; no solve starts until requested.'};}
function latestStreet(value){
 const model=validate(value),index=model.proof.states.findIndex(s=>s.street===model.target.street),p=copy(model.proof);
 if(index>0){p.frames=p.frames.slice(index);p.states=p.states.slice(index);if(!p.states[0].roundStart)p.states[0].roundStart={dealer:model.root.roundStart.dealer};}
 return validate(p).proof;
}
function rootConfig(config,model){
 const cfg=A.input({config}).config,root=model.root,order=model.originalSeats,bb=root.bigBlind,pre=root.street==='preflop';
 ok(!cfg.icm,'Reviewed-node analysis currently supports chip-EV studies only');
 ok((cfg.board.replace(/[\s,]/g,'').match(/../g)||[]).map(card).join(',')===root.board.map(card).join(','),'Study root board differs from the reviewed anchor');
 ok(cfg.stacks.length===order.length&&cfg.stacks.every((x,i)=>near(x*bb,root.seats[order[i]].stack+(pre?root.seats[order[i]].committed:0))),'Study root stacks differ from the reviewed anchor');
 if(pre){ok(cfg.preflop&&cfg.preflop.mode==='linked'&&cfg.dealt===root.seats.length&&near(cfg.common,0),'Reviewed preflop mapping requires its linked full-post root');
  const ante=cfg.ante===undefined||cfg.ante===null||cfg.ante==='' ? .1 : Number(cfg.ante);ok((cfg.anteType||'classic')==='classic'&&near(ante,.1),'Reviewed posts require individual 0.1 BB antes');
  ok((cfg.prior||[]).every(x=>x===0)&&!(cfg.folded||[]).length,'Preflop root cannot add earlier contributions');
 }else{ok(!cfg.preflop&&cfg.dealt===undefined,'Postflop reviewed contributions already include posts; do not add dealt-seat antes');
  ok(near(cfg.common*bb,root.deadMoney),'Study root common chips differ from reviewed evidence');
  const prior=cfg.prior||Array(order.length).fill(0),folded=cfg.folded||[],expected=root.seats.filter(p=>p.folded).map(p=>p.committed);
  ok(prior.length===order.length&&prior.every((x,i)=>near(x*bb,root.seats[order[i]].committed)),'Study root contributions differ from reviewed evidence');
  ok(folded.length===expected.length&&folded.every((x,i)=>near(x*bb,expected[i])),'Study folded contributions differ from reviewed evidence');
 }
 return cfg;
}
function pathKey(steps){return 'r'+steps.map(x=>typeof x==='number'?String(x):'c').join('');}
function samePublic(view,s,model,actor=true,board=true){
 const {originalSeats:order,root}=model,bb=root.bigBlind;
 if(!near(view.pot*bb,s.pot)||view.behind.length!==order.length||view.live.length!==order.length)return false;
 if(!order.every((seat,i)=>near(view.behind[i]*bb,s.seats[seat].stack)&&view.live[i]===!s.seats[seat].folded))return false;
 if(board&&view.board.join(',')!==s.board.map(card).join(','))return false;
 if(actor){if(s.actor>=0){if(view.kind!=='player'||order[view.seat]!==s.actor)return false;}else if(view.kind==='player'||view.seat!==-1)return false;}
 return true;
}
function possible(label,action,bb){
 if(action.type==='fold')return label==='Fold';if(action.type==='check')return label==='Check';if(action.type==='call')return /^Call /.test(label);
 if(!/^(Bet |Raise to |All-in to )/.test(label))return false;
 // Labels are a search hint only. Exact public chip/actor/card matching decides.
 const amount=Number(label.match(/([0-9.]+)$/)?.[1]);return Number.isFinite(amount)&&Math.abs(amount-action.to/bb)<=.000501;
}
function replay(EM,prepared,value,options={}){
 const begin=(options.clock||(()=>performance.now()))(),clock=options.clock||(()=>performance.now()),budget=options.timeMs===undefined?4000:options.timeMs;
 const model=validate(value);rootConfig(prepared.options.config,model);const cache=new Map();
 const get=steps=>{ok(steps.length<=MAX_PATH,'Reviewed action path exceeds 128 transitions');ok(clock()-begin<=budget,'Reviewed path validation time budget exceeded');const key=JSON.stringify(steps);let v=cache.get(key);if(!v){const raw=prepared.game.view(steps);v={kind:raw.kind,seat:raw.seat,pot:raw.pot,board:Array.from(raw.board),behind:Array.from(raw.behind),live:Array.from(raw.live),...(raw.actions?{actions:raw.actions.map(a=>({label:a.label}))}:{})};cache.set(key,v);}ok(clock()-begin<=budget,'Reviewed path validation time budget exceeded');return v;};
 let steps=[],view=get(steps);ok(samePublic(view,model.root,model),'EightMax root does not match the reviewed public state');
 for(let i=1;i<model.proof.states.length;i++){
  const after=model.proof.states[i],t=model.transitions[i-1],matches=[];
  const candidates=t.action?view.actions.map((a,slot)=>({a,slot})).filter(x=>possible(x.a.label,t.action,model.root.bigBlind)):[{slot:null}];
  for(const {slot} of candidates){
   const next=steps.slice();if(slot!==null)next.push(slot);let v=get(next);
   if(t.streetChanged){if(v.kind!=='chance'||!samePublic(v,after,model,false,false))continue;
    const before=model.proof.states[i-1],cards=after.board.slice(before.board.length).map(card);next.push(before.board.length===0?{cards}:{card:cards[0]});v=get(next);
   }
   if(samePublic(v,after,model))matches.push({steps:next,view:v});
  }
  ok(matches.length===1,matches.length?'Ambiguous study actions share the observed public state':t.action?'No exact study action for seat '+(t.action.seat+1)+' '+t.action.type+' to '+t.action.to+' chips. Review explicit bet/raise sizes; no amount was rounded.':'Reviewed board/round transition does not match this study');
  ({steps,view}=matches[0]);ok(steps.length<=MAX_PATH,'Reviewed action path exceeds 128 transitions');
 }
 ok(view.kind==='player','Reviewed target is not a player decision');return {model,steps,view,path:pathKey(steps),validationMs:clock()-begin};
}
function query(EM,prepared,mapped){
 const {model,view,path,steps}=mapped,actor=view.seat,publicCards=new Set(view.board),rows=[];
 for(const [id,a,b,weight] of prepared.spec.hands[actor]){if(publicCards.has(a)||publicCards.has(b))continue;const average=prepared.game.averageAt(path,view.board,actor,{id,a,b,w:weight});
  if(average)ok(average.length===view.actions.length,'Reviewed strategy/action width mismatch');rows.push({cards:[a,b],weight,average:average?Array.from(average):null,stored:average!==null});}
 ok(rows.length>0,'Acting input range has no hands compatible with the reviewed board');
 const originalSeat=model.originalSeats[actor],heroKnown=model.target.heroSeat===originalSeat,heroCards=model.target.hero.map(card),heroRow=heroKnown?rows.findIndex(h=>h.cards.slice().sort((a,b)=>a-b).join(',')===heroCards.slice().sort((a,b)=>a-b).join(',')):-1;
 return {format:'eightmax-reviewed-node',version:1,engine:A.ENGINE,rootConfigKey:A.canonical(prepared.options.config),proof:copy(model.proof),originalSeats:model.originalSeats.slice(),path,steps:copy(steps),actor,originalSeat,board:view.board.slice(),pot:view.pot,behind:view.behind.slice(),actions:view.actions.map((a,slot)=>({slot,label:a.label})),hands:rows,heroKnown,heroRowIndex:heroRow<0?null:heroRow,quality:{convergenceVerified:false,evAvailable:false,rangePosteriorComputed:false},decisionReady:false,scope:'Stored policies at an exact matched offline path. Input weights are root assumptions, not posterior probabilities. Missing rows remain unavailable; no EV or convergence certificate.'};
}
function validateNode(node,config){
 const n=copy(node);ok(n&&n.format==='eightmax-reviewed-node'&&n.version===1&&n.engine&&n.engine.build===A.ENGINE.build&&n.decisionReady===false,'Unsupported reviewed-node report');
 const model=validate(n.proof),cfg=rootConfig(config,model);ok(n.rootConfigKey===A.canonical(cfg),'Reviewed-node report belongs to different root settings');
 ok(A.canonical(n.originalSeats)===A.canonical(model.originalSeats),'Reviewed seat mapping differs');integer(n.actor,0,model.originalSeats.length-1,'report actor');ok(n.originalSeat===model.originalSeats[n.actor]&&n.originalSeat===model.target.actor,'Reviewed report actor differs from evidence');
 ok(Array.isArray(n.steps)&&n.steps.length<=MAX_PATH,'Invalid reviewed path steps');for(const step of n.steps){if(typeof step==='number')integer(step,0,6,'action slot');else{ok(step&&typeof step==='object','Invalid public-card step');if(step.cards){keys(step,['cards'],'flop step');ok(Array.isArray(step.cards)&&step.cards.length===3&&new Set(step.cards).size===3,'Invalid reviewed flop');step.cards.forEach(c=>integer(c,0,51,'flop card'));}else{keys(step,['card'],'public-card step');integer(step.card,0,51,'public card');}}}
 ok(n.path===pathKey(n.steps)&&/^r[0-6c]*$/.test(n.path),'Reviewed path key disagrees with steps');
 const expectedSteps=[];for(let i=0;i<model.transitions.length;i++){const t=model.transitions[i];if(t.action)expectedSteps.push('action');if(t.streetChanged){const before=model.proof.states[i],after=model.proof.states[i+1],cards=after.board.slice(before.board.length).map(card);expectedSteps.push(before.board.length===0?{cards}:{card:cards[0]});}}
 ok(n.steps.length===expectedSteps.length&&expectedSteps.every((s,i)=>s==='action'?typeof n.steps[i]==='number':A.canonical(s)===A.canonical(n.steps[i])),'Reviewed path omits/changes observed actions or public cards');
 ok(Array.isArray(n.board)&&n.board.join(',')===model.target.board.map(card).join(',')&&near(n.pot*model.root.bigBlind,model.target.pot),'Reviewed report board/pot differs');
 ok(Array.isArray(n.behind)&&n.behind.length===model.originalSeats.length&&n.behind.every((x,i)=>near(x*model.root.bigBlind,model.target.seats[model.originalSeats[i]].stack)),'Reviewed report stacks differ');
 ok(Array.isArray(n.actions)&&n.actions.length>=1&&n.actions.length<=7,'Invalid reviewed action menu');n.actions.forEach((a,i)=>ok(a.slot===i&&typeof a.label==='string'&&a.label.length<=100,'Invalid reviewed action label'));
 ok(Array.isArray(n.hands)&&n.hands.length>=1&&n.hands.length<=1326,'Invalid reviewed hand range');const seen=new Set();
 for(const h of n.hands){ok(Array.isArray(h.cards)&&h.cards.length===2&&h.cards[0]!==h.cards[1]&&h.cards.every(c=>Number.isInteger(c)&&c>=0&&c<52&&!n.board.includes(c)),'Invalid reviewed private cards');const key=h.cards.slice().sort((a,b)=>a-b).join(',');ok(!seen.has(key),'Duplicate reviewed hand');seen.add(key);ok(typeof h.weight==='number'&&Number.isFinite(h.weight)&&h.weight>0&&h.weight<=1&&typeof h.stored==='boolean','Invalid reviewed input weight');
  if(h.average===null)ok(!h.stored,'Missing reviewed policy cannot claim a stored row');else ok(h.stored&&Array.isArray(h.average)&&h.average.length===n.actions.length&&h.average.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(h.average.reduce((a,b)=>a+b,0)-1)<1e-6,'Invalid reviewed frequencies');
 }
 const heroKnown=model.target.heroSeat===n.originalSeat,hero=model.target.hero.map(card).sort((a,b)=>a-b).join(','),index=heroKnown?n.hands.findIndex(h=>h.cards.slice().sort((a,b)=>a-b).join(',')===hero):-1;
 ok(n.heroKnown===heroKnown&&n.heroRowIndex===(index<0?null:index),'Reviewed hero label contradicts evidence');
 ok(n.quality&&n.quality.convergenceVerified===false&&n.quality.evAvailable===false&&n.quality.rangePosteriorComputed===false,'Unsupported reviewed result quality claim');return n;
}
return {FORMAT,MAX_STATES,MAX_CHARS,MAX_PATH,validate,draft,latestStreet,rootConfig,replay,query,validateNode,pathKey};
});
