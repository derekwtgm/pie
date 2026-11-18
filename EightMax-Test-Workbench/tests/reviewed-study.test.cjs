'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const N=require('../src/native-jobs.js'),E=require('./load-solver.cjs'),A=require('../src/study-adapter.js'),Q=require('../src/reviewed-study.js'),R=require('../src/round-audit.js'),Session=require('../src/review-session.js'),D=require('../src/reviewed-demo.js'),P=require('../src/preflop-demo.js'),S=require('../src/settlement.js'),W=require('../src/workspace.js'),{Cache}=require('../src/cache.js'),harness=require('./ui-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function session(sequence=D.create()){const s=new Session.Session(sequence);s.batch();return s;}
function prepared(proof=session().trajectory(1),ranges=['AsAd','KsKd'],edit=()=>{}){const d=Q.draft(proof,ranges);edit(d.config);const p=A.prepare(E,{config:d.config,iterations:1000,timeMs:3000});return {p,proof:d.proof,mapped:Q.replay(E,p,d.proof,{clock:()=>0})};}
function solved(f=prepared()){f.p.game.iterate(1000);const r=A.result(E,f.p,10);r.reviewedNode=Q.query(E,f.p,f.mapped);Q.validateNode(r.reviewedNode,r.config);return r;}
function sequence(states){return {format:'eightmax-observation-sequence',version:1,source:'synthetic',frames:states.flatMap(state=>[clone(state),clone(state)]).map((state,i)=>({table:1,hand:'review-test',frame:'test-'+i,sequence:i,timeMs:i*200,quality:{accepted:true,minScore:.99,minMargin:.1},state}))};}
function observed(base,round){const s={...clone(base),seats:clone(round.seats),actor:round.actor,pot:base.deadMoney+round.seats.reduce((a,p)=>a+p.committed,0)};if(round.closed)s.roundClosed=true;else delete s.roundClosed;return s;}
function multiway(short=false){const root={street:'river',board:['2c','3d','4h','8s','9c'],hero:['As','Ad'],heroSeat:0,actor:0,bigBlind:100,pot:short?600:400,deadMoney:0,roundStart:{dealer:short?2:3},seats:Array.from({length:short?3:4},(_,i)=>({stack:short&&i===2?350:1000,committed:short?200:100,bet:0,folded:!short&&i===3}))};
 const round=new R.Round(root,root.roundStart.dealer),states=[root];round.apply('raise',short?300:200);states.push(observed(root,round));round.apply(short?'call':'fold');states.push(observed(root,round));if(short){round.apply('raise',350);states.push(observed(root,round));}return sequence(states);}
function streets(){const root={street:'flop',board:['2c','3d','4h'],hero:['As','Ad'],heroSeat:1,actor:0,bigBlind:100,pot:200,deadMoney:0,roundStart:{dealer:1},seats:[0,1].map(()=>({stack:1000,committed:100,bet:0,folded:false}))},r=new R.Round(root,1),states=[root];r.apply('raise',100);states.push(observed(root,r));r.apply('call');const turn=observed(root,r);turn.street='turn';turn.board.push('8s');turn.seats.forEach(p=>p.bet=0);delete turn.roundClosed;turn.actor=0;states.push(clone(turn));const nr=new R.Round(turn,1);nr.apply('check');states.push(observed(turn,nr));return sequence(states);}
function completed(){const d=D.create(),states=[d.frames[0].state,d.frames[2].state],round=new R.Round(states[0],0);round.apply('raise',200);round.apply('call');const closed=observed(states[0],round);states.push(closed);const shown={...clone(closed),phase:'showdown',showdown:[{seat:1,cards:['Ks','Kd']}]};states.push(shown);const plan=S.plan(shown,0),final={...clone(shown),phase:'settled',awards:plan.awards,refunds:plan.refunds,pot:0};final.seats.forEach((p,i)=>{p.stack+=plan.awards[i]+plan.refunds[i];p.bet=p.committed=0;});states.push(final);return sequence(states);}
const download=async h=>JSON.parse(await h.blobs.get(h.downloads.at(-1).href).text());

test('reviewed half-pot history maps the rotated opponent root to the actual hero decision',()=>{
 const f=prepared(),n=solved(f).reviewedNode;assert.equal(n.path,'r1');assert.deepEqual(n.originalSeats,[1,0]);assert.equal(n.actor,1);assert.equal(n.originalSeat,0);assert.equal(n.pot,6);assert.equal(n.heroKnown,true);assert.equal(n.heroRowIndex,0);assert.ok(n.hands[0].stored);
 const [a,b]=n.hands[0].cards,expected=f.p.game.averageAt(n.path,n.board,n.actor,{id:E.PIDX[a*52+b],a,b,w:1});assert.deepEqual(n.hands[0].average,Array.from(expected));
});
test('action slots are derived from explicit menus instead of assumed indices',()=>{const f=prepared(undefined,undefined,c=>c.streets.river.bets='25,50,100');assert.equal(f.mapped.path,'r2');assert.equal(f.mapped.view.pot,6);});
test('off-menu bets and one-chip mismatches are refused even when display labels round together',()=>{
 assert.throws(()=>prepared(undefined,undefined,c=>c.streets.river.bets='60'),/No exact study action/);
 const proof=session().trajectory(1);for(const s of proof.states){s.bigBlind*=100;s.pot*=100;s.seats.forEach(p=>{p.stack*=100;p.committed*=100;p.bet*=100;});}
 const target=proof.states[1];target.seats[1].stack--;target.seats[1].committed++;target.seats[1].bet++;target.pot++;
 assert.throws(()=>prepared(proof),/No exact study action/);
});
test('root ledger, ante, board and chip-EV assumptions cannot silently change',()=>{
 for(const edit of [c=>c.prior=[1,3],c=>c.common=1,c=>c.stacks[0]=9,c=>c.board='2c3d4h8sTc',c=>c.dealt=2,c=>c.icm={}])assert.throws(()=>prepared(undefined,undefined,edit));
 const s=session(P.create(2)),proof=s.trajectory(1);assert.throws(()=>prepared(proof,['random','random'],c=>c.anteType='bba'),/individual/);
});
test('root-folded money and later folds preserve every original seat mapping',()=>{
 const proof=session(multiway()).trajectory(1),f=prepared(proof,['AsAd','KsKd','QhQd','-']);assert.deepEqual(f.mapped.model.originalSeats,[0,1,2]);assert.deepEqual(f.p.options.config.folded,[1]);assert.deepEqual(f.mapped.view.live,[true,false,true]);assert.equal(f.mapped.view.seat,2);assert.equal(f.mapped.view.pot,6);
});
test('short all-in history matches the engine without reopening the earlier bettor',()=>{
 const proof=session(multiway(true)).trajectory(1),f=prepared(proof,['AsAd','KsKd','QhQd'],c=>c.streets.river.maxBets=5);
 assert.equal(f.mapped.path,'r112');assert.equal(f.mapped.view.seat,0);assert.deepEqual(f.mapped.view.actions.map(a=>a.label),['Fold','Call 0.5']);
});
test('combined final-call/turn snapshots and a later check retain the correct public-card path',()=>{
 const f=prepared(session(streets()).trajectory(1),['KsKd','AsAd']);assert.equal(f.mapped.path,'r11c0');assert.deepEqual(f.mapped.steps,[1,1,{card:27},0]);assert.equal(f.mapped.view.seat,1);assert.equal(f.mapped.view.pot,4);
});
test('heads-up, six-seat and eight-seat preflop histories enter the verified flop action order',()=>{
 for(const n of [2,6,8]){const f=prepared(session(P.create(n)).trajectory(1),Array(n).fill('random'));assert.equal(f.mapped.model.originalSeats[f.mapped.view.seat],1);assert.deepEqual(f.mapped.view.board,[0,5,10]);assert.equal(f.mapped.path.endsWith('c'),true);}
});
test('explicit current-street anchoring carries earlier chips without posting blinds or antes twice',()=>{
 const proof=session(P.create(8)).trajectory(1),street=Q.latestStreet(proof),f=prepared(street,Array(8).fill('random'));assert.equal(street.states[0].street,'flop');assert.equal(f.mapped.path,'r');assert.equal(f.p.options.config.dealt,undefined);assert.deepEqual(f.p.options.config.folded,[.1,.1]);assert.ok(Math.abs(f.mapped.view.pot-6.8)<1e-12);assert.deepEqual(f.mapped.model.originalSeats,[1,2,5,6,7,0]);
});
test('missing policies remain unavailable and public-board conflicts are not queried as hands',()=>{
 const f=prepared(),n=Q.query(E,f.p,f.mapped);assert.ok(n.hands.every(h=>!h.stored&&h.average===null));assert.equal(n.quality.rangePosteriorComputed,false);
 const weighted=prepared(undefined,['AsAd:0.25,AcAh:0.75','KsKd']),report=Q.query(E,weighted.p,weighted.mapped);assert.deepEqual(report.hands.map(h=>h.weight),weighted.p.spec.hands[1].map(h=>h[3]));
});
test('known hero cards outside the explicit acting range do not get an invented row',()=>{const f=prepared(undefined,['QhQd','KsKd']),n=Q.query(E,f.p,f.mapped);assert.equal(n.heroKnown,true);assert.equal(n.heroRowIndex,null);assert.equal(n.hands.some(h=>h.cards.includes(51)),false);});
test('path inspection and node queries leave exported training/RNG state unchanged',()=>{
 const f=prepared();f.p.game.iterate(200);const before=Buffer.from(f.p.game.exportNative());const m=Q.replay(E,f.p,f.proof,{clock:()=>0});Q.query(E,f.p,m);assert.ok(before.equals(Buffer.from(f.p.game.exportNative())));
});
test('unknown anchors, accounting phases, malformed frames, excessive history and changed cards are refused',()=>{
 const proof=session().trajectory(1);for(const edit of [p=>delete p.states[0].roundStart,p=>p.decisionReady=true,p=>p.frames[1]=p.frames[0],p=>p.source='live',p=>p.states[1].board[0]='5c',p=>p.states[1].hero[0]='Ac']){const p=clone(proof);edit(p);assert.throws(()=>Q.validate(p));}
 const excessive=clone(proof);excessive.states=Array(129).fill(proof.states[0]);excessive.frames=Array.from({length:129},(_,i)=>i);assert.throws(()=>Q.validate(excessive),/128/);
 const c=session(completed());assert.throws(()=>c.trajectory(1),/stable/);const last=c.inspect(1);assert.throws(()=>Q.validate(c.inspectedTrajectory(1,last.steps.length-1)),/Accounting/);
});
test('completed-hand selected-step preparation excludes future exposed opponent evidence',()=>{
 const s=session(completed()),proof=s.inspectedTrajectory(1,1);assert.equal(proof.states.length,2);assert.ok(proof.states.every(p=>!p.showdown&&!p.phase));const f=prepared(proof);assert.equal(f.mapped.path,'r1');
});
test('report import validation refuses contradictory context, probabilities, hero labels and chance cards',()=>{
 const f=prepared(),r=solved(f),n=r.reviewedNode;for(const edit of [x=>x.originalSeat=1,x=>x.rootConfigKey='wrong',x=>x.pot++,x=>x.heroRowIndex=null,x=>x.hands[0].average=[2,0,0],x=>x.hands[0].stored=false,x=>x.quality.convergenceVerified=true]){const bad=clone(n);edit(bad);assert.throws(()=>Q.validateNode(bad,r.config));}
 const t=prepared(session(streets()).trajectory(1),['KsKd','AsAd']),node=Q.query(E,t.p,t.mapped);node.steps[2].card=26;assert.throws(()=>Q.validateNode(node,t.p.options.config),/public cards/);
});
test('mapping has a bounded deadline and reviewed reports never enter the root-only cache',()=>{
 const f=prepared();let time=0;assert.throws(()=>Q.replay(E,f.p,f.proof,{clock:()=>time+=10,timeMs:5}),/time budget/);const r=solved(f);assert.equal(new Cache().put({config:r.config,iterations:1000,timeMs:3000},r),false);
});
test('preparing a reviewed draft is manual, slot-bound and present in actual page markup',async()=>{
 const markup=fs.readFileSync(path.join(__dirname,'../START.html'),'utf8');for(const id of ['observation-history-to-study','solve-reviewed-position','reviewed-position-results','observation-study-demo','observation-hand-to-study'])assert.ok(markup.includes('id="'+id+'"'),id);
 const h=harness();h.get('observation-study-demo').click();h.get('observation-all').click();h.get('observation-history-to-study').click();assert.equal(h.workers.length,0);assert.match(h.get('reviewed-position-note').textContent,/reviewed-demo/);
 const pending=h.get('solve-study').click();assert.equal(h.workers[0].data.mode,'review-study');const request=h.workers[0].data.request,f=prepared(request.reviewed,['AsAd','KsKd']);h.workers[0].result(solved(f));await pending;assert.match(h.get('reviewed-position-results').innerHTML,/Original seat 1/);assert.match(h.get('reviewed-position-results').innerHTML,/Hero/);assert.equal(h.c.workbench.coordinator.totalActions,0);
 const exporting=h.get('export-native-job').click();assert.equal(h.workers.length,2);assert.equal(h.workers[1].data.mode,'native-review-job');const native=prepared(h.workers[1].data.request.reviewed);h.workers[1].result(N.reviewedJob(E,native.p,native.mapped,'review-native'));await exporting;assert.match(h.get('study-status').textContent,/Native job exported/);
});
test('mapped links/reports survive workspace v3 and old version-1 workspaces still open',async()=>{
 const h=harness();h.get('observation-study-demo').click();h.get('observation-all').click();h.get('observation-history-to-study').click();const pending=h.get('solve-study').click();h.workers[0].result(solved());await pending;
 await h.get('workspace-save').click();const d=await download(h);assert.equal(d.version,3);assert.ok(d.studies.slots[0].reviewedProof);const b=harness();b.get('workspace-file').files=[{size:1000,text:async()=>JSON.stringify(d)}];await b.get('workspace-file').onchange();assert.match(b.get('reviewed-position-results').innerHTML,/Original seat 1/);assert.equal(b.workers.length,0);
 const old=W.load(fs.readFileSync(path.join(__dirname,'../examples/workspace-0.10-compatibility.json'),'utf8'));assert.equal(old.sourceVersion,1);assert.equal(old.model.version,3);assert.ok(old.model.studies.slots.every(s=>s.reviewedProof===null));assert.equal(old.model.review.anchorScope,'original');assert.equal(W.load(W.encode(old.model)).sourceVersion,3);
});
test('later review changes do not silently alter captured study input; explicit new examples detach it',()=>{
 const h=harness();h.get('observation-study-demo').click();h.get('observation-all').click();h.get('observation-history-to-study').click();h.get('observation-preflop-demo').click();assert.match(h.get('reviewed-position-note').textContent,/reviewed-demo/);
 h.get('study-slot').value='2';h.get('study-slot').onchange();assert.match(h.get('reviewed-position-note').textContent,/No reviewed-position/);h.get('study-slot').value='1';h.get('study-slot').onchange();assert.match(h.get('reviewed-position-note').textContent,/reviewed-demo/);h.get('load-example').click();assert.match(h.get('reviewed-position-note').textContent,/No reviewed-position/);
});
test('reviewed draft files reopen without solving and preserve explicit current-street scope',async()=>{
 const h=harness();h.get('observation-preflop-demo').click();h.get('observation-all').click();h.get('observation-ranges').value=Array(8).fill('random').join('\n');h.get('observation-anchor-scope').value='street';h.get('observation-history-to-study').click();h.get('reviewed-position-export').click();const d=await download(h);assert.equal(d.proof.states[0].street,'flop');
 const b=harness();b.get('reviewed-position-file').files=[{size:1000,text:async()=>JSON.stringify(d)}];await b.get('reviewed-position-file').onchange();assert.equal(b.workers.length,0);assert.match(b.get('reviewed-position-note').textContent,/flop anchor/);
});
const native=process.env.EIGHTMAX_TEST_CLI;
test('mapped non-root policies match the separate native engine at the same action path',{skip:!native},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eightmax-reviewed-native-'));try{
  const f=prepared(),r=solved(f),n=r.reviewedNode,spec=path.join(dir,'spec.json'),state=path.join(dir,'study.state'),query=path.join(dir,'query.json');fs.writeFileSync(spec,JSON.stringify(f.p.spec));fs.writeFileSync(query,JSON.stringify({path:n.steps.filter(s=>typeof s==='number'),board:n.board.slice(f.p.spec.board.length),offset:0,limit:1326}));
  cp.execFileSync(native,[spec,'1000','2',state,'256'],{timeout:30000});const q=JSON.parse(cp.execFileSync(native,['--node',spec,state,query,'256'],{encoding:'utf8',timeout:30000}));assert.equal(q.node.actor,n.actor);assert.equal(q.node.pot,n.pot);assert.deepEqual(q.node.behind,n.behind);
  const byCard=new Map(q.hands.items.map(h=>[h.cards.slice().sort((a,b)=>a-b).join(','),h]));for(const h of n.hands){const other=byCard.get(h.cards.slice().sort((a,b)=>a-b).join(','));assert.ok(other);assert.deepEqual(other.average,h.average);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
