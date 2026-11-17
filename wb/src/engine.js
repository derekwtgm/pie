/* EightMax Test Workbench. Dependency-free simulation core, shared by UI and tests. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.EightMax=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='0.23.0';
function requireThat(x,message){if(!x)throw new Error(message);}
function chips(x){requireThat(Number.isSafeInteger(x)&&x>=0,'Invalid chip amount');return x;}
class RNG {
 constructor(seed){this.state=(seed>>>0)||1;}
 next(){let x=this.state;x^=x<<13;x^=x>>>17;x^=x<<5;this.state=x>>>0;return this.state/4294967296;}
}
function shuffled(rng){const d=Array.from({length:52},(_,i)=>i);for(let i=51;i>0;i--){const j=Math.floor(rng.next()*(i+1));[d[i],d[j]]=[d[j],d[i]];}return d;}
function card(c){return '23456789TJQKA'[Math.floor(c/4)]+'cdhs'[c%4];}
function rank5(cs){
 const rs=cs.map(c=>Math.floor(c/4)+2).sort((a,b)=>b-a), counts=new Map();rs.forEach(r=>counts.set(r,(counts.get(r)||0)+1));
 const groups=Array.from(counts,([r,n])=>({r,n})).sort((a,b)=>b.n-a.n||b.r-a.r);
 const flush=cs.every(c=>c%4===cs[0]%4);let straight=0;
 const uniq=Array.from(new Set(rs));if(uniq.length===5){if(uniq[0]-uniq[4]===4)straight=uniq[0];else if(uniq.join(',')==='14,5,4,3,2')straight=5;}
 let parts;
 if(flush&&straight)parts=[8,straight];
 else if(groups[0].n===4)parts=[7,groups[0].r,groups[1].r];
 else if(groups[0].n===3&&groups[1].n===2)parts=[6,groups[0].r,groups[1].r];
 else if(flush)parts=[5,...rs];
 else if(straight)parts=[4,straight];
 else if(groups[0].n===3)parts=[3,groups[0].r,...groups.slice(1).map(g=>g.r)];
 else if(groups[0].n===2&&groups[1].n===2)parts=[2,Math.max(groups[0].r,groups[1].r),Math.min(groups[0].r,groups[1].r),groups[2].r];
 else if(groups[0].n===2)parts=[1,groups[0].r,...groups.slice(1).map(g=>g.r)];
 else parts=[0,...rs];
 while(parts.length<6)parts.push(0);return parts.reduce((n,r)=>n*15+r,0);
}
function evaluate(cs){requireThat(cs.length===7&&new Set(cs).size===7&&cs.every(c=>Number.isInteger(c)&&c>=0&&c<52),'Need seven unique cards');let best=-1;for(let a=0;a<7;a++)for(let b=a+1;b<7;b++)best=Math.max(best,rank5(cs.filter((_,i)=>i!==a&&i!==b)));return best;}
// Contributions include antes. Every chip is distributed, including unmatched excess.
function distribute(players,board,dealer){
 const levels=Array.from(new Set(players.map(p=>p.total).filter(x=>x>0))).sort((a,b)=>a-b),awards=players.map(()=>0);let previous=0;
 for(const level of levels){const contributors=players.map((p,i)=>i).filter(i=>players[i].total>=level),amount=(level-previous)*contributors.length;previous=level;
  let eligible=contributors.filter(i=>!players[i].folded);requireThat(eligible.length>0,'Pot has no eligible player');
  let winners;if(eligible.length===1)winners=eligible;else{const ranks=eligible.map(i=>evaluate(players[i].cards.concat(board))),best=Math.max(...ranks);winners=eligible.filter((_,j)=>ranks[j]===best);}
  winners.sort((a,b)=>((a-dealer-1+players.length)%players.length)-((b-dealer-1+players.length)%players.length));
  const share=Math.floor(amount/winners.length);winners.forEach((i,j)=>awards[i]+=share+(j<amount%winners.length?1:0));
 }
 return awards;
}
class Table {
 constructor(id,seed,seats=8){requireThat(Number.isInteger(id)&&id>=1&&id<=10,'Table id out of range');requireThat(Number.isInteger(seats)&&seats>=2&&seats<=8,'Seat count out of range');this.id=id;this.rng=new RNG(seed);this.seats=seats;this.dealer=-1;this.hand=0;this.revision=0;this.epoch=0;this.status='ready';this.paused=false;this.error='';this.history=[];this.noteSequence=0;this.completed=0;this.actions=0;this.nextAt=0;this.deadline=0;this.players=Array.from({length:seats},(_,i)=>({name:i===0?'Test hero':'Test '+(i+1),stack:2500,bet:0,total:0,folded:false,cards:[],actedAt:null}));this.bankroll=seats*2500;this.board=[];this.street='ready';this.actor=-1;this.pending=new Set();this.currentBet=0;this.lastRaise=100;this.awards=[];}
 nextSeat(start,predicate){for(let n=1;n<=this.seats;n++){let i=(start+n)%this.seats;if(predicate(this.players[i],i))return i;}return -1;}
 pay(i,amount,street){const p=this.players[i],n=Math.min(chips(amount),p.stack);p.stack-=n;p.total+=n;if(street)p.bet+=n;return n;}
 pot(){return this.players.reduce((n,p)=>n+p.total,0);}
 startHand(){
  requireThat(!this.paused,'Table is paused');requireThat(this.status==='ready'||this.status==='complete','Hand still active');
  // Independent fixed-stack training hands: reset every hand, no tournament progression.
  this.players.forEach(p=>{p.stack=2500;p.bet=0;p.total=0;p.folded=false;p.cards=[];p.actedAt=null;});
  this.dealer=(this.dealer+1)%this.seats;this.hand++;this.revision++;this.board=[];this.deck=shuffled(this.rng);this.status='playing';this.street='preflop';this.currentBet=100;this.lastRaise=100;this.awards=[];
  this.players.forEach((p,i)=>{p.cards=[this.deck.pop(),this.deck.pop()];this.pay(i,10,false);});
  const sb=this.seats===2?this.dealer:(this.dealer+1)%this.seats,bb=(sb+1)%this.seats;this.sb=sb;this.bb=bb;this.pay(sb,50,true);this.pay(bb,100,true);
  this.pending=new Set(this.players.map((_,i)=>i));this.actor=this.nextSeat(bb,(_,i)=>this.pending.has(i));this.note('New hand; individual ante 0.1 BB');this.validate();
 }
 note(message){this.history.push({sequence:++this.noteSequence,hand:this.hand,revision:this.revision,street:this.street,message});if(this.history.length>250)this.history.shift();}
 legal(){
  if(this.status!=='playing'||this.paused||this.actor<0)return null;const p=this.players[this.actor],toCall=Math.max(0,this.currentBet-p.bet),max=p.bet+p.stack;
  const reopen=p.actedAt===null||this.currentBet-p.actedAt>=this.lastRaise;
  const opponentCanRespond=this.players.some((q,i)=>i!==this.actor&&!q.folded&&q.stack>0);
  return {toCall,callAmount:Math.min(toCall,p.stack),canCheck:toCall===0,canRaise:reopen&&opponentCanRespond&&max>this.currentBet,minRaiseTo:this.currentBet+this.lastRaise,maxRaiseTo:max};
 }
 request(type,amount,now){return {table:this.id,hand:this.hand,revision:this.revision,epoch:this.epoch,actor:this.actor,type,amount:amount===undefined?0:amount,expires:now+1500};}
 execute(r,now){
  requireThat(!this.paused&&this.status==='playing','Table unavailable');requireThat(r.table===this.id&&r.hand===this.hand&&r.revision===this.revision&&r.epoch===this.epoch&&r.actor===this.actor,'Stale or wrong-table action');requireThat(Number.isFinite(now)&&Number.isFinite(r.expires)&&now<=r.expires,'Decision expired');
  const l=this.legal(),i=this.actor,p=this.players[i];requireThat(l,'No legal action');requireThat(['fold','check','call','raise'].includes(r.type),'Unknown action');chips(r.amount);
  if(r.type==='check')requireThat(l.canCheck,'Cannot check facing a bet');
  if(r.type==='call')requireThat(l.toCall>0,'Nothing to call');
  if(r.type==='raise'){requireThat(l.canRaise,'Raise not reopened or no opponent can respond');requireThat(r.amount>this.currentBet&&r.amount<=l.maxRaiseTo,'Raise exceeds limits');requireThat(r.amount>=l.minRaiseTo||r.amount===l.maxRaiseTo,'Raise below minimum');}
  // All validation occurs before mutation.
  this.pending.delete(i);let message=p.name+' '+r.type;
  if(r.type==='fold')p.folded=true;
  else if(r.type==='call'){const paid=this.pay(i,l.callAmount,true);message+=' '+(paid/100).toFixed(2)+' BB';}
  else if(r.type==='raise'){
   const old=this.currentBet;this.pay(i,r.amount-p.bet,true);this.currentBet=r.amount;
   if(this.currentBet-old>=this.lastRaise){this.lastRaise=this.currentBet-old;this.pending=new Set(this.players.map((_,j)=>j).filter(j=>j!==i&&!this.players[j].folded&&this.players[j].stack>0));}
   else this.players.forEach((q,j)=>{if(j!==i&&!q.folded&&q.stack>0&&q.bet<this.currentBet)this.pending.add(j);});
   message+=' to '+(r.amount/100).toFixed(2)+' BB';
  }
  p.actedAt=this.currentBet;this.revision++;this.actions++;this.note(message);this.advance(i);this.validate();
 }
 advance(after){
  const live=this.players.map((_,i)=>i).filter(i=>!this.players[i].folded);
  if(live.length===1){const pot=this.pot();this.awards=this.players.map((_,i)=>i===live[0]?pot:0);this.finish();return;}
  this.pending.forEach(i=>{if(this.players[i].folded||this.players[i].stack===0)this.pending.delete(i);});
  // If only one player can still wager, only require an outstanding call.
  const able=live.filter(i=>this.players[i].stack>0);
  if(able.length<=1&&able.every(i=>this.players[i].bet>=this.currentBet))this.pending.clear();
  if(this.pending.size){this.actor=this.nextSeat(after,(_,i)=>this.pending.has(i));return;}
  if(this.street==='river'){this.showdown();return;}
  this.players.forEach(p=>{p.bet=0;p.actedAt=null;});this.currentBet=0;this.lastRaise=100;
  if(this.street==='preflop'){this.street='flop';this.deck.pop();this.board.push(this.deck.pop(),this.deck.pop(),this.deck.pop());}
  else{this.street=this.street==='flop'?'turn':'river';this.deck.pop();this.board.push(this.deck.pop());}
  this.revision++;this.note('Deal '+this.street);this.pending=new Set(able);
  if(able.length<=1){this.pending.clear();this.advance(this.dealer);}else this.actor=this.nextSeat(this.dealer,(_,i)=>this.pending.has(i));
 }
 showdown(){this.awards=distribute(this.players,this.board,this.dealer);this.finish();}
 finish(){const pot=this.pot();requireThat(this.awards.reduce((a,b)=>a+b,0)===pot,'Payout mismatch');this.players.forEach((p,i)=>{p.stack+=this.awards[i];p.total=0;p.bet=0;});this.status='complete';this.actor=-1;this.pending.clear();this.completed++;this.revision++;this.note('Hand complete: '+this.awards.map((a,i)=>a?this.players[i].name+' +'+(a/100).toFixed(2)+' BB':'').filter(Boolean).join(', '));}
 pause(){this.paused=true;this.epoch++;}
 resume(){this.paused=false;this.epoch++;}
 validate(){
  requireThat(this.players.reduce((s,p)=>s+chips(p.stack)+chips(p.total),0)===this.bankroll,'Chip conservation failed');
  const cards=this.board.concat(...this.players.map(p=>p.cards));requireThat(new Set(cards).size===cards.length,'Duplicate card');
  this.players.forEach(p=>{chips(p.bet);requireThat(p.bet<=p.total,'Street contribution exceeds total');});
  if(this.status==='playing')requireThat(this.actor>=0&&!this.players[this.actor].folded&&this.players[this.actor].stack>0,'Invalid acting seat');return true;
 }
 snapshot(){return {id:this.id,hand:this.hand,revision:this.revision,status:this.status,street:this.street,dealer:this.dealer,actor:this.actor,board:this.board.slice(),pot:this.pot(),currentBet:this.currentBet,players:this.players.map(p=>({name:p.name,stack:p.stack,bet:p.bet,total:p.total,folded:p.folded,cards:p.cards.slice()})),awards:this.awards.slice()};}
}
// Deliberately simple scripted test policy. No solver, EV, GTO or learning claims.
function policy(t){const l=t.legal();requireThat(l,'No decision available');const p=t.players[t.actor],r=t.rng.next();let type=l.canCheck?'check':'call',amount=0;
 if(l.toCall>0&&r<0.27)type='fold';
 if(l.canRaise&&r>0.78){type='raise';amount=Math.min(l.maxRaiseTo,Math.max(l.minRaiseTo,t.currentBet+Math.floor((t.pot()*0.5)/25)*25));}
 return {type,amount};}
class Coordinator {
 constructor(count=10,seed=4127){requireThat(Number.isInteger(count)&&count>=1&&count<=10,'Use 1 to 10 tables');this.tables=Array.from({length:count},(_,i)=>new Table(i+1,seed+i*139));this.running=false;this.stopped=false;this.events=[];this.recording=[];this.totalActions=0;this.recordLimit=1200;this.sequence=0;}
 event(kind,table,message){this.events.push({sequence:++this.sequence,kind,table,message});if(this.events.length>250)this.events.shift();}
 start(now){requireThat(Number.isFinite(now),'Invalid clock');requireThat(!this.stopped,'Reset required after emergency stop');this.running=true;this.tables.forEach((t,i)=>{if(!t.paused){t.nextAt=now+i*40;t.deadline=now+10000+i*40;}});this.event('start',0,'Simulation started');}
 pause(){this.running=false;this.tables.forEach(t=>t.epoch++);this.event('pause',0,'All simulation tables paused');}
 stop(){this.running=false;this.stopped=true;this.tables.forEach(t=>t.pause());this.event('stop',0,'Emergency stop latched; reset required');}
 record(t,action){this.recording.push({sequence:this.sequence,action,snapshot:t.snapshot()});if(this.recording.length>this.recordLimit)this.recording.shift();}
 tick(now){if(!this.running||this.stopped)return null;requireThat(Number.isFinite(now),'Invalid clock');
  const due=this.tables.filter(t=>!t.paused&&t.nextAt<=now).sort((a,b)=>a.deadline-b.deadline||a.id-b.id);if(!due.length)return null;const t=due[0];
  const previousNote=t.noteSequence;try{if(t.status==='ready'||t.status==='complete')t.startHand();else{const a=policy(t),r=t.request(a.type,a.amount,now);requireThat(this.running&&!this.stopped,'Execution disabled');t.execute(r,now);this.totalActions++;}t.nextAt=now+350;t.deadline=now+10000;const changes=t.history.filter(e=>e.sequence>previousNote);changes.forEach(e=>this.event('state',t.id,e.message));this.record(t,changes.map(e=>e.message).join(' · '));}
  catch(e){t.error=e.message;t.pause();this.event('error',t.id,e.message);}return t.id;
 }
 export(){return {format:'eightmax-workbench-replay',version:1,appVersion:VERSION,mode:'simulation',strategy:'scripted test policy; no solver',units:'100 chips = 1 BB',events:this.events,frames:this.recording};}
}
function parseReplay(text){
 requireThat(typeof text==='string'&&text.length<=12000000,'Replay exceeds 12 MB');const data=JSON.parse(text);
 requireThat(data&&data.format==='eightmax-workbench-replay'&&data.version===1&&data.mode==='simulation','Unsupported replay format');requireThat(Array.isArray(data.frames)&&data.frames.length>0&&data.frames.length<=1200,'Replay must contain 1 to 1200 frames');
 data.frames.forEach(f=>{const s=f.snapshot;requireThat(s&&Number.isInteger(s.id)&&s.id>=1&&s.id<=10&&Number.isInteger(s.hand)&&s.hand>=1,'Invalid replay table');requireThat(['playing','complete'].includes(s.status)&&['preflop','flop','turn','river'].includes(s.street),'Invalid replay state');requireThat(Array.isArray(s.players)&&s.players.length>=2&&s.players.length<=8,'Invalid replay seats');requireThat(Number.isInteger(s.actor)&&s.actor>=-1&&s.actor<s.players.length&&Number.isInteger(s.dealer)&&s.dealer>=0&&s.dealer<s.players.length,'Invalid seat index');chips(s.pot);chips(s.currentBet);const all=[];requireThat(Array.isArray(s.board)&&s.board.length<=5,'Invalid replay board');all.push(...s.board);s.players.forEach(p=>{chips(p.stack);chips(p.bet);chips(p.total);requireThat(typeof p.name==='string'&&p.name.length<=80&&typeof p.folded==='boolean'&&Array.isArray(p.cards)&&p.cards.length===2,'Invalid replay player');all.push(...p.cards);});requireThat(all.every(c=>Number.isInteger(c)&&c>=0&&c<52)&&new Set(all).size===all.length,'Invalid or duplicate replay card');requireThat(typeof f.action==='string'&&f.action.length<=500,'Invalid replay action');});return data;
}
class SolverBridge {
 constructor(){this.status='disconnected';this.protocol=1;}
 capabilities(){return {protocol:1,connected:false,strategyAvailable:false,reason:'EightMax adapter is not connected in milestone 0.1'};}
 request(){throw new Error('No external strategy engine connected');}
}
return {VERSION,RNG,Table,Coordinator,SolverBridge,card,evaluate,distribute,policy,parseReplay};
});
