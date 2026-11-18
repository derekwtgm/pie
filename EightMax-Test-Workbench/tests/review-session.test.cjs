'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../src/review-session.js'),O=require('../src/observations.js'),D=require('../src/completed-demo.js');
const Round=require('../src/round-audit.js').Round,S=require('../src/settlement.js'),E=require('../src/engine.js');
const harness=require('./ui-harness.cjs'),clone=x=>JSON.parse(JSON.stringify(x));
const finish=s=>{while(s.cursor<s.sequence.frames.length)s.batch();return s;};
const report=s=>s.tracker.export();
const recoveryKey='eightmax-observation-review-recovery-v1';
const recoveryTick=h=>h.timers.filter(t=>t.ms===3000).at(-1).fn();
const downloadData=async h=>JSON.parse(await h.blobs.get(h.downloads.at(-1).href).text());
function interleaved(){const base=D.sidepots(),frames=[];for(let i=0;i<base.frames.length;i++)for(let table=1;table<=10;table++){
 const f=clone(base.frames[i]);f.table=table;if(table===6&&f.state.phase==='settled')f.state.awards[0]--;frames.push(f);
}return {...base,frames};}
function resetSource(){const d=D.sidepots(),bad=clone(d.frames);bad.filter(f=>f.state.phase==='settled').forEach(f=>f.state.awards[0]--);
 return {...d,frames:bad.concat(clone(d.frames))};}

test('every saved frame boundary resumes to the exact uninterrupted audit, including refunds and showdown',()=>{
 for(const data of [D.session(3),D.sidepots()]){
  const reference=finish(new R.Session(data));
  for(let cursor=0;cursor<=data.frames.length;cursor++){
   const partial=new R.Session(data);while(partial.cursor<cursor)partial.next();
   const restored=R.load(partial.serialize());assert.equal(restored.cursor,cursor);
   assert.deepEqual(report(restored),report(partial));assert.deepEqual(report(finish(restored)),report(reference));
  }
 }
});
test('restoring a one-frame candidate preserves stability requirements without processing remaining frames',()=>{
 const a=new R.Session(D.sidepots());a.next();const b=R.load(a.serialize());
 assert.equal(b.cursor,1);assert.equal(b.tracker.tables.get(1).status,'collecting');assert.equal(b.tracker.completed.length,0);
 assert.equal(b.next().transition.kind,'anchor');assert.equal(b.cursor,2);
});
test('custom stability and gap settings survive replay and continue identically',()=>{
 const d=D.sidepots(),s=new R.Session(d,{stableFrames:3,stableMs:200,maxGapMs:3000,maxHandGapMs:20000});
 s.next();const restored=R.load(s.serialize());assert.deepEqual(restored.settings,s.settings);
 assert.deepEqual(report(finish(restored)),report(finish(s)));assert.equal(restored.tracker.completed.length,0);
});
test('a failed payout remains paused after restoration and cannot manufacture a completed record',()=>{
 const d=resetSource(),s=new R.Session(d);s.batch(12);assert.equal(s.tracker.tables.get(1).status,'paused');
 const restored=R.load(s.serialize());assert.equal(restored.tracker.tables.get(1).status,'paused');finish(restored);
 assert.equal(restored.tracker.completed.length,0);assert.equal(restored.tracker.tables.get(1).accepted.phase,'showdown');
});
test('edited checkpoint source is re-audited rather than inheriting previously completed status',()=>{
 const s=finish(new R.Session(D.sidepots())),data=JSON.parse(s.serialize());
 data.sequence.frames.filter(f=>f.state.phase==='settled').forEach(f=>{f.state.awards=[0,800,0];f.state.seats[0].stack=0;f.state.seats[1].stack=800;});
 const restored=R.load(JSON.stringify(data));assert.equal(restored.cursor,s.cursor);
 assert.equal(restored.tracker.tables.get(1).status,'paused');assert.equal(restored.tracker.completed.length,0);
 assert.equal(restored.tracker.tables.get(1).accepted.phase,'showdown');
});
test('reviewed resets are journaled at the original position and retain prior failure events',()=>{
 const s=new R.Session(resetSource());s.batch(12);s.reset(1);s.next();
 const resumed=R.load(s.serialize());assert.deepEqual(resumed.operations,s.operations);finish(resumed);finish(s);
 assert.deepEqual(report(resumed),report(s));assert.equal(resumed.tracker.completed.length,1);
 assert.ok(resumed.tracker.events.some(e=>e.status==='reset'));assert.ok(resumed.tracker.events.some(e=>e.status==='paused'));
});
test('ten-table recovery preserves a bad-table pause while nine other tables settle',()=>{
 const s=new R.Session(interleaved());s.batch(73);const resumed=finish(R.load(s.serialize()));finish(s);
 assert.deepEqual(report(resumed),report(s));assert.equal(resumed.tracker.completed.length,9);
 assert.equal(resumed.tracker.tables.get(6).status,'paused');assert.equal(resumed.tracker.tables.get(10).status,'complete');
});
test('review files reject reports, incompatible rules, executable claims and malformed settings',()=>{
 const s=new R.Session(D.sidepots());s.next();const d=JSON.parse(s.serialize());
 const changes=[x=>x.format='eightmax-completed-hands',x=>x.version=2,x=>x.rules='unknown',x=>x.decisionReady=true,
  x=>x.settings.stableFrames=1,x=>delete x.settings.maxGapMs,x=>x.accepted={phase:'settled'},x=>x.cursor++,x=>x.cursor=-1];
 for(const change of changes){const x=clone(d);change(x);assert.throws(()=>R.load(JSON.stringify(x)));}
 assert.throws(()=>R.load(JSON.stringify(new O.Tracker().export())));
});
test('a saved operation history cannot skip, duplicate or reorder source frames or smuggle state',()=>{
 const s=new R.Session(D.sidepots());s.batch(3);const d=JSON.parse(s.serialize());
 for(const mutate of [x=>x.operations[1].index=0,x=>x.operations[1].index=2,x=>x.operations[0].index=-1,
  x=>x.operations[0].kind='accept',x=>x.operations[0].state={},x=>x.operations.push({kind:'reset',table:11}),
  x=>x.operations.push({kind:'reset',table:1,accepted:true})]){const x=clone(d);mutate(x);assert.throws(()=>R.load(JSON.stringify(x)));}
});
test('review storage is bounded by bytes, source frames and operation count',()=>{
 assert.throws(()=>R.load(' '.repeat(R.MAX_BYTES+1)),/limit/);
 const d=D.sidepots();d.notes='😀'.repeat(2500001);assert.throws(()=>new R.Session(d),/limit/);
 const tooMany=D.sidepots();tooMany.frames=Array(5001).fill(tooMany.frames[0]);assert.throws(()=>new R.Session(tooMany));
 const s=new R.Session(D.sidepots());for(let i=0;i<R.MAX_OPERATIONS;i++)s.reset(1);
 assert.throws(()=>s.next(),/operation limit/);assert.equal(s.cursor,0);
 assert.throws(()=>s.reset(1),/operation limit/);
 const x=JSON.parse(s.serialize());x.operations.push({kind:'reset',table:1});assert.throws(()=>R.load(JSON.stringify(x)),/operation limit/);
});
test('source and returned inspection data do not alias the working review',()=>{
 const d=D.sidepots(),s=new R.Session(d);d.frames[0].state.hero[0]='2c';finish(s);
 const view=s.inspect(1);view.steps[0].state.pot=999;view.record.accounting.awards[0]=0;
 assert.equal(s.inspect(1).steps[0].state.pot,300);assert.equal(s.tracker.completed[0].accounting.awards[0],600);
 assert.equal(JSON.parse(s.serialize()).accepted,undefined);
});
test('hand inspection replays accepted actions, exposed cards and actual final side-pot balances',()=>{
 const s=finish(new R.Session(D.sidepots())),v=s.inspect(1);
 assert.deepEqual(v.steps.map(x=>x.transition.kind),['anchor','raise','raise','call','showdown','settlement']);
 assert.deepEqual(v.steps.map(x=>x.sourceIndex),[1,3,5,7,9,11]);
 assert.equal(v.steps[0].state.pot,300);assert.equal(v.steps.at(-1).state.pot,0);
 assert.deepEqual(v.steps.at(-1).state.seats.map(p=>p.stack),[600,200,100]);
 assert.equal(v.record.anchorStreet,'river');assert.equal(v.decisionReady,false);assert.equal(v.truncated,false);
});
test('completed-hand inspection separates uncalled refunds from awards and the following hand',()=>{
 const s=finish(new R.Session(D.session(2))),v=s.inspect(1),next=s.inspect(2);
 assert.deepEqual(v.steps.map(x=>x.transition.kind),['anchor','fold','refund','settlement']);
 assert.deepEqual(v.record.accounting,{awards:[0,120],refunds:[0,50]});
 assert.equal(v.record.hand,'completed-1');assert.equal(next.record.hand,'completed-2');
 assert.ok(v.steps.at(-1).sourceIndex<next.steps[0].sourceIndex);
});
test('record identity disambiguates repeated table/hand labels after reviewed resets',()=>{
 const d=D.sidepots(),s=new R.Session({...d,frames:d.frames.concat(clone(d.frames))});s.batch(12);s.reset(1);finish(s);
 const a=s.inspect(1),b=s.inspect(2);assert.equal(a.record.hand,b.record.hand);assert.ok(a.steps.at(-1).sourceIndex<b.steps[0].sourceIndex);
 assert.deepEqual(R.load(s.serialize()).inspect(2),b);
});
test('archive retention survives checkpoint replay and dropped record IDs cannot be inspected',()=>{
 const s=finish(new R.Session(D.session(105))),b=R.load(s.serialize());
 assert.equal(b.tracker.completed.length,100);assert.throws(()=>b.inspect(1),/no longer retained/);
 assert.equal(b.inspect(6).record.hand,'completed-6');assert.equal(b.inspect(105).record.hand,'completed-105');
 assert.deepEqual(report(b),report(s));
});
function longHand(){
 const data={format:'eightmax-observation-sequence',version:1,source:'synthetic',frames:[]};
 const base={street:'river',board:['2c','3d','4h','8s','9c'],hero:['As','Ad'],heroSeat:0,actor:0,bigBlind:100,pot:800,deadMoney:0,
  roundStart:{dealer:7},seats:Array.from({length:8},()=>({stack:1000000,committed:100,bet:0,folded:false}))};
 const round=new Round(base,7),push=state=>{for(let j=0;j<2;j++){const i=data.frames.length;data.frames.push({table:1,hand:'long-hand',frame:'long-'+i,
  sequence:i,timeMs:i*200,quality:{accepted:true,minScore:.99,minMargin:.1},state:clone(state)});}};
 const observed=()=>({...clone(base),seats:clone(round.seats),actor:round.actor,...(round.closed?{roundClosed:true}:{}),pot:round.seats.reduce((a,p)=>a+p.committed,0)});
 push(base);for(let i=0;i<260;i++){round.apply('raise',round.price+100);push(observed());}
 while(!round.closed){round.apply('call');push(observed());}
 const shown=observed(),deck=Array.from({length:52},(_,i)=>E.card(i)).filter(c=>!base.hero.concat(base.board).includes(c));
 shown.phase='showdown';shown.showdown=Array.from({length:7},(_,i)=>({seat:i+1,cards:deck.slice(i*2,i*2+2)}));push(shown);
 const final=clone(shown),p=S.plan(shown,7);final.phase='settled';final.awards=p.awards;final.refunds=p.refunds;final.pot=0;
 final.seats.forEach((seat,i)=>{seat.stack+=p.awards[i]+p.refunds[i];seat.bet=seat.committed=0;});push(final);return data;
}
test('long-hand inspection has a bounded tail and explicitly marks omitted accepted steps',()=>{
 const s=finish(new R.Session(longHand())),v=s.inspect(1);assert.equal(s.tracker.completed.length,1);
 assert.equal(v.steps.length,R.MAX_INSPECTION_STEPS);assert.ok(v.totalSteps>v.steps.length);assert.equal(v.truncated,true);
 assert.equal(v.record.historyTruncated,true);assert.equal(v.steps.at(-1).transition.kind,'settlement');
 assert.equal(v.record.anchorState.pot,800);assert.equal(v.steps.at(-1).state.pot,0);
});
test('review UI saves a partial candidate and resumes manually with no worker or simulation action',async()=>{
 const h=harness();h.get('observation-sidepot-demo').click();h.get('observation-step').click();h.get('observation-review-save').click();
 const data=await downloadData(h);assert.equal(data.cursor,1);assert.equal(h.downloads.at(-1).download,'EightMax-observation-review.json');
 const b=harness();b.get('observation-review-file').files=[{size:1000,text:async()=>JSON.stringify(data)}];await b.get('observation-review-file').onchange();
 assert.equal(JSON.parse(b.get('observation-summary').textContent).framesProcessed,1);assert.match(b.get('observation-status').textContent,/continue manually/);
 b.get('observation-step').click();assert.match(b.get('observation-events').textContent,/anchor/);assert.equal(b.workers.length,0);assert.equal(b.c.workbench.coordinator.totalActions,0);
});
test('automatic review recovery is separate from simulation recovery and never runs at startup',()=>{
 const a=harness();a.get('observation-completed-demo').click();for(let i=0;i<5;i++)a.get('observation-step').click();recoveryTick(a);
 const saved=a.storage.get(recoveryKey);assert.ok(saved);assert.equal(a.storage.size,1);
 const b=harness({stored:[[recoveryKey,saved]]});assert.equal(JSON.parse(b.get('observation-summary').textContent).framesLoaded,0);
 assert.match(b.get('observation-recovery-status').textContent,/earlier review save/);recoveryTick(b);assert.equal(b.storage.get(recoveryKey),saved);
 b.get('observation-review-recover').click();assert.equal(JSON.parse(b.get('observation-summary').textContent).framesProcessed,5);
 assert.equal(b.workers.length,0);assert.equal(b.c.workbench.coordinator.running,false);
});
test('storage quota failures retain the older save and leave manual review export available',async()=>{
 const h=harness({stored:[[recoveryKey,'older-save']]});h.get('observation-sidepot-demo').click();
 h.c.localStorage.setItem=()=>{throw Error('quota');};recoveryTick(h);
 assert.equal(h.storage.get(recoveryKey),'older-save');assert.match(h.get('observation-recovery-status').textContent,/could not save/);
 h.get('observation-review-save').click();assert.equal((await downloadData(h)).format,R.FORMAT);
 h.get('observation-review-clear').click();assert.equal(h.storage.has(recoveryKey),false);recoveryTick(h);assert.equal(h.storage.has(recoveryKey),false);
 h.c.localStorage.setItem=(k,v)=>h.storage.set(k,v);h.get('observation-step').click();recoveryTick(h);assert.ok(h.storage.get(recoveryKey));
});
test('corrupt or oversized review imports leave current progress and completed records intact',async()=>{
 const h=harness();h.get('observation-sidepot-demo').click();h.get('observation-all').click();const before=h.get('observation-summary').textContent;
 for(const file of [{size:2,text:async()=>'{}'},{size:R.MAX_BYTES+1,text:async()=>{throw Error('must not read');}}]){
  h.get('observation-review-file').files=[file];await h.get('observation-review-file').onchange();
  assert.equal(h.get('observation-summary').textContent,before);assert.match(h.get('observation-status').textContent,/not loaded/);
 }
 assert.match(h.get('observation-completed').textContent,/sidepot-demo/);
});
test('late asynchronous imports cannot overwrite a newly selected demo',async()=>{
 const h=harness();let resolve;
 h.get('observation-review-file').files=[{size:1000,text:()=>new Promise(r=>resolve=r)}];
 const pending=h.get('observation-review-file').onchange();h.get('observation-completed-demo').click();
 resolve(new R.Session(D.sidepots()).serialize());await pending;h.get('observation-all').click();
 assert.match(h.get('observation-completed').textContent,/completed-1/);assert.doesNotMatch(h.get('observation-completed').textContent,/sidepot-demo/);
});
test('hand inspector controls and export show accepted states while keeping analysis and execution idle',async()=>{
 const h=harness();h.get('observation-sidepot-demo').click();h.get('observation-all').click();
 assert.match(h.get('observation-hand-caption').textContent,/river anchor/);assert.match(h.get('observation-hand-state').textContent,/anchor/);
 h.get('observation-hand-next').click();assert.match(h.get('observation-hand-state').textContent,/raise/);
 h.get('observation-hand-slider').value='5';h.get('observation-hand-slider').oninput();assert.match(h.get('observation-hand-state').textContent,/settlement/);
 h.get('observation-hand-export').click();const data=await downloadData(h);assert.equal(data.record.hand,'sidepot-demo');assert.equal(data.steps.length,6);
 assert.equal(data.decisionReady,false);assert.equal(h.workers.length,0);assert.equal(h.c.workbench.coordinator.totalActions,0);
});
test('malformed source frames remain auditable failures rather than crashing import preview',async()=>{
 const h=harness(),d=D.sidepots();d.frames[0]=null;
 h.get('observation-file').files=[{size:1000,text:async()=>JSON.stringify(d)}];await h.get('observation-file').onchange();
 h.get('observation-step').click();assert.match(h.get('observation-events').textContent,/Invalid table identity/);
 h.get('observation-review-save').click();const b=R.load(JSON.stringify(await downloadData(h)));
 assert.equal(b.cursor,1);assert.equal(b.tracker.events[0].status,'rejected');
});
