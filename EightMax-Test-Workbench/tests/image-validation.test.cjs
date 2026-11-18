'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const X=require('../src/image-validation.js'),D=require('../src/image-validation-demo.js'),V=require('../src/vision.js'),harness=require('./ui-harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const run=(d=D.create(),extra={})=>new X.Runner().run({dataset:d.dataset,calibration:d.calibration,imageFiles:d.files,decode:async f=>d.images.get(f.name),...extra});
const dataFrom=async h=>JSON.parse(await h.blobs.get(h.downloads.at(-1).href).text());
function ui(){const h=harness();h.c.setTimeout=f=>{f();return 1;};return h;}

test('labeled evaluation measures wrong labels, false accepts and correct negative rejections separately',async()=>{
 const r=await run(),s=r.summary.overall;assert.equal(r.complete,true);assert.equal(s.scored,12);
 assert.equal(s.acceptedCorrect,6);assert.equal(s.wrongLabel,2);assert.equal(s.falseAccepts,2);assert.equal(s.correctRejections,2);
 assert.equal(s.acceptedAccuracy,.6);assert.equal(s.knownCoverage,1);assert.equal(s.knownCorrectRate,.75);assert.equal(s.falseAcceptanceRate,.5);
 assert.equal(r.summary.confusions.length,4);assert.equal(r.decisionReady,false);assert.equal(r.recognitionValidatedForLiveUse,false);
});
test('exact reference crop overlap is visible without hiding any incorrect accepted results',async()=>{
 const r=await run();assert.equal(r.summary.overall.exactReferenceOverlap,2);
 assert.equal(r.summary.withoutExactReferenceOverlap.scored,10);assert.equal(r.summary.withoutExactReferenceOverlap.acceptedAccuracy,.5);
 assert.equal(r.summary.overall.acceptedWrong,4);assert.ok(r.rows.filter(x=>x.exactReferenceOverlap).every(x=>x.image==='reference-overlap.png'));
});
test('missing files remain unscored, make evaluation incomplete and reduce known-field coverage',async()=>{
 const d=D.create();d.files=d.files.filter(f=>f.name!=='match-a.png');const r=await run(d);
 assert.equal(r.complete,false);assert.equal(r.summary.overall.unscored,2);assert.equal(r.summary.overall.knownCoverage,.75);
 assert.equal(r.summary.overall.rejectedKnown,0);assert.match(r.errors[0].reason,/not selected/);
 assert.ok(r.rows.filter(x=>x.image==='match-a.png').every(x=>x.accepted===null&&x.score===null));
});
test('missing regions and field-kind mismatches are not counted as successful rejections',async()=>{
 const d=D.create();d.calibration.regions=d.calibration.regions.filter(r=>r.kind==='card');let r=await run(d);
 assert.equal(r.summary.overall.unscored,6);assert.equal(r.summary.byField.find(x=>x.field==='pot').metrics.scored,0);
 d.calibration.regions[0].kind='amount';r=await run(d);assert.equal(r.summary.overall.unscored,12);assert.equal(r.summary.overall.correctRejections,0);
});
test('decode failures and malformed/oversized decoded images stay isolated from other files',async()=>{
 const d=D.create(),r=await run(d,{decode:async f=>{
  if(f.name==='match-a.png')throw Error('broken PNG');if(f.name==='match-b.png')return {width:20001,height:1000,data:new Uint8ClampedArray(0)};
  if(f.name==='blank.png')return {width:48,height:32,data:Array(48*32*4).fill(NaN)};return d.images.get(f.name);
 }});
 assert.equal(r.complete,false);assert.equal(r.decodedImages,3);assert.equal(r.summary.overall.unscored,6);assert.equal(r.summary.overall.scored,6);
 assert.equal(r.errors.length,3);assert.ok(r.errors.every(e=>/decode failed/.test(e.reason)));
});
test('fully unavailable evidence reports null accuracy instead of a perfect or zero fabricated score',async()=>{
 const d=D.create(),r=await run(d,{imageFiles:[]});assert.equal(r.summary.overall.scored,0);assert.equal(r.summary.overall.acceptedAccuracy,null);
 assert.equal(r.summary.overall.knownCoverage,0);assert.equal(r.summary.overall.falseAcceptanceRate,null);assert.equal(r.complete,false);
});
test('known labels that are rejected reduce coverage; all-negative rejected sets have no accepted accuracy',async()=>{
 const d=D.create();d.dataset.cases=d.dataset.cases.filter(c=>c.image==='blank.png');d.dataset.cases[0].fields.forEach(f=>f.expected=f.kind==='card'?'As':'100');
 const r=await run(d);assert.equal(r.summary.overall.rejectedKnown,2);assert.equal(r.summary.overall.knownCoverage,0);assert.equal(r.summary.overall.acceptedAccuracy,null);
 d.dataset.cases[0].fields.forEach(f=>f.expected=null);const negative=await run(d);assert.equal(negative.summary.overall.correctRejections,2);
 assert.equal(negative.summary.overall.knownCoverage,null);assert.equal(negative.summary.overall.falseAcceptanceRate,0);
});
test('calibrated aspect mismatches and duplicate visible cards are genuine recognition rejections',async()=>{
 const d=D.create();d.calibration.regions.forEach(r=>r.aspect=2);let r=await run(d);
 assert.equal(r.summary.overall.acceptedCorrect,0);assert.ok(r.rows.every(x=>x.outcome==='rejected'&&/aspect/.test(x.reason)));
 const duplicate=D.create();duplicate.calibration.setRegion(1,'board_1','card',{x:0,y:0,w:.5,h:1},1.5);
 r=await run(duplicate);assert.ok(r.rows.filter(x=>x.field==='hero_1'&&x.image==='match-a.png').every(x=>x.outcome==='rejected'&&/Duplicate/.test(x.reason)));
});
test('amount labels use exact supported strings, without undocumented numeric coercion',async()=>{
 const d=D.create();d.dataset.cases=[clone(d.dataset.cases[0])];d.dataset.cases[0].fields=[{field:'pot',kind:'amount',expected:'100.00'}];
 const r=await run(d);assert.equal(r.summary.overall.wrongLabel,1);assert.equal(r.rows[0].label,'100');assert.equal(r.rows[0].expected,'100.00');
});
test('ten-table reports retain per-field identities and decode a shared screenshot only once',async()=>{
 const d=D.create(),first=d.dataset.cases[0],regions=clone(d.calibration.regions);d.dataset.cases=[];
 for(let table=1;table<=10;table++){d.dataset.cases.push({...clone(first),id:'table-'+table,table});if(table>1)for(const r of regions)d.calibration.setRegion(table,r.field,r.kind,r.box,r.aspect);}
 let decodes=0;const r=await run(d,{decode:async f=>{decodes++;return d.images.get(f.name);}});
 assert.equal(decodes,1);assert.equal(r.summary.byTable.length,10);assert.equal(r.summary.byField.length,20);assert.equal(r.summary.overall.acceptedCorrect,20);
});
test('dataset schemas refuse reused identities, contradictory labels, paths and changing field kinds',()=>{
 const base=D.create().dataset;
 const mutations=[d=>d.version=2,d=>d.source='live',d=>d.extra=true,d=>d.cases[1].id=d.cases[0].id,
  d=>d.cases[1].image=d.cases[0].image,d=>d.cases[0].image='../image.png',d=>d.cases[0].image='https://example.com/a.png',
  d=>d.cases[0].table=11,d=>d.cases[0].fields[0].expected='<img>',d=>delete d.cases[0].fields[0].expected,
  d=>d.cases[0].fields.push(clone(d.cases[0].fields[0])),d=>d.cases[1].fields[0].kind='amount',
  d=>d.cases[0].fields.push({field:'board_1',kind:'card',expected:'As'})];
 for(const mutate of mutations){const d=clone(base);mutate(d);assert.throws(()=>X.manifest(d));}
 assert.deepEqual(X.manifest(JSON.stringify(base)),base);
});
test('manifest, field and file limits reject oversized inputs before decoding',()=>{
 assert.throws(()=>X.manifest('x'.repeat(X.MAX_MANIFEST_BYTES+1)),/4 MB/);
 const d=D.create().dataset;d.cases=Array.from({length:201},(_,i)=>({...clone(d.cases[0]),id:'case-'+i,image:'image-'+i+'.png'}));assert.throws(()=>X.manifest(d));
 const many=D.create().dataset;many.cases=Array.from({length:200},(_,i)=>({id:'many-'+i,image:'image-'+Math.floor(i/2)+'.png',table:i%2+1,
  fields:Array.from({length:11},(_,j)=>({field:'amount_'+j,kind:'amount',expected:'1'}))}));assert.throws(()=>X.manifest(many),/2,000/);
 const f={name:'image.png',type:'image/png',size:1};assert.throws(()=>X.files(Array(101).fill(f)),/100 images/);
 assert.equal(X.files([{...f,name:'Screenshot (1).png'}]).size,1);
 assert.throws(()=>X.files([{...f,size:10000001}]));assert.throws(()=>X.files([{...f,type:'text/html'}]));assert.throws(()=>X.files([f,{...f,name:'IMAGE.PNG'}]),/Duplicate/);
 assert.throws(()=>X.files(Array.from({length:11},(_,i)=>({...f,name:'image-'+i+'.png',size:10000000}))),/100 MB/);
});
test('cancelling an awaited decoder prevents progress callbacks and completed reports',async()=>{
 const d=D.create(),runner=new X.Runner();let release,progress=0;
 const pending=runner.run({dataset:d.dataset,calibration:d.calibration,imageFiles:d.files,
  decode:()=>new Promise(resolve=>release=resolve),onProgress:()=>progress++});
 await Promise.resolve();assert.ok(release);runner.cancel();release(d.images.get('match-a.png'));
 await assert.rejects(pending,e=>e.code==='cancelled');assert.equal(progress,0);assert.equal(runner.busy,false);
});
test('an older cancelled run cannot replace or clear the busy state of a newer run',async()=>{
 const d=D.create(),runner=new X.Runner();let oldRelease,newRelease;
 const options={dataset:d.dataset,calibration:d.calibration,imageFiles:d.files};
 const old=runner.run({...options,decode:()=>new Promise(resolve=>oldRelease=resolve)});await Promise.resolve();
 const next=runner.run({...options,decode:()=>new Promise(resolve=>newRelease=resolve)});await Promise.resolve();
 oldRelease(d.images.get('match-a.png'));await assert.rejects(old,e=>e.code==='cancelled');assert.equal(runner.busy,true);
 runner.cancel();newRelease(d.images.get('match-a.png'));await assert.rejects(next,e=>e.code==='cancelled');
});
test('in-flight calibration and expected-label snapshots survive mutation of caller objects',async()=>{
 const d=D.create(),runner=new X.Runner();let release;
 const pending=runner.run({dataset:d.dataset,calibration:d.calibration,imageFiles:d.files,decode:async f=>{
  if(f.name==='match-a.png')return new Promise(resolve=>release=resolve);return d.images.get(f.name);
 }});await Promise.resolve();d.calibration.templates=[];d.dataset.cases[0].fields[0].expected='Kd';release(d.images.get('match-a.png'));
 const r=await pending;assert.equal(r.summary.overall.acceptedCorrect,6);assert.equal(r.rows[0].expected,'As');
});
test('one image is decoded at a time and exported reports contain no screenshot or template pixels',async()=>{
 const d=D.create();let active=0,max=0;const r=await run(d,{decode:async f=>{active++;max=Math.max(max,active);await Promise.resolve();active--;return d.images.get(f.name);}});
 assert.equal(max,1);const text=JSON.stringify(r);assert.equal(text.includes('"pixels"'),false);assert.equal(text.includes('"data"'),false);
 assert.equal(r.unusedFiles.length,0);assert.equal(r.processedImages,6);
});
test('synthetic validation UI exports a report and leaves observation, solver and simulated actions untouched',async()=>{
 const h=ui();h.get('image-validation-demo').click();await h.get('image-validation-run').click();
 assert.match(h.get('image-validation-results').innerHTML,/60.0%/);assert.match(h.get('image-validation-detail').textContent,/falseAccepts/);
 h.get('image-validation-export').click();const r=await dataFrom(h);assert.equal(r.summary.overall.acceptedWrong,4);
 assert.equal(h.workers.length,0);assert.equal(h.c.workbench.coordinator.totalActions,0);assert.equal(h.c.workbench.coordinator.running,false);
 assert.equal(JSON.parse(h.get('observation-summary').textContent).framesLoaded,0);assert.equal(h.c.workbenchImageValidationBusy,false);
});
test('manual manifest, calibration and mocked browser image decode use the same pipeline and close bitmaps',async()=>{
 const h=ui(),d=D.create();h.get('calibration-file').files=[{size:1000,text:async()=>JSON.stringify(d.calibration.export())}];await h.get('calibration-file').onchange();
 h.get('image-validation-manifest-file').files=[{size:1000,text:async()=>JSON.stringify(d.dataset)}];await h.get('image-validation-manifest-file').onchange();
 h.get('image-validation-image-files').files=d.files;h.get('image-validation-image-files').onchange();let closed=0;
 h.c.createImageBitmap=async f=>{const image=d.images.get(f.name);return {width:image.width,height:image.height,imageData:image,close(){closed++;}};};
 await h.get('image-validation-run').click();h.get('image-validation-export').click();const r=await dataFrom(h);
 assert.equal(r.summary.overall.acceptedCorrect,6);assert.equal(closed,6);assert.match(h.get('image-validation-preview').textContent,/current Image calibration/);
});
test('a failed browser decode closes its bitmap, reports missing evidence and continues to other images',async()=>{
 const h=ui(),d=D.create();h.c.getImageCalibration=()=>d.calibration.export();
 h.get('image-validation-manifest-file').files=[{size:1000,text:async()=>JSON.stringify(d.dataset)}];await h.get('image-validation-manifest-file').onchange();
 h.get('image-validation-image-files').files=d.files;h.get('image-validation-image-files').onchange();let closed=0;
 h.c.createImageBitmap=async f=>{const img=d.images.get(f.name);return {width:f.name==='match-a.png'?20001:img.width,height:f.name==='match-a.png'?1000:img.height,imageData:img,close(){closed++;}};};
 await h.get('image-validation-run').click();h.get('image-validation-export').click();const r=await dataFrom(h);
 assert.equal(r.complete,false);assert.equal(r.summary.overall.unscored,2);assert.equal(closed,6);
});
test('global emergency stop cancels image validation and blocks overlapping CPU workflows',async()=>{
 const h=harness(),waiting=[];h.c.setTimeout=f=>{waiting.push(f);return 1;};h.get('image-validation-demo').click();const p=h.get('image-validation-run').click();
 assert.equal(h.c.workbenchImageValidationBusy,true);h.get('start').click();assert.equal(h.c.workbench.coordinator.running,false);
 await h.get('solve-study').click();assert.match(h.get('study-status').textContent,/Stop image validation/);
 await h.get('run-benchmark').click();assert.match(h.get('benchmark-status').textContent,/Stop image validation/);
 h.get('stop').click();waiting[0]();await p;assert.equal(h.c.workbenchImageValidationBusy,false);assert.equal(h.workers.length,0);
 h.get('image-validation-export').click();assert.equal(h.downloads.length,0);
});
test('calibration changes cancel a pending run and remove scores based on the old calibration',async()=>{
 const h=harness(),waiting=[];h.c.setTimeout=f=>{waiting.push(f);return 1;};h.get('image-validation-demo').click();const p=h.get('image-validation-run').click();
 const c=D.create().calibration.export();h.get('calibration-file').files=[{size:1000,text:async()=>JSON.stringify(c)}];await h.get('calibration-file').onchange();
 waiting[0]();await p;assert.match(h.get('image-validation-status').textContent,/Calibration changed/);
 assert.equal(h.get('image-validation-results').innerHTML,'');assert.equal(h.c.workbenchImageValidationBusy,false);
});
test('late manifest imports cannot overwrite a newly selected demo and invalid imports preserve completed results',async()=>{
 const h=ui();let release;h.get('image-validation-manifest-file').files=[{size:1000,text:()=>new Promise(r=>release=r)}];
 const pending=h.get('image-validation-manifest-file').onchange();h.get('image-validation-demo').click();const other=D.create().dataset;other.name='Old delayed dataset';release(JSON.stringify(other));await pending;
 assert.doesNotMatch(h.get('image-validation-preview').textContent,/Old delayed/);await h.get('image-validation-run').click();
 const before=h.get('image-validation-results').innerHTML;h.get('image-validation-manifest-file').files=[{size:2,text:async()=>'{}'}];await h.get('image-validation-manifest-file').onchange();
 assert.equal(h.get('image-validation-results').innerHTML,before);h.get('image-validation-export').click();assert.equal((await dataFrom(h)).complete,true);
});
test('guided labeling creates, updates and removes expected fields without editing JSON',async()=>{
 const h=ui(),d=D.create();h.c.getImageCalibration=()=>d.calibration.export();
 h.get('image-validation-image-files').files=[d.files[0]];h.get('image-validation-image-files').onchange();h.get('image-validation-new').click();
 h.get('image-label-name').value='My labeled screenshots';h.get('image-label-field').value='hero_1';h.get('image-label-value').value='Kd';h.get('image-label-add').click();
 h.get('image-label-value').value='As';h.get('image-label-add').click();h.get('image-label-field').value='pot';h.get('image-label-field').onchange();
 h.get('image-label-mode').value='reject';h.get('image-label-mode').onchange();assert.equal(h.get('image-label-value').disabled,true);h.get('image-label-add').click();
 h.get('image-validation-labels-export').click();let data=await dataFrom(h);assert.equal(data.name,'My labeled screenshots');assert.equal(data.cases.length,1);
 assert.deepEqual(data.cases[0].fields,[{field:'hero_1',kind:'card',expected:'As'},{field:'pot',kind:'amount',expected:null}]);
 h.get('image-label-field').value='pot';h.get('image-label-remove').click();h.get('image-validation-labels-export').click();data=await dataFrom(h);assert.equal(data.cases[0].fields.length,1);
 h.c.createImageBitmap=async()=>{const img=d.images.get(d.files[0].name);return {width:img.width,height:img.height,imageData:img,close(){}};};
 await h.get('image-validation-run').click();h.get('image-validation-export').click();assert.equal((await dataFrom(h)).summary.overall.acceptedCorrect,1);
});
test('guided labels refuse a contradictory duplicate card without replacing saved ground truth',async()=>{
 const h=ui(),d=D.create();d.calibration.setRegion(1,'board_1','card',{x:.5,y:0,w:.5,h:1},1.5);h.c.getImageCalibration=()=>d.calibration.export();
 h.get('image-validation-image-files').files=[d.files[0]];h.get('image-validation-image-files').onchange();h.get('image-validation-new').click();
 h.get('image-label-field').value='hero_1';h.get('image-label-value').value='As';h.get('image-label-add').click();
 h.get('image-label-field').value='board_1';h.get('image-label-value').value='As';h.get('image-label-add').click();
 assert.match(h.get('image-validation-status').textContent,/Duplicate expected visible card/);h.get('image-validation-labels-export').click();assert.equal((await dataFrom(h)).cases[0].fields.length,1);
});
test('recorded-image preview uses the selected file, closes its bitmap and clears before evaluation',async()=>{
 const h=ui(),d=D.create();h.c.getImageCalibration=()=>d.calibration.export();
 h.get('image-validation-manifest-file').files=[{size:1000,text:async()=>JSON.stringify(d.dataset)}];await h.get('image-validation-manifest-file').onchange();
 h.get('image-validation-image-files').files=d.files;h.get('image-validation-image-files').onchange();let closed=0;
 h.c.createImageBitmap=async f=>{const img=d.images.get(f.name);return {width:img.width,height:img.height,imageData:img,close(){closed++;}};};
 await h.get('image-validation-show').click();assert.equal(h.get('image-validation-canvas').hidden,false);assert.equal(closed,1);
 assert.match(h.get('image-validation-status').textContent,/Showing match-a.png/);await h.get('image-validation-run').click();assert.equal(h.get('image-validation-canvas').hidden,true);assert.equal(closed,7);
});
test('empty guided label sets cannot be exported or reported as a completed evaluation',async()=>{
 const h=ui(),d=D.create();h.c.getImageCalibration=()=>d.calibration.export();h.get('image-validation-image-files').files=d.files;h.get('image-validation-image-files').onchange();
 h.get('image-validation-new').click();h.get('image-validation-labels-export').click();assert.equal(h.downloads.length,0);assert.match(h.get('image-validation-status').textContent,/1 to 200/);
 await h.get('image-validation-run').click();h.get('image-validation-export').click();assert.equal(h.downloads.length,0);assert.equal(h.c.workbenchImageValidationBusy,false);
});
test('guided ground truth retains table ten identity and renders dataset names as text',async()=>{
 const h=ui(),d=D.create();d.calibration.setRegion(10,'hero_1','card',{x:0,y:0,w:.5,h:1},1.5);h.c.getImageCalibration=()=>d.calibration.export();
 h.get('image-validation-image-files').files=[d.files[0]];h.get('image-validation-image-files').onchange();h.get('image-validation-new').click();
 h.get('image-label-table').value='10';h.get('image-label-table').onchange();h.get('image-label-name').value='<img src=x onerror=alert(1)>';
 h.get('image-label-value').value='As';h.get('image-label-add').click();h.get('image-validation-labels-export').click();const data=await dataFrom(h);
 assert.equal(data.cases[0].table,10);assert.equal(data.name,'<img src=x onerror=alert(1)>');assert.ok(h.get('image-validation-preview').textContent.includes(data.name));
 assert.equal(h.get('image-validation-results').innerHTML,'');
});
