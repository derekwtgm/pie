(function(){
'use strict';
const $=id=>document.getElementById(id),O=window.WorkbenchObservations,R=window.WorkbenchReviewSession;
const recoveryKey='eightmax-observation-review-recovery-v1';
let session=null,tracker=new O.Tracker(),generation=0,importTicket=0,lastAttempt='',chosenId=null,inspection=null,inspectionIndex=0;
const status=s=>{$('observation-status').textContent=s;};
const recoveryStatus=s=>{$('observation-recovery-status').textContent=s;};
const token=()=>generation+':'+(session?session.revision:0);
function download(name,data){
 const url=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderInspection(){
 const steps=inspection?inspection.steps:[],empty=steps.length===0;
 $('observation-hand-slider').min='0';$('observation-hand-slider').max=String(Math.max(0,steps.length-1));
 $('observation-hand-slider').value=String(inspectionIndex);$('observation-hand-slider').disabled=empty;
 $('observation-hand-prev').disabled=empty||inspectionIndex===0;
 $('observation-hand-next').disabled=empty||inspectionIndex===steps.length-1;
 $('observation-hand-export').disabled=empty;
 if(empty){$('observation-hand-caption').textContent='Complete a hand to inspect its accepted snapshots.';$('observation-hand-state').textContent='';return;}
 const step=steps[inspectionIndex],record=inspection.record;
 $('observation-hand-caption').textContent='Record '+record.recordId+' | Table '+record.table+' | '+record.hand+
  ' | Accepted step '+(inspectionIndex+1)+' / '+steps.length+' | Source frame '+(step.sourceIndex+1)+
  ' | '+step.transition.kind+' | '+record.anchorStreet+' anchor'+(inspection.truncated?' | Earlier accepted steps omitted':'')+
  '. Supplied evidence; not an authenticated client history.';
 $('observation-hand-state').textContent=JSON.stringify({transition:step.transition,state:step.state},null,2);
}
function chooseInspection(id){
 chosenId=id;inspection=null;inspectionIndex=0;
 if(session&&id!==null){try{inspection=session.inspect(id);}catch(e){status('Hand inspection unavailable: '+e.message);}}
 renderInspection();
}
function render(){
 const report=tracker.export({details:false,maxEvents:30});
 $('observation-completed').textContent=JSON.stringify(report.completedHands,null,2);
 $('observation-summary').textContent=JSON.stringify({framesProcessed:session?session.cursor:0,framesLoaded:session?session.sequence.frames.length:0,
  source:session?session.sequence.source:null,decisionReady:false,tables:report.tables},null,2);
 $('observation-events').textContent=JSON.stringify(report.events,null,2);
 $('observation-timeline').textContent=report.events.filter(e=>e.transition).map(e=>{
  const a=e.transition.action;return 'Table '+e.table+' | '+(a?a.street+' | Seat '+(a.seat+1)+' '+a.type+' | paid '+a.paid+' chips, street total '+a.to:e.message);
 }).join('\n')||'No reconstructed actions yet.';
 const hands=report.completedHands,select=$('observation-hand-select');
 select.innerHTML=hands.length?hands.map(h=>'<option value="'+h.recordId+'">Record '+h.recordId+' · Table '+h.table+' · '+h.hand+'</option>').join(''):'<option value="">No completed hands</option>';
 select.disabled=hands.length===0;
 if(!hands.some(h=>h.recordId===chosenId))chooseInspection(hands.length?hands.at(-1).recordId:null);
 select.value=chosenId===null?'':String(chosenId);renderInspection();
}
function install(next,restored=false){
 session=next;tracker=next.tracker;generation++;importTicket++;chosenId=null;inspection=null;inspectionIndex=0;
 const d=session.sequence,tables=new Set(d.frames.map(f=>f&&f.table).filter(t=>Number.isInteger(t)&&t>=1&&t<=10));
 $('observation-preview').textContent='Import preview: '+d.source+' | '+d.frames.length+' frames | '+tables.size+
  ' table identities. '+(restored?'Saved prefix re-audited; remaining frames have not yet passed the audit.':'Frames have not yet passed the audit. Step through them or process a bounded batch.');
 status(restored?'Review rebuilt through frame '+session.cursor+'. Use Next frame or Process to continue manually.':
  'Sequence loaded: '+d.source+'. No solver requests or client actions will be made.');
 recoveryStatus('Review changes are saved locally every 3 seconds when storage is available. Save a review file to keep a portable copy.');
 render();
}
function load(d){install(new R.Session(d));}
function demo(){
 const state={street:'flop',board:['2c','3d','4h'],hero:['As','Ad'],actor:0,bigBlind:100,pot:450,deadMoney:50,
  seats:[{stack:1000,committed:100,bet:0,folded:false},{stack:900,committed:200,bet:100,folded:false},{stack:1000,committed:100,bet:0,folded:false}]};
 const after=JSON.parse(JSON.stringify(state));after.seats[0]={stack:900,committed:200,bet:100,folded:false};after.pot=550;after.actor=2;
 const folded=JSON.parse(JSON.stringify(after));folded.seats[2].folded=true;folded.actor=1;
 return {format:'eightmax-observation-sequence',version:1,source:'synthetic',frames:[state,state,after,after,folded,folded].map((s,i)=>({
  table:1,hand:'demo-hand',frame:'demo-'+i,sequence:i,timeMs:i*200,quality:{accepted:true,minScore:.99,minMargin:.1},state:JSON.parse(JSON.stringify(s))}))};
}
$('observations-nav').onclick=()=>{$('observations-panel').hidden=false;$('observations-panel').scrollIntoView({behavior:'smooth'});};
$('close-observations').onclick=()=>{$('observations-panel').hidden=true;};
$('observation-demo').onclick=()=>load(demo());
$('observation-verified-demo').onclick=()=>{
 const base={street:'flop',board:['2c','3d','4h'],hero:['As','Ad'],actor:0,bigBlind:100,pot:200,deadMoney:0,roundStart:{dealer:1},
  seats:[{stack:1000,committed:100,bet:0,folded:false},{stack:1000,committed:100,bet:0,folded:false}]};
 const bet=JSON.parse(JSON.stringify(base));bet.seats[0]={stack:800,committed:300,bet:200,folded:false};bet.pot=400;bet.actor=1;
 const turn=JSON.parse(JSON.stringify(bet));turn.street='turn';turn.board.push('8s');turn.seats[1]={stack:800,committed:300,bet:0,folded:false};turn.seats[0].bet=0;turn.pot=600;turn.actor=0;
 load({format:'eightmax-observation-sequence',version:1,source:'synthetic',frames:[base,base,bet,bet,turn,turn].map((state,i)=>({
  table:1,hand:'verified-demo',frame:'verified-'+i,sequence:i,timeMs:i*200,quality:{accepted:true,minScore:.99,minMargin:.1},state}))});
};
$('observation-completed-demo').onclick=()=>load(window.WorkbenchCompletedDemo.session());
$('observation-sidepot-demo').onclick=()=>load(window.WorkbenchCompletedDemo.sidepots());
$('observation-preflop-demo').onclick=()=>load(window.WorkbenchPreflopDemo.create(Number($('observation-demo-seats').value)));
function prepareHistory(proof){if($('observation-anchor-scope').value==='street')proof=window.WorkbenchReviewed.latestStreet(proof);const ranges=$('observation-ranges').value.split(/\r?\n/).map(s=>s.trim()),draft=window.WorkbenchReviewed.draft(proof,ranges);window.openReviewedPosition(draft.config,draft.proof);status('Reviewed history copied into a study draft. Exact engine path is checked only when you explicitly run it.');}
$('observation-history-to-study').onclick=()=>{try{if(!session)throw Error('Load a review first');prepareHistory(session.trajectory(Number($('observation-table').value)));}catch(e){status('Reviewed-history study unavailable: '+e.message);}};
$('observation-hand-to-study').onclick=()=>{try{if(!session||!inspection)throw Error('Select a completed-hand accepted step first');prepareHistory(session.inspectedTrajectory(inspection.record.recordId,inspectionIndex));}catch(e){status('Selected-step study unavailable: '+e.message);}};
$('observation-study-demo').onclick=()=>{load(window.WorkbenchReviewedDemo.create());$('observation-ranges').value='AsAd\nKsKd';};
$('observation-to-study').onclick=()=>{
 try{
  const table=Number($('observation-table').value),t=tracker.tables.get(table);
  if(!t||t.status!=='stable'||!t.round)throw Error('Select a stable table with a verified betting anchor');
  const ranges=$('observation-ranges').value.split(/\r?\n/).map(s=>s.trim()),draft=window.WorkbenchRound.study(t.accepted,t.round,ranges);
  window.openReviewedStudy(draft.config,draft);status('Street-start study draft prepared. Review its explicit ranges and run it manually. No analysis or action was started.');
 }catch(e){status('Study draft unavailable: '+e.message);}
};
function fileInput(inputId,limit,opener,label){
 $(inputId).onchange=async()=>{
  const f=$(inputId).files[0];$(inputId).value='';if(!f)return;const ticket=++importTicket;
  try{
   if(f.size>limit)throw Error('File exceeds '+(limit/1000000)+' MB');
   const text=await f.text();if(ticket!==importTicket)return;
   opener(text);
  }catch(e){if(ticket===importTicket)status(label+' was not loaded: '+e.message);}
 };
}
$('observation-open').onclick=()=>$('observation-file').click();
fileInput('observation-file',10000000,text=>load(O.sequence(text)),'Sequence');
$('observation-review-open').onclick=()=>$('observation-review-file').click();
fileInput('observation-review-file',R.MAX_BYTES,text=>install(R.load(text),true),'Review');
$('observation-review-save').onclick=()=>{
 try{if(!session)throw Error('Load an observation sequence first');download('EightMax-observation-review.json',session.serialize());
  recoveryStatus('Review file saved with original frames, cursor and reviewed reset history. It resumes only when you process more frames.');
 }catch(e){status('Review was not saved: '+e.message);}
};
$('observation-step').onclick=()=>{
 try{const event=session?session.next():null;if(!event){status('No further frames. Load a sequence or the demo.');return;}
  status(event.status+': '+event.message);render();
 }catch(e){status(e.message);}
};
$('observation-all').onclick=()=>{
 if(!session){status('Load a sequence first.');return;}
 try{session.batch();render();const paused=Array.from(tracker.tables.values()).filter(t=>t.status==='paused').length;
  status('Processed through frame '+session.cursor+'. '+paused+' paused table(s); inspect before continuing.');
 }catch(e){status(e.message);render();}
};
$('observation-reset').onclick=()=>{
 try{if(!session)throw Error('Load an observation sequence first');session.reset(Number($('observation-table').value));
  status('Table reset for a new reviewed anchor. Reset history is retained in review files.');render();
 }catch(e){status(e.message);}
};
$('observation-export').onclick=()=>download('EightMax-observation-audit.json',tracker.export());
$('observation-export-hands').onclick=()=>download('EightMax-completed-hands.json',{
 format:'eightmax-completed-hands',version:1,hands:tracker.export().completedHands,decisionReady:false});
$('observation-hand-select').onchange=()=>chooseInspection(Number($('observation-hand-select').value));
$('observation-hand-slider').oninput=()=>{
 if(!inspection)return;inspectionIndex=Math.max(0,Math.min(inspection.steps.length-1,Math.floor(Number($('observation-hand-slider').value)||0)));renderInspection();
};
$('observation-hand-prev').onclick=()=>{if(inspection){inspectionIndex=Math.max(0,inspectionIndex-1);renderInspection();}};
$('observation-hand-next').onclick=()=>{if(inspection){inspectionIndex=Math.min(inspection.steps.length-1,inspectionIndex+1);renderInspection();}};
$('observation-hand-export').onclick=()=>{
 if(!inspection){status('Complete and select a hand first.');return;}
 download('EightMax-hand-review-'+inspection.record.recordId+'.json',inspection);
};
$('observation-review-recover').onclick=()=>{
 try{const text=localStorage.getItem(recoveryKey);if(!text)throw Error('No automatic review save is available');
  install(R.load(text),true);lastAttempt=token();recoveryStatus('Automatic review save reopened. Original frames were re-audited; continue manually.');
 }catch(e){status('Review recovery was not loaded: '+e.message);}
};
$('observation-review-clear').onclick=()=>{
 try{localStorage.removeItem(recoveryKey);lastAttempt=token();recoveryStatus('Automatic review save cleared. Further review changes will create a new save.');}
 catch(e){recoveryStatus('Automatic review storage could not be cleared.');}
};
try{if(localStorage.getItem(recoveryKey))recoveryStatus('An earlier review save is available. Choose Recover review to reopen it; nothing resumes automatically.');}
catch(e){recoveryStatus('Automatic review storage is unavailable. Use Save review progress.');}
setInterval(()=>{
 if(!session||lastAttempt===token())return;lastAttempt=token();
 try{localStorage.setItem(recoveryKey,session.serialize());recoveryStatus('Review recovery saved at '+new Date().toLocaleTimeString()+'. Includes source frames and reset history.');}
 catch(e){recoveryStatus('Automatic review recovery could not save. Use Save review progress.');}
},3000);
window.reviewRecognition=packet=>{
 $('recognition-review').textContent=JSON.stringify(packet,null,2);status('Image field results received for review only. Complete hand identity, seat states, turn and ledger evidence are still required.');
 $('observations-panel').hidden=false;
};
window.WorkspaceReview={capture(){return {progress:session?JSON.parse(session.serialize()):null,ranges:$('observation-ranges').value,table:Number($('observation-table').value),anchorScope:$('observation-anchor-scope').value||'original'};},apply(data,prepared){if(prepared)install(prepared,true);else{session=null;tracker=new O.Tracker();generation++;importTicket++;chosenId=null;inspection=null;inspectionIndex=0;$('observation-preview').textContent='No sequence selected.';render();} $('observation-ranges').value=data.ranges;$('observation-table').value=String(data.table);$('observation-anchor-scope').value=data.anchorScope||'original';lastAttempt=token();status('Workspace review restored. Continue processing manually.');}};
render();
})();
