(function(){
'use strict';
const $=id=>document.getElementById(id),W=window.WorkbenchWorkspace,S=window.EightMaxSession,A=window.WorkbenchStudy;
const recoveryKey='eightmax-full-workspace-recovery-v1';let generation=0,checkGeneration=0,lastAttempt='',baseline='',diagnostics={browser:null,windows:null},checkQueue=null,checkLease=null;
const status=s=>{$('workspace-status').textContent=s;},checkStatus=s=>{$('diagnostics-status').textContent=s;};
function collect(rollingReplay=true){
 const model={format:W.FORMAT,version:W.VERSION,appVersion:window.EightMax.VERSION,engine:A.ENGINE,simulation:S.save(window.workbench.coordinator),studies:window.WorkspaceStudies.capture(),calibration:window.WorkspaceVision.capture(),review:window.WorkspaceReview.capture(),labels:window.WorkspaceLabels.capture(),benchmark:window.WorkspaceBenchmark.capture(),diagnostics,assets:[],decisionReady:false};
 if(!rollingReplay)model.simulation.recording=[];const entries=[];
 const add=file=>{const id='image-'+entries.length;entries.push(file);model.assets.push({id,name:file.name,type:file.type,size:file.size,base64:null});return id;};
 const source=window.WorkspaceVision.file();if(source)model.calibration.image=add(source);
 model.labels.files=window.WorkspaceLabels.files().map(add);
 return {model:JSON.parse(JSON.stringify(model)),entries};
}
function cancel(){if(window.stopStudies)window.stopStudies('Workspace operation');if(window.stopBenchmark)window.stopBenchmark();if(window.stopImageValidation)window.stopImageValidation();if(checkQueue||checkLease)window.cancelWorkspaceChecks();}
function decoded(prepared,entries){
 const map=new Map();for(const [id,asset] of prepared.assets){const index=prepared.model.assets.indexOf(asset),file=entries&&entries[index]&&typeof entries[index].arrayBuffer==='function'?entries[index]:W.blob(asset);map.set(id,file);}return map;
}
function commit(prepared,files){
 const d=prepared.model;cancel();window.workbench.replaceSession(prepared.simulation);window.WorkspaceStudies.apply(d.studies);
 const calibrationAsset=d.calibration.image&&prepared.assets.get(d.calibration.image);
 window.WorkspaceVision.apply(d.calibration,prepared.calibration,d.calibration.image?files.get(d.calibration.image):null,calibrationAsset&&!files.get(d.calibration.image)?{...calibrationAsset,unavailable:true}:null);
 const selected=d.labels.files.map(id=>files.get(id)).filter(Boolean),missing=d.labels.files.filter(id=>!files.get(id)).map(id=>({...prepared.assets.get(id),unavailable:true}));
 window.WorkspaceLabels.apply(d.labels,selected,missing);window.WorkspaceBenchmark.apply(d.benchmark);window.WorkspaceReview.apply(d.review,prepared.review);diagnostics=d.diagnostics;
 $('diagnostics-report').textContent=JSON.stringify(diagnostics,null,2);
}
function restore(text){
 const next=W.load(text),files=decoded(next),previous=collect(),old=W.load(W.encode(previous.model)),oldFiles=decoded(old,previous.entries);
 try{commit(next,files);}catch(e){try{commit(old,oldFiles);}catch(rollback){throw Error('Workspace restore failed and rollback could not finish: '+rollback.message);}throw e;}
 lastAttempt='';baseline=W.encode(collect(false).model);const missing=next.model.assets.filter(a=>!files.get(a.id)).length;
 status('Workspace restored with processing stopped. '+missing+' original image file(s) are not embedded and must be reselected. Native Windows processes/checkpoints are managed separately.');
}
function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('workspace-nav').onclick=()=>{$('workspace-panel').hidden=false;$('workspace-panel').scrollIntoView({behavior:'smooth'});};$('close-workspace').onclick=()=>{$('workspace-panel').hidden=true;};
$('workspace-save').onclick=async()=>{
 const ticket=++generation;
 try{const snapshot=collect(),include=$('workspace-images').checked;status('Preparing workspace backup…');
  for(let i=0;i<snapshot.entries.length;i++){const file=snapshot.entries[i];snapshot.model.assets[i]=await W.packAsset('image-'+i,file,include&&typeof file.arrayBuffer==='function');if(ticket!==generation)return;}
  const text=W.encode(snapshot.model);W.load(text);if(ticket!==generation)return;download('EightMax-workspace.json',text);
  const missing=snapshot.model.assets.filter(a=>a.base64===null).length;status('Workspace backup exported. '+missing+' image file(s) remain external references. Running calculations are not resumable; saved results and drafts are retained.');
 }catch(e){if(ticket===generation)status('Workspace was not saved: '+e.message);}
};
$('workspace-open').onclick=()=>$('workspace-file').click();$('workspace-file').onchange=async()=>{
 const f=$('workspace-file').files[0];$('workspace-file').value='';if(!f)return;const ticket=++generation;
 try{if(f.size>W.MAX_BYTES)throw Error('Workspace exceeds 220 MB');const text=await f.text();if(ticket!==generation)return;restore(text);}catch(e){if(ticket===generation)status('Workspace was not opened: '+e.message);}
};
$('workspace-recover').onclick=()=>{generation++;try{const text=localStorage.getItem(recoveryKey);if(!text)throw Error('No whole-workspace recovery save is available');restore(text);}catch(e){status('Workspace recovery was not opened: '+e.message);}};
$('workspace-clear').onclick=()=>{try{localStorage.removeItem(recoveryKey);baseline=W.encode(collect(false).model);lastAttempt=baseline;status('Whole-workspace automatic save cleared. Further edits can create a new save.');}catch(e){status('Recovery save could not be cleared: '+e.message);}};
try{baseline=W.encode(collect(false).model);if(localStorage.getItem(recoveryKey))status('An earlier whole-workspace save is available. Choose Recover workspace; nothing opens or resumes automatically.');}catch(e){status('Automatic workspace recovery unavailable. Use Save workspace file.');}
setInterval(()=>{try{const snapshot=collect(false),text=W.encode(snapshot.model);if(text===baseline||text===lastAttempt)return;lastAttempt=text;W.load(text);localStorage.setItem(recoveryKey,text);status('Whole-workspace recovery saved at '+new Date().toLocaleTimeString()+'. Image references only; use a manual backup to embed originals.');}catch(e){status('Whole-workspace automatic recovery could not save. Use Save workspace file: '+e.message);}},10000);
$('diagnostics-nav').onclick=()=>{$('diagnostics-panel').hidden=false;$('diagnostics-panel').scrollIntoView({behavior:'smooth'});};$('close-diagnostics').onclick=()=>{$('diagnostics-panel').hidden=true;};
$('browser-checks').onclick=async()=>{
 let ticket=checkGeneration,ownedQueue=null,ownedLease=null;const workloads=window.workbenchWorkloads,report={format:'eightmax-browser-diagnostics',version:1,appVersion:window.EightMax.VERSION,engine:A.ENGINE,liveCapacityEstablished:false,checks:[],environmentHints:{userAgent:typeof navigator==='undefined'?null:navigator.userAgent||null,logicalProcessors:typeof navigator==='undefined'?null:navigator.hardwareConcurrency||null,note:'Browser hints do not measure GPU/VRAM or whole-process RAM.'}};
 const check=(name,passed,message,required=true)=>report.checks.push({name,passed:!!passed,message,required});
 try{
  if(window.workbenchDesktopNativeBusy?.())throw Error('Stop the managed native study and confirm cancellation before browser checks');workloads.check('diagnostics',['study','benchmark','images','diagnostics']);cancel();ticket=++checkGeneration;ownedLease=workloads.acquire('diagnostics',null,'Checking compute availability');checkLease=ownedLease;
  if(window.workbench.coordinator.stopped)throw Error('Reset the emergency stop before browser checks');window.workbench.coordinator.pause();window.workbench.render();
  if(window.workbenchHasDesktop){await window.workbenchConfirmNativeIdle();if(ticket!==checkGeneration||!workloads.owns(ownedLease))return;}
  check('Embedded solver source',$('worker-source').textContent.includes('EM.wideGame'),'Bundled EightMax 5.1 worker source marker');
  try{localStorage.getItem(recoveryKey);check('Recovery storage readable',true,'Read succeeded; quota and future writes are not guaranteed',false);}catch(e){check('Recovery storage readable',false,e.message,false);}
  workloads.update(ownedLease,'Running bounded CPU worker');checkStatus('Running one bounded CPU worker check…');ownedQueue=new window.WorkbenchStudyQueue.Queue(()=>window.makeStudyWorker());checkQueue=ownedQueue;
  const result=await ownedQueue.submit(1,{config:A.EXAMPLES.practice2,iterations:20,timeMs:1000,deadlineMs:5000});if(ticket!==checkGeneration)return;A.validateResult(result);
  check('CPU worker study',result.updates===20&&result.hands.some(h=>h.stored),'Twenty updates requested; '+result.updates+' committed. This is an execution check, not convergence validation.');
 }catch(e){if(ticket!==checkGeneration)return;if(!ownedLease){checkStatus('Browser checks could not start: '+e.message);return;}check('CPU worker study',false,e.message);}
 finally{if(ownedQueue){ownedQueue.cancelAll();if(checkQueue===ownedQueue)checkQueue=null;}workloads.release(ownedLease);if(checkLease===ownedLease)checkLease=null;}
 if(ticket!==checkGeneration)return;diagnostics.browser=W.diagnostic(report,'browser');$('diagnostics-report').textContent=JSON.stringify(diagnostics,null,2);checkStatus('Browser checks complete. Windows startup/native execution require the separate Windows report.');
};
$('windows-report-open').onclick=()=>$('windows-report-file').click();$('windows-report-file').onchange=async()=>{const f=$('windows-report-file').files[0];$('windows-report-file').value='';if(!f)return;const ticket=++generation;try{if(f.size>1000000)throw Error('Windows report exceeds 1 MB');const text=await f.text();if(ticket!==generation)return;diagnostics.windows=W.diagnostic(JSON.parse(text),'windows');$('diagnostics-report').textContent=JSON.stringify(diagnostics,null,2);checkStatus('Windows report imported as supplied evidence. It is not an authenticated capacity certificate.');}catch(e){if(ticket===generation)checkStatus('Windows report was not opened: '+e.message);}};
$('diagnostics-export').onclick=()=>{if(!diagnostics.browser&&!diagnostics.windows){checkStatus('Run browser checks or import a Windows report first.');return;}download('EightMax-diagnostics.json',JSON.stringify(diagnostics,null,2));};
window.cancelWorkspaceChecks=()=>{const active=!!(checkQueue||checkLease);checkGeneration++;if(checkQueue)checkQueue.cancelAll();checkQueue=null;window.workbenchWorkloads.release(checkLease);checkLease=null;if(active)checkStatus('Browser checks cancelled. No completed diagnostic report was published.');};
})();
