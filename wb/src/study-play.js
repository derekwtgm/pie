/* Controlled off-table play follows the SAME trained EightMax study and action paths. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkbenchPlay=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';const ok=(x,m)=>{if(!x)throw Error(m);};
function rng(seed){let state=seed>>>0;return ()=>{state=(state+0x6d2b79f5)>>>0;let x=Math.imul(state^(state>>>15),state|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};}
function pick(weights,random){let total=weights.reduce((a,b)=>a+b,0);ok(total>0&&weights.every(x=>Number.isFinite(x)&&x>=0),'Invalid selection weights');let u=random()*total;for(let i=0;i<weights.length;i++){u-=weights[i];if(u<0)return i;}return weights.length-1;}
function deal(spec,random){
 for(let attempt=0;attempt<20000;attempt++){const used=new Set(spec.board),hands=[];let compatible=true;for(const range of spec.hands){const row=range[pick(range.map(h=>h[3]),random)],h={id:row[0],a:row[1],b:row[2],w:row[3]};if(used.has(h.a)||used.has(h.b)){compatible=false;break;}used.add(h.a);used.add(h.b);hands.push(h);}if(!compatible)continue;const runout=spec.board.slice();while(runout.length<5){const card=Math.floor(random()*52);if(!used.has(card)){used.add(card);runout.push(card);}}return {hands,runout};}throw Error('Ranges did not yield a compatible simulated deal');
}
function play(EM,prepared,options={},clock=()=>performance.now()){
 const {game,spec}=prepared,seed=options.seed===undefined?771:options.seed;ok(Number.isInteger(seed)&&seed>=0&&seed<=4294967295,'Invalid practice seed');ok(!prepared.options.config.icm,'Controlled play currently supports chip-EV studies only');
 const random=rng(seed),chosen=deal(spec,random),start=clock(),frames=[],steps=[];let key='r',status='step-limit',reason='Practice exceeded 128 state transitions',awards=null,finalBoard=spec.board.slice();
 for(let index=0;index<128;index++){
  if(clock()-start>(options.timeMs||4000)){status='deadline';reason='Practice budget expired; no further action selected';break;}
  const v=game.view(steps),frame={index,path:key,kind:v.kind,actor:v.seat,board:v.board.slice(),pot:v.pot,behind:v.behind.slice(),live:v.live.slice(),action:null};frames.push(frame);finalBoard=v.board.slice();
  if(v.kind==='terminal'){
   finalBoard=chosen.runout.slice();awards=spec.hands.map(()=>0);for(const pot of v.pots){ok(pot.eligible.length>0&&pot.eligible.every(p=>p>=0&&p<chosen.hands.length),'Invalid settlement eligibility');const scores=pot.eligible.map(p=>EM.evalCards(finalBoard.concat([chosen.hands[p].a,chosen.hands[p].b]))),best=Math.max(...scores),winners=pot.eligible.filter((_,i)=>scores[i]===best);winners.forEach(p=>awards[p]+=pot.amount/winners.length);}
   ok(Math.abs(awards.reduce((a,b)=>a+b,0)-v.pot)<1e-7,'Controlled hand payout mismatch');status='complete';reason='All decisions used available EightMax policy rows from this study';break;
  }
  if(v.kind==='chance'){const next=v.board.length===0?chosen.runout.slice(0,3):chosen.runout[v.board.length];steps.push(Array.isArray(next)?{cards:next}:{card:next});key+='c';continue;}
  const h=chosen.hands[v.seat],probabilities=game.averageAt(key,v.board,v.seat,h);
  if(!probabilities){status='blocked';reason='No stored strategy for seat '+(v.seat+1)+' at '+key+'. Increase training coverage; no fallback action was taken.';break;}
  const mix=Array.from(probabilities);ok(mix.length===v.actions.length,'Strategy/action menu mismatch');const slot=pick(mix,random);frame.action={slot,label:v.actions[slot].label,frequencies:mix};steps.push(slot);key+=slot;
 }
 return {format:'eightmax-controlled-hand',version:1,status,reason,seed,elapsedMs:clock()-start,cards:chosen.hands.map(h=>[h.a,h.b]),runout:chosen.runout,frames,awards,finalBoard,units:'continuous BB in the study abstraction'};
}
function validate(t){
 ok(t&&t.format==='eightmax-controlled-hand'&&t.version===1&&['complete','blocked','deadline','step-limit'].includes(t.status),'Invalid controlled hand');ok(typeof t.reason==='string'&&t.reason.length<=1000&&Array.isArray(t.cards)&&t.cards.length>=2&&t.cards.length<=8,'Invalid controlled hand seats');
 ok(Number.isInteger(t.seed)&&t.seed>=0&&t.seed<=4294967295&&Number.isFinite(t.elapsedMs)&&t.elapsedMs>=0,'Invalid practice seed or timing');ok(Array.isArray(t.runout)&&t.runout.length===5,'Invalid runout');ok(Array.isArray(t.finalBoard)&&[0,3,4,5].includes(t.finalBoard.length)&&t.finalBoard.every((c,i)=>c===t.runout[i])&&(t.status!=='complete'||t.finalBoard.length===5),'Invalid final board');const all=t.runout.slice();t.cards.forEach(h=>{ok(Array.isArray(h)&&h.length===2,'Invalid private cards');all.push(...h);});ok(all.every(c=>Number.isInteger(c)&&c>=0&&c<52)&&new Set(all).size===all.length,'Duplicate controlled-hand cards');
 ok(Array.isArray(t.frames)&&t.frames.length<=128,'Invalid controlled hand frames');const n=t.cards.length;
 t.frames.forEach((f,i)=>{ok(f.index===i&&typeof f.path==='string'&&/^r[0-6c]*$/.test(f.path)&&['player','chance','terminal'].includes(f.kind),'Invalid practice path');ok(Number.isInteger(f.actor)&&f.actor>=-1&&f.actor<n&&Number.isFinite(f.pot)&&f.pot>=0,'Invalid practice actor or pot');ok(Array.isArray(f.behind)&&f.behind.length===n&&f.behind.every(x=>Number.isFinite(x)&&x>=0)&&Array.isArray(f.live)&&f.live.length===n&&f.live.every(x=>typeof x==='boolean'),'Invalid practice stacks');ok(Array.isArray(f.board)&&[0,3,4,5].includes(f.board.length)&&f.board.every((c,j)=>c===t.runout[j]),'Invalid practice board');if(f.action){const a=f.action;ok(f.kind==='player'&&Number.isInteger(a.slot)&&a.slot>=0&&Array.isArray(a.frequencies)&&a.frequencies.length<=7&&a.slot<a.frequencies.length&&a.frequencies.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(a.frequencies.reduce((x,y)=>x+y,0)-1)<1e-6,'Invalid practice action');ok(typeof a.label==='string'&&a.label.length<=100,'Invalid action label');}});
 if(t.status==='complete'){ok(t.frames.length>0&&t.frames[t.frames.length-1].kind==='terminal'&&Array.isArray(t.awards)&&t.awards.length===n&&t.awards.every(x=>Number.isFinite(x)&&x>=0)&&Math.abs(t.awards.reduce((a,b)=>a+b,0)-t.frames[t.frames.length-1].pot)<1e-7,'Invalid complete settlement');}else ok(t.awards===null,'Unfinished hand cannot award chips');return t;
}
return {rng,pick,deal,play,validate};
});
