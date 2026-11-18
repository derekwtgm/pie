/* Validated, resumable simulation state. Does not load or execute poker-client actions. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine.js'));else root.EightMaxSession=factory(root.EightMax);})(typeof globalThis!=='undefined'?globalThis:this,function(E){
'use strict';
const FORMAT='eightmax-simulation-session',MAX_BYTES=20000000;
const ok=(v,m)=>{if(!v)throw Error(m);};
function integer(v,min,max,label){ok(Number.isSafeInteger(v)&&v>=min&&v<=max,'Invalid '+label);return v;}
function boolean(v,label){ok(typeof v==='boolean','Invalid '+label);return v;}
function text(v,max,label){ok(typeof v==='string'&&v.length<=max,'Invalid '+label);return v;}
const copy=x=>JSON.parse(JSON.stringify(x));
function save(c){return {format:FORMAT,version:1,appVersion:E.VERSION,stopped:c.stopped,totalActions:c.totalActions,sequence:c.sequence,events:copy(c.events),recording:copy(c.recording),tables:c.tables.map(t=>{
 const s={};for(const k of ['id','seats','dealer','hand','revision','epoch','status','paused','error','history','noteSequence','completed','actions','players','bankroll','board','street','actor','currentBet','lastRaise','awards'])s[k]=copy(t[k]);s.rng=t.rng.state;s.deck=(t.deck||[]).slice();s.pending=Array.from(t.pending);s.sb=t.sb===undefined?-1:t.sb;s.bb=t.bb===undefined?-1:t.bb;return s;
})};}
function load(serialized){
 ok(typeof serialized==='string'&&serialized.length<=MAX_BYTES,'Session exceeds 20 MB');const d=JSON.parse(serialized);ok(d&&d.format===FORMAT&&d.version===1,'Unsupported simulation session');
 ok(Array.isArray(d.tables)&&d.tables.length>=1&&d.tables.length<=10,'Use 1 to 10 session tables');boolean(d.stopped,'stop state');integer(d.totalActions,0,100000000,'action count');integer(d.sequence,0,1000000000,'event sequence');
 const c=new E.Coordinator(d.tables.length);let actionSum=0;
 c.tables=d.tables.map((s,index)=>{
  ok(s&&s.id===index+1,'Session table identity mismatch');integer(s.seats,2,8,'seats');const t=new E.Table(s.id,1,s.seats);
  for(const k of ['hand','revision','epoch','noteSequence','completed','actions'])t[k]=integer(s[k],0,1000000000,k);
  integer(s.dealer,s.hand?0:-1,s.seats-1,'dealer');ok(['ready','playing','complete'].includes(s.status),'Invalid table status');ok(['ready','preflop','flop','turn','river'].includes(s.street),'Invalid street');
  ok((s.hand===0)===(s.status==='ready')&&(s.status==='ready')===(s.street==='ready'),'Inconsistent hand status');
  t.dealer=s.dealer;t.status=s.status;t.street=s.street;t.epoch++;t.paused=boolean(s.paused,'pause');t.error=text(s.error,1000,'error');ok(!t.error||t.paused,'Error table must be paused');
  integer(s.actor,-1,s.seats-1,'actor');t.actor=s.actor;t.bankroll=integer(s.bankroll,s.seats*2500,s.seats*2500,'bankroll');t.currentBet=integer(s.currentBet,0,t.bankroll,'current bet');t.lastRaise=integer(s.lastRaise,1,t.bankroll,'last raise');t.rng.state=integer(s.rng,1,4294967295,'random state');
  ok(Array.isArray(s.players)&&s.players.length===s.seats,'Invalid players');
  t.players=s.players.map(p=>{ok(p&&Array.isArray(p.cards)&&p.cards.length===(s.hand?2:0),'Invalid hole cards');return {name:text(p.name,80,'name'),stack:integer(p.stack,0,t.bankroll,'stack'),bet:integer(p.bet,0,t.bankroll,'street bet'),total:integer(p.total,0,t.bankroll,'contribution'),folded:boolean(p.folded,'fold state'),cards:p.cards.slice(),actedAt:p.actedAt===null?null:integer(p.actedAt,0,t.bankroll,'last acted bet')};});
  ok(Array.isArray(s.board)&&Array.isArray(s.deck),'Invalid card arrays');t.board=s.board.slice();t.deck=s.deck.slice();
  const expected={ready:0,preflop:0,flop:3,turn:4,river:5}[t.street];ok(t.board.length===expected,'Street and board disagree');
  const all=t.deck.concat(t.board,...t.players.map(p=>p.cards));ok(all.every(x=>Number.isInteger(x)&&x>=0&&x<52)&&new Set(all).size===all.length,'Invalid or duplicate session cards');
  const burned={ready:52,preflop:0,flop:1,turn:2,river:3}[t.street];ok(all.length+burned===52,'Deck length does not match dealt cards');
  ok(Array.isArray(s.pending)&&new Set(s.pending).size===s.pending.length,'Invalid pending seats');s.pending.forEach(i=>{integer(i,0,t.seats-1,'pending seat');ok(!t.players[i].folded&&t.players[i].stack>0,'Pending player cannot act');});t.pending=new Set(s.pending);
  if(t.status==='playing'){ok(t.pending.has(t.actor),'Actor is not pending');ok(t.currentBet>=Math.max(...t.players.map(p=>p.bet)),'Bet below a contribution');}
  else ok(t.actor===-1&&t.pending.size===0&&t.pot()===0,'Idle table contains action or pot');
  ok(Array.isArray(s.awards)&&(s.awards.length===0||s.awards.length===t.seats),'Invalid awards');t.awards=s.awards.map(x=>integer(x,0,t.bankroll,'award'));
  ok(Array.isArray(s.history)&&s.history.length<=250,'History too large');t.history=s.history.map(h=>({sequence:integer(h.sequence,1,t.noteSequence,'note sequence'),hand:integer(h.hand,1,t.hand,'note hand'),revision:integer(h.revision,0,t.revision,'note revision'),street:text(h.street,12,'note street'),message:text(h.message,1000,'note message')}));
  t.sb=integer(s.sb,t.hand?0:-1,t.seats-1,'small blind');t.bb=integer(s.bb,t.hand?0:-1,t.seats-1,'big blind');t.nextAt=0;t.deadline=10000;t.validate();actionSum+=t.actions;return t;
 });
 ok(actionSum===d.totalActions,'Session action counters disagree');
 ok(Array.isArray(d.events)&&d.events.length<=250,'Event log too large');c.events=d.events.map(e=>({sequence:integer(e.sequence,1,d.sequence,'event sequence'),kind:text(e.kind,40,'event type'),table:integer(e.table,0,d.tables.length,'event table'),message:text(e.message,1000,'event message')}));
 ok(Array.isArray(d.recording)&&d.recording.length<=1200,'Recording too large');if(d.recording.length)E.parseReplay(JSON.stringify({format:'eightmax-workbench-replay',version:1,mode:'simulation',frames:d.recording}));
 c.recording=copy(d.recording);c.sequence=d.sequence;c.totalActions=d.totalActions;c.running=false;c.stopped=d.stopped;if(c.stopped)ok(c.tables.every(t=>t.paused),'Stopped session must keep all tables paused');return c;
}
return {save,load,FORMAT,MAX_BYTES};
});
