/* Versioned whole-workspace data. Running work is never serialized or resumed. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./session.js'),require('./study-adapter.js'),require('./study-play.js'),require('./vision.js'),require('./review-session.js'),require('./image-validation.js'),require('./benchmark.js'),require('./native-jobs.js'),require('./reviewed-study.js'));
 else root.WorkbenchWorkspace=factory(root.EightMaxSession,root.WorkbenchStudy,root.WorkbenchPlay,root.WorkbenchVision,root.WorkbenchReviewSession,root.WorkbenchImageValidation,root.WorkbenchBenchmark,root.WorkbenchNative,root.WorkbenchReviewed);
})(typeof globalThis!=='undefined'?globalThis:this,function(S,A,P,V,R,X,B,N,Q){
'use strict';
const FORMAT='eightmax-workspace',VERSION=3,MAX_BYTES=220000000,MAX_ASSET_BYTES=110000000;
const ok=(v,m)=>{if(!v)throw Error(m);},copy=x=>JSON.parse(JSON.stringify(x));
const guidedIds=['guided-stage','guided-count','guided-board','guided-common','guided-bets','guided-raises','guided-cap','guided-opens','guided-pre-raises','guided-pre-cap'];
function integer(v,min,max,name){ok(Number.isSafeInteger(v)&&v>=min&&v<=max,'Invalid workspace '+name);}
function str(v,max,name){ok(typeof v==='string'&&v.length<=max,'Invalid workspace '+name);}
function keys(v,names,name){ok(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.prototype.hasOwnProperty.call(v,k)),'Unsupported '+name+' fields');}
function bounded(value,max,name){ok(new Blob([JSON.stringify(value)]).size<=max,name+' exceeds its file budget');}
function base64(value,size){
 if(value===null)return;str(value,Math.ceil(size/3)*4,'asset data');ok(value.length===Math.ceil(size/3)*4&&value.length%4===0,'Invalid embedded image length');
 const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,end=value.length-padding;
 ok(value.length/4*3-padding===size,'Embedded image size disagrees with metadata');
 for(let i=0;i<end;i++){const c=value.charCodeAt(i);ok(c>=65&&c<=90||c>=97&&c<=122||c>=48&&c<=57||c===43||c===47,'Invalid base64 image');}
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 if(padding)ok((alphabet.indexOf(value[end-1])&((1<<(padding*2))-1))===0,'Noncanonical image encoding');
}
function assetMap(assets){
 ok(Array.isArray(assets)&&assets.length<=101,'Workspace exceeds 101 image assets');const map=new Map();let bytes=0;
 for(const a of assets){keys(a,['id','name','type','size','base64'],'image asset');str(a.id,64,'asset identity');ok(/^[a-zA-Z0-9_-]+$/.test(a.id)&&!map.has(a.id),'Invalid or duplicate asset identity');
  X.files([{name:a.name,type:a.type,size:a.size}]);base64(a.base64,a.size);bytes+=a.size;map.set(a.id,a);
 }
 ok(bytes<=MAX_ASSET_BYTES,'Workspace images exceed 110 MB');return map;
}
function studyState(s,version){
 keys(s,['activeSlot','slots','guided','nativeControls','nativeStatus'],'study workspace');integer(s.activeSlot,1,10,'active study slot');ok(Array.isArray(s.slots)&&s.slots.length<=10,'Too many study slots');
 const seen=new Set();for(const row of s.slots){if(version===1){ok(row.reviewedProof===undefined,'Version-1 workspace cannot contain reviewed-position bindings');row.reviewedProof=null;}keys(row,['slot','draft','result','nativeJob','reviewedProof'],'saved study slot');integer(row.slot,1,10,'study slot');ok(!seen.has(row.slot),'Duplicate study slot');seen.add(row.slot);
  keys(row.draft,['config','iterations','timeMs'],'study draft');str(row.draft.config,200000,'draft config');str(row.draft.iterations,32,'draft updates');str(row.draft.timeMs,32,'draft budget');
  if(row.result!==null){bounded(row.result,2000000,'Study result');row.result=copy(A.validateResult(row.result));if(row.result.practice)P.validate(row.result.practice);
   ok(A.canonical(A.input({config:JSON.parse(row.draft.config)}).config)===A.canonical(A.input({config:row.result.config}).config),'Saved result does not match its draft');}
  if(row.reviewedProof!==null)row.reviewedProof=Q.validate(row.reviewedProof).proof;
  if(row.result&&row.result.reviewedNode){ok(!row.result.practice,'Mixed practice/review reports are unsupported');row.result.reviewedNode=Q.validateNode(row.result.reviewedNode,row.result.config);ok(row.reviewedProof!==null&&A.canonical(row.reviewedProof)===A.canonical(row.result.reviewedNode.proof),'Reviewed result is missing its matching captured position');}
  if(row.nativeJob!==null){row.nativeJob=N.job(row.nativeJob);ok(row.nativeJob.workbench&&row.nativeJob.workbench.slot===row.slot,'Saved native job belongs to a different slot');
   if(row.nativeJob.version===2){ok(version>=3,'Reviewed native bindings require workspace version 3');ok(row.reviewedProof!==null&&A.canonical(row.reviewedProof)===A.canonical(row.nativeJob.reviewed.proof),'Saved native job differs from its captured reviewed position');
    if(row.result){const node=row.result.reviewedNode,target=row.nativeJob.reviewed,fields=['rootConfigKey','originalSeats','path','steps','actor','originalSeat','board','pot','behind','actions'];ok(node&&fields.every(k=>A.canonical(node[k])===A.canonical(target[k]))&&A.canonical(node.hands.map(h=>[h.cards,h.weight]))===A.canonical(target.hands.map(h=>[h.cards,h.weight])),'Saved result differs from its bound native target');}}
   else ok(row.reviewedProof===null,'Reviewed positions cannot bind native root-only jobs');
   ok(A.canonical(A.input({config:JSON.parse(row.draft.config)}).config)===A.canonical(A.input({config:row.nativeJob.config}).config)&&Number(row.draft.iterations)===row.nativeJob.iterations,'Saved native job differs from its study draft');}

 }
 ok(seen.has(s.activeSlot),'Active study draft is missing');
 keys(s.guided,['dirty','fields','seats'],'guided draft');ok(typeof s.guided.dirty==='boolean','Invalid guided draft state');keys(s.guided.fields,guidedIds,'guided fields');
 for(const value of Object.values(s.guided.fields))str(value,4000,'guided value');ok(Array.isArray(s.guided.seats)&&s.guided.seats.length>=2&&s.guided.seats.length<=8,'Invalid guided seats');
 for(const seat of s.guided.seats){keys(seat,['stack','range'],'guided seat');str(seat.stack,100,'guided stack');str(seat.range,2000,'guided range');}
 if(s.nativeControls&&Object.keys(s.nativeControls).length===4)keys(s.nativeControls,['threads','memoryMiB','timeoutSeconds','chunkUpdates'],'native draft controls');else keys(s.nativeControls,['threads','memoryMiB','timeoutSeconds','chunkUpdates','convMethod','convEvery','convTime','convTarget'],'native draft controls');for(const value of Object.values(s.nativeControls))str(value,32,'native draft value');
 if(s.nativeStatus!==null)s.nativeStatus=N.status(s.nativeStatus);return s;
}
function imageReport(report,dataset){
 if(report===null)return null;bounded(report,4000000,'Image validation report');ok(dataset&&dataset.cases.length,'A validation report needs labeled data');
 ok(report.format==='eightmax-image-validation'&&report.version===1&&report.decisionReady===false&&report.recognitionValidatedForLiveUse===false,'Invalid image validation report');
 const targets=new Map();for(const c of dataset.cases)for(const f of c.fields)targets.set(c.id+'|'+f.field,{...f,table:c.table,image:c.image});
 ok(Array.isArray(report.rows)&&report.rows.length===targets.size,'Validation report field count disagrees with labels');const seen=new Set();
 for(const r of report.rows){const id=r.caseId+'|'+r.field,t=targets.get(id);ok(t&&!seen.has(id)&&t.table===r.table&&t.image===r.image&&t.kind===r.kind&&t.expected===r.expected,'Validation report does not match saved labels');seen.add(id);
  ok(['correct-match','wrong-match','rejected','unscored'].includes(r.outcome)&&typeof r.exactReferenceOverlap==='boolean','Invalid recognition outcome');str(r.reason,2000,'recognition reason');
  if(r.outcome==='unscored')ok(r.accepted===null&&r.label===null&&r.score===null&&r.margin===null&&!r.exactReferenceOverlap,'Unscored fields cannot claim accepted evidence');
  else{ok(typeof r.score==='number'&&Number.isFinite(r.score)&&r.score>=0&&r.score<=1&&typeof r.margin==='number'&&Number.isFinite(r.margin)&&r.margin>=0&&r.margin<=1,'Invalid recognition scores');
   if(r.outcome==='rejected')ok(r.accepted===false&&r.label===null,'Rejected field cannot claim a label');
   else{ok(r.accepted===true&&typeof r.label==='string'&&(r.kind==='card'?/^[2-9TJQKA][cdhs]$/:/^\d{1,6}(\.\d{1,2})?$/).test(r.label),'Invalid accepted label');ok((r.outcome==='correct-match')===(r.expected!==null&&r.label===r.expected),'Recognition outcome contradicts its labels');}
  }
 }
 report.summary=X.summarize(report.rows);report.complete=report.summary.overall.unscored===0;return report;
}
function labelsState(l,assets){
 keys(l,['dataset','synthetic','report','files','editor'],'image validation workspace');ok(typeof l.synthetic==='boolean','Invalid synthetic dataset flag');
 if(l.dataset!==null){if(Array.isArray(l.dataset.cases)&&!l.dataset.cases.length){const example={...l.dataset,cases:[{id:'draft',image:'draft.png',table:1,fields:[{field:'draft',kind:'amount',expected:null}]}]};X.manifest(example);}else l.dataset=X.manifest(l.dataset);}
 ok(Array.isArray(l.files)&&l.files.length<=100&&new Set(l.files).size===l.files.length,'Invalid selected image references');
 const selected=l.files.map(id=>{ok(assets.has(id),'Missing image asset reference');return assets.get(id);});X.files(selected);ok(!l.synthetic||!l.files.length,'Synthetic fixtures cannot bind uploaded image assets');
 l.report=imageReport(l.report,l.dataset);keys(l.editor,['name','image','table','field','mode','value'],'label editor');
 for(const k of ['name','image','field','value'])str(l.editor[k],k==='value'?100:200,'label editor '+k);integer(l.editor.table,1,10,'label table');ok(['known','reject'].includes(l.editor.mode),'Invalid expected-label mode');return l;
}
function benchmarkState(b){
 keys(b,['settings','report'],'benchmark workspace');keys(b.settings,['profile','workers','updates','budget','deadline'],'benchmark settings');for(const value of Object.values(b.settings))str(value,100,'benchmark setting');
 const r=b.report;if(r===null)return b;bounded(r,2000000,'Benchmark report');ok(r.format==='eightmax-study-benchmark'&&r.version===1&&r.capacityEstablished===false,'Invalid benchmark report');A.input(r.profile);
 ok(Array.isArray(r.rounds)&&r.rounds.length>=1&&r.rounds.length<=4,'Invalid benchmark rounds');const counts=new Set();
 for(const round of r.rounds){integer(round.tables,1,10,'benchmark count');ok(!counts.has(round.tables),'Duplicate benchmark round');counts.add(round.tables);ok(Array.isArray(round.rows)&&round.rows.length===round.tables,'Invalid benchmark rows');const slots=new Set();
  for(const row of round.rows){integer(row.slot,1,round.tables,'benchmark slot');ok(!slots.has(row.slot)&&typeof row.ok==='boolean','Invalid benchmark row identity');slots.add(row.slot);
   if(row.ok){for(const k of ['endToEndMs','queueMs','runMs'])ok(typeof row[k]==='number'&&Number.isFinite(row[k])&&row[k]>=0,'Invalid benchmark timing');integer(row.updates,0,50000,'benchmark updates');str(row.stopped,100,'benchmark stop reason');}
   else if(row.error!==undefined)str(row.error,2000,'benchmark error');ok(row.deadlineMiss===undefined||typeof row.deadlineMiss==='boolean','Invalid deadline flag');
  }Object.assign(round,B.summary(round.rows));
 }
 if(r.cachedRetrieval&&r.cachedRetrieval.available)for(const k of ['p50Ms','p95Ms'])ok(typeof r.cachedRetrieval[k]==='number'&&Number.isFinite(r.cachedRetrieval[k])&&r.cachedRetrieval[k]>=0,'Invalid cached lookup time');return b;
}
function encode(model){const text=JSON.stringify(model);ok(text.length<=MAX_BYTES&&new Blob([text]).size<=MAX_BYTES,'Workspace exceeds 220 MB');return text;}
function load(text){
 ok(typeof text==='string'&&text.length<=MAX_BYTES&&new Blob([text]).size<=MAX_BYTES,'Workspace exceeds 220 MB');const d=JSON.parse(text);
 keys(d,['format','version','appVersion','engine','simulation','studies','calibration','review','labels','benchmark','diagnostics','assets','decisionReady'],'workspace');
 ok(d.format===FORMAT&&[1,2,VERSION].includes(d.version)&&d.engine&&d.engine.build===A.ENGINE.build&&d.decisionReady===false,'Unsupported workspace or engine build');str(d.appVersion,30,'app version');
 const assets=assetMap(d.assets);bounded(d.simulation,20000000,'Simulation session');const simulation=S.load(JSON.stringify(d.simulation));studyState(d.studies,d.version);
 keys(d.calibration,['value','image','selection','editor'],'calibration workspace');const calibration=V.Calibration.load(JSON.stringify(d.calibration.value));ok(d.calibration.image===null||assets.has(d.calibration.image),'Missing calibration image reference');
 if(d.calibration.selection!==null)new V.Calibration().setRegion(1,'selection','card',d.calibration.selection,1);
 keys(d.calibration.editor,['table','field','kind','label'],'calibration editor');integer(d.calibration.editor.table,1,10,'calibration table');str(d.calibration.editor.field,100,'calibration field');str(d.calibration.editor.label,100,'reference label');ok(['card','amount'].includes(d.calibration.editor.kind),'Invalid calibration editor kind');
 if(d.version===1){ok(d.review.anchorScope===undefined,'Unexpected version-1 anchor scope');d.review.anchorScope='original';}keys(d.review,['progress','ranges','table','anchorScope'],'observation workspace');ok(['original','street'].includes(d.review.anchorScope),'Invalid reviewed anchor scope');str(d.review.ranges,16000,'reviewed ranges');integer(d.review.table,1,10,'review table');const review=d.review.progress===null?null:R.load(JSON.stringify(d.review.progress));
 labelsState(d.labels,assets);benchmarkState(d.benchmark);keys(d.diagnostics,['browser','windows'],'saved diagnostics');for(const kind of ['browser','windows'])if(d.diagnostics[kind]!==null)diagnostic(d.diagnostics[kind],kind);const sourceVersion=d.version;d.version=VERSION;return {model:d,sourceVersion,simulation,calibration,review,assets};
}
function diagnostic(value,kind){bounded(value,1000000,'Diagnostics report');ok(value&&value.format===(kind==='windows'?'eightmax-windows-diagnostics':'eightmax-browser-diagnostics')&&value.version===1&&value.liveCapacityEstablished===false,'Unsupported diagnostics report');ok(Array.isArray(value.checks)&&value.checks.length<=100,'Invalid diagnostics checks');for(const c of value.checks){str(c.name,100,'check name');str(c.message,2000,'check detail');ok(typeof c.passed==='boolean'&&typeof c.required==='boolean','Invalid diagnostics check');}return copy(value);}
function blob(asset){
 if(asset.base64===null)return null;const binary=atob(asset.base64),bytes=new Uint8Array(binary.length);for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i);
 const file=new Blob([bytes],{type:asset.type});Object.defineProperty(file,'name',{value:asset.name});return file;
}
async function packAsset(id,file,include){
 X.files([file]);let data=null;if(include){const bytes=new Uint8Array(await file.arrayBuffer());ok(bytes.length===file.size,'Image changed while saving');let binary='';
  for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));data=btoa(binary);}
 return {id,name:file.name,type:file.type,size:file.size,base64:data};
}
return {FORMAT,VERSION,MAX_BYTES,MAX_ASSET_BYTES,guidedIds,encode,load,blob,packAsset,imageReport,benchmarkState,diagnostic};
});
