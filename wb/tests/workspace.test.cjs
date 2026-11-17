'use strict';const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../src/workspace.js'),A=require('../src/study-adapter.js'),EM=require('./load-solver.cjs'),D=require('../src/image-validation-demo.js'),N=require('../src/native-jobs.js');
const harness=require('./ui-harness.cjs'),clone=x=>JSON.parse(JSON.stringify(x));
const data=async h=>JSON.parse(await h.blobs.get(h.downloads.at(-1).href).text());
async function saved(h=harness()){await h.get('workspace-save').click();assert.match(h.get('workspace-status').textContent,/backup exported/);return data(h);}
async function open(h,d){h.get('workspace-file').files=[{size:1000,text:async()=>JSON.stringify(d)}];await h.get('workspace-file').onchange();}
function result(){const p=A.prepare(EM,{config:A.EXAMPLES.practice2,iterations:20,timeMs:1000});p.game.iterate(20);return A.result(EM,p,5);}
const key='eightmax-full-workspace-recovery-v1';
function png(name='source.png'){const f=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3])],{type:'image/png'});Object.defineProperty(f,'name',{value:name});return f;}
function imageMock(h){h.c.createImageBitmap=async()=>({width:48,height:32,imageData:D.image(0),close(){}});}

test('whole-workspace round trip keeps studies, unfinished guided edits, labels, review, calibration and simulation',async()=>{
 const h=harness();h.get('study-example').value='practice2';h.get('load-example').click();h.get('study-updates').value='20';h.get('study-updates').oninput();const p=h.get('solve-study').click();h.workers[0].result(result());await p;
 h.get('study-slot').value='2';h.get('study-slot').onchange();h.get('guided-stack-0').value='42';h.get('guided-range-0').value='AA:0.5';h.get('guided-form').oninput();
 h.get('observation-completed-demo').click();h.get('observation-all').click();h.get('observation-ranges').value='AA\nKK';
 const c=D.create().calibration.export();h.get('calibration-file').files=[{size:1000,text:async()=>JSON.stringify(c)}];await h.get('calibration-file').onchange();
 h.get('image-validation-demo').click();h.c.setTimeout=(f,ms)=>{if(ms===0)f();return 1;};await h.get('image-validation-run').click();
 h.get('start').click();for(let i=0;i<20;i++)h.c.workbench.coordinator.tick(i*100);const d=await saved(h),b=harness();await open(b,d);
 assert.match(b.get('workspace-status').textContent,/restored/);assert.equal(b.c.workbench.coordinator.running,false);assert.equal(b.workers.length,0);
 assert.equal(b.get('guided-stack-0').value,'42');b.get('apply-guided').click();assert.equal(JSON.parse(b.get('study-config').value).stacks[0],42);
 assert.match(b.get('observation-completed').textContent,/completed-1/);assert.equal(b.get('observation-ranges').value,'AA\nKK');assert.deepEqual(clone(b.c.getImageCalibration()),c);
 assert.match(b.get('image-validation-results').innerHTML,/60.0%/);b.get('study-slot').value='1';b.get('study-slot').onchange();assert.match(b.get('study-results').innerHTML,/committed updates/);
});
test('unfinished invalid advanced JSON is preserved as a draft without launching a calculation',async()=>{
 const h=harness();h.get('study-config').value='{unfinished';h.get('study-config').oninput();const d=await saved(h),b=harness();await open(b,d);
 assert.equal(b.get('study-config').value,'{unfinished');assert.equal(b.workers.length,0);assert.match(b.get('workspace-status').textContent,/restored/);
});
test('manual backups embed image bytes and reopen them as file objects without decoding or executing them',async()=>{
 const h=harness(),file=png();imageMock(h);h.get('image-file').files=[file];await h.get('image-file').onchange();
 const d=await saved(h);assert.equal(d.assets.length,1);assert.ok(d.assets[0].base64);const b=harness();await open(b,d);
 const restored=b.c.WorkspaceVision.file();assert.deepEqual(Buffer.from(await restored.arrayBuffer()),Buffer.from(await file.arrayBuffer()));
 assert.equal(restored.name,'source.png');assert.match(b.get('calibration-status').textContent,/Show saved image/);assert.equal(b.workers.length,0);
});
test('reference-only workspace restores metadata and clearly reports missing source images',async()=>{
 const h=harness(),file=png();imageMock(h);h.get('image-file').files=[file];await h.get('image-file').onchange();h.get('workspace-images').checked=false;
 const d=await saved(h);assert.equal(d.assets[0].base64,null);const b=harness();await open(b,d);
 assert.match(b.get('workspace-status').textContent,/1 original image/);assert.equal(b.c.WorkspaceVision.file().name,'source.png');assert.equal(b.c.WorkspaceVision.file().unavailable,true);
});
test('automatic whole-workspace recovery never overwrites an older save on startup and omits image bytes',async()=>{
 const base=await saved(),older=JSON.stringify(base),h=harness({stored:[[key,older]]}),tick=h.timers.find(t=>t.ms===10000).fn;
 tick();assert.equal(h.storage.get(key),older);h.get('guided-stack-0').value='55';h.get('guided-form').oninput();tick();const next=JSON.parse(h.storage.get(key));
 assert.equal(next.studies.guided.seats[0].stack,'55');assert.deepEqual(next.simulation.recording,[]);assert.ok(next.assets.every(a=>a.base64===null));
 const b=harness({stored:[[key,JSON.stringify(next)]]});b.get('workspace-recover').click();assert.equal(b.get('guided-stack-0').value,'55');assert.equal(b.c.workbench.coordinator.running,false);
});
test('quota failure retains the old automatic save and manual workspace export remains available',async()=>{
 const d=await saved(),text=JSON.stringify(d),h=harness({stored:[[key,text]]});h.c.localStorage.setItem=()=>{throw Error('quota');};h.get('guided-stack-0').value='66';h.get('guided-form').oninput();h.timers.find(t=>t.ms===10000).fn();
 assert.equal(h.storage.get(key),text);assert.match(h.get('workspace-status').textContent,/could not save/);await saved(h);assert.equal(h.downloads.length,1);
 h.get('workspace-clear').click();assert.equal(h.storage.has(key),false);h.timers.find(t=>t.ms===10000).fn();assert.equal(h.storage.has(key),false);
});
test('invalid/oversized workspace imports leave simulation and workspace drafts unchanged',async()=>{
 const h=harness();h.get('guided-stack-0').value='77';h.get('guided-form').oninput();const before=h.c.workbench.coordinator;
 for(const file of [{size:2,text:async()=>'{}'},{size:W.MAX_BYTES+1,text:async()=>{throw Error('must not read');}}]){h.get('workspace-file').files=[file];await h.get('workspace-file').onchange();assert.equal(h.c.workbench.coordinator,before);assert.equal(h.get('guided-stack-0').value,'77');assert.match(h.get('workspace-status').textContent,/not opened/);}
});
test('all component schemas are checked before any workspace is replaced',async()=>{
 const d=await saved();for(const mutate of [x=>x.engine.build='wrong',x=>x.decisionReady=true,x=>x.studies.activeSlot=11,x=>x.studies.slots.push(clone(x.studies.slots[0])),x=>x.calibration.value.templates=[{}],x=>x.review.ranges=5,x=>x.labels.editor.mode='execute',x=>x.benchmark.settings=null,x=>x.extra={}]){const bad=clone(d);mutate(bad);assert.throws(()=>W.load(JSON.stringify(bad)));}
});
test('embedded images enforce canonical base64, byte counts, reference binding and aggregate bounds',async()=>{
 const h=harness();imageMock(h);h.get('image-file').files=[png()];await h.get('image-file').onchange();const d=await saved(h);
 for(const mutate of [x=>x.assets[0].base64='!!!!',x=>x.assets[0].size++,x=>x.calibration.image='missing',x=>x.assets.push(clone(x.assets[0]))]){const bad=clone(d);mutate(bad);assert.throws(()=>W.load(JSON.stringify(bad)));}
 const bad=clone(d);bad.assets=Array.from({length:12},(_,i)=>({id:'a'+i,name:'a'+i+'.png',size:10000000,type:'image/png',base64:null}));bad.calibration.image='a0';assert.throws(()=>W.load(JSON.stringify(bad)),/110 MB/);
});
test('restoring a workspace invalidates a running study and ignores its late handler',async()=>{
 const h=harness(),d=await saved(h),p=h.get('solve-study').click();await open(h,d);await p;assert.ok(h.workers[0].dead);assert.equal(h.get('study-results').innerHTML,'');assert.equal(h.c.workbench.coordinator.running,false);
});
test('saved recognition aggregates are rebuilt from outcomes and contradictory outcome claims are refused',async()=>{
 const h=harness();h.c.setTimeout=(f,ms)=>{if(ms===0)f();return 1;};h.get('image-validation-demo').click();await h.get('image-validation-run').click();const d=await saved(h);
 d.labels.report.summary.overall.acceptedAccuracy=1;assert.equal(W.load(JSON.stringify(d)).model.labels.report.summary.overall.acceptedAccuracy,.6);
 d.labels.report.rows.find(r=>r.outcome==='wrong-match').outcome='correct-match';assert.throws(()=>W.load(JSON.stringify(d)),/contradicts/);
});
test('late workspace file reads cannot overwrite a later recovery choice',async()=>{
 const h=harness(),d=await saved(h);let release;h.get('workspace-file').files=[{size:1000,text:()=>new Promise(r=>release=r)}];const pending=h.get('workspace-file').onchange();
 const newer=clone(d);newer.studies.guided.seats[0].stack='88';h.storage.set(key,JSON.stringify(newer));h.get('workspace-recover').click();release(JSON.stringify(d));await pending;assert.equal(h.get('guided-stack-0').value,'88');
});
test('an unexpected component apply failure rolls back the prior workspace without restarting work',async()=>{
 const h=harness(),d=await saved(h);h.get('guided-stack-0').value='91';h.get('guided-form').oninput();let first=true;const real=h.c.WorkspaceLabels.apply;
 h.c.WorkspaceLabels.apply=(...args)=>{if(first){first=false;throw Error('test apply failure');}return real(...args);};await open(h,d);
 assert.match(h.get('workspace-status').textContent,/not opened/);assert.equal(h.get('guided-stack-0').value,'91');assert.equal(h.c.workbench.coordinator.running,false);
});
test('browser diagnostics run one bounded real-format worker request and do not establish capacity',async()=>{
 const h=harness(),p=h.get('browser-checks').click();assert.equal(h.workers[0].data.request.iterations,20);h.workers[0].result(result());await p;
 h.get('diagnostics-export').click();const r=await data(h);assert.equal(r.browser.liveCapacityEstablished,false);assert.ok(r.browser.checks.some(c=>c.name==='CPU worker study'&&c.passed));assert.equal(h.c.workbench.coordinator.totalActions,0);
});
test('cancelling/replacing browser checks cannot publish stale results or stop a newer worker',async()=>{
 const h=harness(),first=h.get('browser-checks').click(),second=h.get('browser-checks').click();await first;assert.ok(h.workers[0].dead);assert.equal(!!h.workers[1].dead,false);h.workers[1].result(result());await second;
 const b=harness(),p=b.get('browser-checks').click();b.get('stop').click();await p;b.get('diagnostics-export').click();assert.equal(b.downloads.length,0);
});
test('Windows diagnostics remain supplied reports and survive workspace backup',async()=>{
 const h=harness(),r={format:'eightmax-windows-diagnostics',version:1,liveCapacityEstablished:false,checks:[{name:'Native build execution',passed:false,required:false,message:'Not executed in this fixture'}]};
 h.get('windows-report-file').files=[{size:1000,text:async()=>JSON.stringify(r)}];await h.get('windows-report-file').onchange();assert.match(h.get('diagnostics-status').textContent,/supplied evidence/);
 const b=harness();await open(b,await saved(h));assert.match(b.get('diagnostics-report').textContent,/Not executed in this fixture/);r.liveCapacityEstablished=true;assert.throws(()=>W.diagnostic(r,'windows'));
});
test('manual workspace bundles retain all selected validation files and their historical report',async()=>{
 const h=harness(),d=D.create();h.c.setTimeout=(f,ms)=>{if(ms===0)f();return 1;};h.c.createImageBitmap=async f=>{const img=d.images.get(f.name);return {width:img.width,height:img.height,imageData:img,close(){}};};
 h.get('calibration-file').files=[{size:1000,text:async()=>JSON.stringify(d.calibration.export())}];await h.get('calibration-file').onchange();h.get('image-validation-manifest-file').files=[{size:1000,text:async()=>JSON.stringify(d.dataset)}];await h.get('image-validation-manifest-file').onchange();
 h.get('image-validation-image-files').files=d.files.map(f=>png(f.name));h.get('image-validation-image-files').onchange();await h.get('image-validation-run').click();const backup=await saved(h);
 assert.equal(backup.assets.length,6);assert.ok(backup.assets.every(a=>a.base64));const b=harness();await open(b,backup);assert.equal(b.c.WorkspaceLabels.files().length,6);assert.match(b.get('image-validation-results').innerHTML,/60.0%/);assert.equal(b.workers.length,0);
});
test('a pending calibration-image decode cannot replace a newly restored workspace',async()=>{
 const h=harness(),empty=await saved(h);let release,closed=0;h.c.createImageBitmap=()=>new Promise(r=>release=r);h.get('image-file').files=[png()];const p=h.get('image-file').onchange();
 await open(h,empty);release({width:48,height:32,imageData:D.image(0),close(){closed++;}});await p;assert.equal(closed,1);assert.equal(h.c.WorkspaceVision.file(),null);assert.match(h.get('calibration-status').textContent,/No source screenshot/);
});
