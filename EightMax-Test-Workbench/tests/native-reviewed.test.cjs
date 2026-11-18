'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const E=require('./load-solver.cjs'),A=require('../src/study-adapter.js'),N=require('../src/native-jobs.js'),Q=require('../src/reviewed-study.js'),R=require('../src/round-audit.js'),S=require('../src/review-session.js'),D=require('../src/reviewed-demo.js'),P=require('../src/preflop-demo.js'),W=require('../src/workspace.js'),harness=require('./ui-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x)),opts={threads:2,memoryMiB:256,timeoutSeconds:60,chunkUpdates:250};
const fixture=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/native-reviewed-demo-result.json'),'utf8'));
function prepared(sequence=D.create(),ranges=['AsAd','KsKd'],edit=()=>{}){const s=new S.Session(sequence);s.batch();const d=Q.draft(s.trajectory(1),ranges);edit(d.config);const p=A.prepare(E,{config:d.config,iterations:1000,timeMs:3000}),mapped=Q.replay(E,p,d.proof);return {p,mapped};}
function exported(f=prepared(),slot=1){return N.bind(N.reviewedJob(E,f.p,f.mapped,'native-reviewed'),slot,'bound-reviewed',opts);}
function turns(){const root={street:'flop',board:['2c','3d','4h'],hero:['As','Ad'],heroSeat:1,actor:0,bigBlind:100,pot:200,deadMoney:0,roundStart:{dealer:1},seats:[0,1].map(()=>({stack:1000,committed:100,bet:0,folded:false}))},r=new R.Round(root,1),states=[clone(root)];
 r.apply('raise',100);states.push({...clone(root),seats:clone(r.seats),actor:r.actor,pot:300});r.apply('call');const turn={...clone(root),street:'turn',board:[...root.board,'8s'],seats:clone(r.seats),actor:0,pot:400};turn.seats.forEach(p=>p.bet=0);states.push(clone(turn));const nr=new R.Round(turn,1);nr.apply('check');states.push({...clone(turn),seats:clone(nr.seats),actor:nr.actor});
 return {format:'eightmax-observation-sequence',version:1,source:'synthetic',frames:states.flatMap(state=>[clone(state),clone(state)]).map((state,i)=>({table:1,hand:'native-turn',frame:'turn-'+i,sequence:i,timeMs:i*200,quality:{accepted:true,minScore:.99,minMargin:.1},state}))};}
const download=async h=>JSON.parse(await h.blobs.get(h.downloads.at(-1).href).text());
async function exportUI(h=harness()){
 h.get('observation-study-demo').click();h.get('observation-all').click();h.get('observation-history-to-study').click();
 const pending=h.get('export-native-job').click(),w=h.workers.at(-1);assert.equal(w.data.mode,'native-review-job');const p=A.prepare(E,w.data.request),mapped=Q.replay(E,p,w.data.request.reviewed);w.result(N.reviewedJob(E,p,mapped,w.data.id));await pending;return {h,job:await download(h)};
}
function forJob(job){const r=fixture();r.job=clone(job);return r;}
async function importUI(h,r){h.get('import-study-result').click();const text=JSON.stringify(r);h.get('study-result-file').files=[{size:Buffer.byteLength(text),text:async()=>text}];await h.get('study-result-file').onchange();}

test('reviewed native export captures the exact path and both menus without training or policy rows',()=>{
 const f=prepared(),before=Buffer.from(f.p.game.exportNative()),j=exported(f);assert.equal(j.version,2);assert.deepEqual(j.query,{path:[1],board:[],offset:0,limit:1326});assert.equal(j.reviewed.actor,1);assert.equal(j.reviewed.path,'r1');assert.ok(j.reviewed.hands.every(h=>h.average===null&&!h.stored));assert.equal(f.p.game.iterations,0);assert.ok(before.equals(Buffer.from(f.p.game.exportNative())));
 assert.throws(()=>{f.p.game.iterate(1);N.reviewedJob(E,f.p,f.mapped,'trained');},/fresh untrained/);
});
test('native query projection retains combined action/card steps and later actor changes',()=>{
 const j=exported(prepared(turns(),['KsKd','AsAd,8s8d']));assert.deepEqual(j.query,{path:[1,1,0],board:[27],offset:0,limit:1326});assert.equal(j.reviewed.path,'r11c0');assert.equal(j.reviewed.hands.length,1);
});
test('new native jobs reject changed proof, query, input range, menu and premature policy data',()=>{
 const j=exported();for(const change of [x=>x.query.path=[0],x=>x.query.board=[30],x=>x.query.offset=1,x=>x.query.limit=1,x=>x.reviewed.originalSeat=1,x=>x.reviewed.rootConfigKey='old',x=>x.spec.board[0]=1,x=>x.spec.hands[1][0][3]=.5,x=>x.spec.hands[0][0][0]=0,x=>x.rootActions[0].slot=1,x=>{x.reviewed.hands[0].stored=true;x.reviewed.hands[0].average=[1,0,0];}]){const b=clone(j);change(b);assert.throws(()=>N.job(b));}
 const old=clone(j);old.version=1;assert.throws(()=>N.job(old),/root queries/);
});
test('bound reviewed exports refuse altered specs, tokens and other slots',()=>{
 const j=exported();for(const change of [x=>x.spec.state.rng=123,x=>x.workbench.token='old',x=>x.iterations=999,x=>x.memoryMiB=32]){const b=clone(j);change(b);assert.throws(()=>N.same(j,b,1));}assert.throws(()=>N.same(j,j,2),/different/);
});
test('native dual-query result keeps root context and the target actor policy separate',()=>{
 const raw=fixture(),r=N.result(raw);assert.equal(r.engine.backend,'native-cli-cpu');assert.equal(r.actor,0);assert.equal(r.reviewedNode.actor,1);assert.equal(r.reviewedNode.originalSeat,0);assert.equal(r.reviewedNode.path,'r1');assert.deepEqual(r.reviewedNode.hands[0].average,raw.query.hands.items[0].average);assert.deepEqual(r.hands[0].average,raw.rootQuery.hands.items[0].average);assert.equal(r.reviewedNode.quality.rangePosteriorComputed,false);assert.equal(r.requestedUpdates,1000);
});
test('legacy version-1 root results still import while disguised non-root queries are refused',()=>{
 const raw=fixture();raw.version=1;raw.job.version=1;raw.job.query={path:[],board:[],offset:0,limit:1326};delete raw.job.reviewed;delete raw.job.rootActions;raw.query=raw.rootQuery;delete raw.rootQuery;
 assert.equal(N.result(raw).actor,0);raw.job.id=7;assert.equal(N.result(raw).engine.backend,'native-cli-cpu');raw.query.history=[{slot:0}];assert.throws(()=>N.result(raw),/study root/);
});
test('native existing rows without positive average mass remain unavailable',()=>{
 const raw=fixture();raw.query.hands.items[0].row=true;raw.query.hands.items[0].average=null;const r=N.result(raw);assert.equal(r.reviewedNode.hands[0].average,null);assert.equal(r.reviewedNode.hands[0].stored,false);
});
test('native import checks decision actor, board, money, bets, folds and action menu',()=>{
 for(const change of [x=>x.query.node.actor=0,x=>x.query.node.pot+=.01,x=>x.query.node.behind[0]-=.01,x=>x.query.node.streetPut[0]+=.01,x=>x.query.node.live[0]=false,x=>x.query.node.board[0]=1,x=>x.query.actions.pop(),x=>x.query.actions[1].to=3,x=>x.rootQuery.node.pot+=1,x=>x.rootQuery.actions[0].name='Fold']){const r=fixture();change(r);assert.throws(()=>N.result(r));}
});
test('native import checks the entire action/card history instead of accepting a matching final pot',()=>{
 for(const change of [x=>x.query.history=[],x=>x.query.history[0].slot=0,x=>x.query.history[0].seat=1,x=>x.query.history[0].to=2.01,x=>x.query.history[0].action='Call',x=>x.rootQuery.history=[x.query.history[0]]]){const r=fixture();change(r);assert.throws(()=>N.result(r),/history/);}
});
test('native imports require full ordered acting ranges and validated frequencies',()=>{
 for(const change of [x=>x.query.hands.offset=1,x=>x.query.hands.total=2,x=>x.query.hands.items=[],x=>x.query.hands.items[0].i=1,x=>x.query.hands.items[0].cards=[1,2],x=>x.query.hands.items[0].weight=.5,x=>x.query.hands.items[0].blocked=true,x=>x.query.hands.items[0].row=false,x=>x.query.hands.items[0].average=[1,1,1],x=>x.rootQuery.hands.items[0].cards=[1,2]]){const r=fixture();change(r);assert.throws(()=>N.result(r));}
});
test('native root and target queries must share completed counters and the requested total',()=>{
 for(const change of [x=>x.query.study.updates--,x=>x.rootQuery.study.sampledDeals--,x=>x.training.iterations++,x=>x.training.requestedTotalUpdates=999,x=>x.training.limitReached='false',x=>x.elapsedMs=-1,x=>x.version=3]){const r=fixture();change(r);assert.throws(()=>N.result(r));}
});
test('native envelope and standalone report file bounds reject oversized imports before state changes',async()=>{
 const raw=fixture();raw.extra='x'.repeat(N.MAX_RESULT_BYTES);assert.throws(()=>N.result(raw),/exceeds 6 MB/);
 const {h}=await exportUI();for(const file of [{size:N.MAX_RESULT_BYTES+1,text:async()=>{throw Error('must not read');}},{size:2000001,text:async()=>JSON.stringify({format:'other'})}]){h.get('study-result-file').files=[file];await h.get('study-result-file').onchange();assert.match(h.get('study-status').textContent,/exceeds/);assert.equal(h.get('reviewed-position-results').innerHTML,'');}
});
test('manual native export and result import keep the captured review and never execute simulator actions',async()=>{
 const {h,job}=await exportUI();assert.equal(job.version,2);assert.match(h.get('native-job-status').textContent,/reviewed path r1/);await importUI(h,forJob(job));assert.match(h.get('reviewed-position-results').innerHTML,/Native CPU/);assert.match(h.get('reviewed-position-results').innerHTML,/Original seat 1/);assert.equal(h.c.workbench.coordinator.totalActions,0);assert.equal(h.c.WorkspaceStudies.capture().slots[0].nativeJob.workbench.token,job.workbench.token);
});
test('unbound, stale and wrong-slot reviewed native results are refused without replacing reports',async()=>{
 const {h,job}=await exportUI();for(const change of [x=>delete x.job.workbench,x=>x.job.workbench.token='old',x=>x.job.workbench.slot=2]){const r=forJob(job);change(r);await importUI(h,r);assert.match(h.get('study-status').textContent,/not imported/);assert.equal(h.get('reviewed-position-results').innerHTML,'');}
 h.get('guided-range-0').value='QhQd';h.get('guided-form').oninput();await importUI(h,forJob(job));assert.match(h.get('study-status').textContent,/No matching exported/);
});
test('whole-workspace v3 restores bound reviewed native results paused and migrates 0.10/0.11 files',async()=>{
 const {h,job}=await exportUI();await importUI(h,forJob(job));await h.get('workspace-save').click();const d=await download(h),loaded=W.load(JSON.stringify(d));assert.equal(d.version,3);assert.equal(loaded.model.studies.slots[0].nativeJob.version,2);
 const b=harness(),text=JSON.stringify(d);b.get('workspace-file').files=[{size:Buffer.byteLength(text),text:async()=>text}];await b.get('workspace-file').onchange();assert.equal(b.workers.length,0);assert.match(b.get('reviewed-position-results').innerHTML,/Native CPU/);assert.match(b.get('native-job-status').textContent,/not resumed/);
 const old=W.load(fs.readFileSync(path.join(__dirname,'../examples/workspace-0.11-compatibility.json'),'utf8'));assert.equal(old.sourceVersion,2);assert.equal(old.model.version,3);assert.ok(old.model.studies.slots.some(s=>s.reviewedProof));assert.equal(W.load(W.encode(old.model)).sourceVersion,3);
 for(const change of [x=>x.version=2,x=>x.studies.slots[0].reviewedProof=null,x=>x.studies.slots[0].draft.iterations='99',x=>x.studies.slots[0].nativeJob.reviewed.proof.hand='other',x=>{x.studies.slots[0].result.reviewedNode.path='r0';x.studies.slots[0].result.reviewedNode.steps=[0];}]){const bad=clone(d);change(bad);assert.throws(()=>W.load(JSON.stringify(bad)));}
});
test('worker export completion cannot bind an old job after the user changes the study',async()=>{
 const h=harness();h.get('observation-study-demo').click();h.get('observation-all').click();h.get('observation-history-to-study').click();const pending=h.get('export-native-job').click(),w=h.workers[0],p=A.prepare(E,w.data.request),mapped=Q.replay(E,p,w.data.request.reviewed);
 h.get('study-config').value='{unfinished';h.get('study-config').oninput();w.result(N.reviewedJob(E,p,mapped,w.data.id));await pending;assert.equal(h.downloads.length,0);assert.equal(h.c.WorkspaceStudies.capture().slots[0].nativeJob,null);assert.ok(w.dead);
});
test('reviewed native status snapshots still require the current slot and export token',async()=>{
 const {h,job}=await exportUI(),status={format:'eightmax-native-job-status',version:1,build:A.ENGINE.build,id:job.id,workbench:job.workbench,stage:'querying',committedUpdates:1000,targetUpdates:1000,elapsedMs:20,message:'Reading reviewed node',checkpoint:'checkpoint-0.state'};
 const text=JSON.stringify(status);h.get('native-status-file').files=[{size:Buffer.byteLength(text),text:async()=>text}];await h.get('native-status-file').onchange();assert.match(h.get('native-job-status').textContent,/Reading reviewed node/);assert.equal(h.workers.length,1);
});
const native=process.env.EIGHTMAX_TEST_CLI;
function nativeResult(f,counts=[1000]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eightmax-reviewed-exchange-')),j=exported(f),spec=path.join(dir,'spec.json'),query=path.join(dir,'query.json');
 const invoke=args=>JSON.parse(cp.execFileSync(native,args,{encoding:'utf8',timeout:30000}));
 try{fs.writeFileSync(spec,JSON.stringify(j.spec));let state=null,training;for(const [i,count] of counts.entries()){const next=path.join(dir,'checkpoint-'+i%2+'.state'),args=[spec,String(count),'2',next,'256'];if(state)args.push(state);training=invoke(args);state=next;}
  const before=fs.readFileSync(state),target=j.query;fs.writeFileSync(query,JSON.stringify(target));const q=invoke(['--node',spec,state,query,'256']);fs.writeFileSync(query,JSON.stringify({path:[],board:[],offset:0,limit:1326}));const rootQuery=invoke(['--node',spec,state,query,'256']);assert.ok(before.equals(fs.readFileSync(state)));training.requestedTotalUpdates=j.iterations;return {format:'eightmax-workbench-native-result',version:2,build:A.ENGINE.build,job:j,training,query:q,rootQuery,elapsedMs:1};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('native chunked continuation preserves the non-root policy and full reviewed exchange',{skip:!native},()=>{
 const full=nativeResult(prepared()),chunks=nativeResult(prepared(),[100,350,550]),a=N.result(full),b=N.result(chunks);assert.equal(b.updates,1000);assert.deepEqual(b.reviewedNode.hands,a.reviewedNode.hands);assert.deepEqual(b.hands,a.hands);
 const f=prepared();f.p.game.iterate(1000);const portable=Q.query(E,f.p,f.mapped);assert.deepEqual(a.reviewedNode.hands,portable.hands);
});
test('native multi-street exchange retains exact history and excludes new-board blocked hands',{skip:!native},()=>{
 const f=prepared(turns(),['KsKd','AsAd:0.25,8s8d:0.75']),raw=nativeResult(f,[100]),r=N.result(raw);assert.equal(r.reviewedNode.path,'r11c0');assert.equal(raw.query.hands.items.length,2);assert.equal(r.reviewedNode.hands.length,1);assert.equal(r.reviewedNode.hands[0].weight,.25);const bad=clone(raw);bad.query.history[2].cards[0]=26;assert.throws(()=>N.result(bad),/history/);
});
test('native linked preflop 2/6/8-seat roots reach the same reviewed flop actor',{skip:!native},()=>{
 const ranges=['AsAd','KsKd','QhQd','JsJd','ThTd','9s9d','8h8d','7s7d'];for(const n of [2,6,8]){const raw=nativeResult(prepared(P.create(n),ranges.slice(0,n)),[20]),r=N.result(raw);assert.equal(r.reviewedNode.originalSeat,1);assert.deepEqual(r.reviewedNode.board,[0,5,10]);assert.equal(r.reviewedNode.path.endsWith('c'),true);}
});
test('native exchange preserves tiny explicit input weights instead of rounded printed weights',{skip:!native},()=>{
 const f=prepared(D.create(),['AsAd:0.000000000001','KsKd:0.000000000001']),raw=nativeResult(f,[20]),r=N.result(raw);assert.equal(raw.query.hands.items[0].weight,0);assert.equal(raw.rootQuery.hands.items[0].weight,0);assert.equal(r.hands[0].weight,f.p.spec.hands[0][0][3]);assert.equal(r.reviewedNode.hands[0].weight,f.p.spec.hands[1][0][3]);assert.ok(r.reviewedNode.hands[0].weight>0);
});
