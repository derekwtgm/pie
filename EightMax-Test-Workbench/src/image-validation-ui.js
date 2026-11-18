(function(){
'use strict';
const $=id=>document.getElementById(id),X=window.WorkbenchImageValidation,D=window.WorkbenchImageValidationDemo;
const runner=new X.Runner();let dataset=null,imageFiles=[],missingFiles=[],demo=null,report=null,generation=0,previewGeneration=0,editorFields=new Map(),computeLease=null;const workloads=window.workbenchWorkloads;
const status=s=>{$('image-validation-status').textContent=s;};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function busy(value){window.workbenchImageValidationBusy=value;$('image-validation-run').disabled=value;$('image-validation-stop').disabled=!value;$('image-validation-show').disabled=value;}
function clearPreview(){previewGeneration++;const canvas=$('image-validation-canvas');canvas.width=canvas.height=1;canvas.hidden=true;}
function invalidate(message){generation++;runner.cancel();workloads.release(computeLease);computeLease=null;busy(false);clearPreview();report=null;$('image-validation-results').innerHTML='';$('image-validation-detail').textContent='';status(message);}
function refreshLabel(){
 const item=dataset&&dataset.cases.find(c=>c.image===$('image-label-image').value&&c.table===Number($('image-label-table').value));
 const field=item&&item.fields.find(f=>f.field===$('image-label-field').value);
 $('image-label-mode').value=field&&field.expected===null?'reject':'known';$('image-label-value').value=field&&field.expected!==null?field.expected:'';
 $('image-label-value').disabled=$('image-label-mode').value==='reject';
}
function refreshEditor(){
 const imageSelect=$('image-label-image'),oldImage=imageSelect.value;
 imageSelect.innerHTML=imageFiles.map(f=>'<option value="'+escape(f.name)+'">'+escape(f.name)+'</option>').join('');
 imageSelect.value=imageFiles.some(f=>f.name===oldImage)?oldImage:imageFiles.length?imageFiles[0].name:'';
 const table=Number($('image-label-table').value),calibration=demo?demo.calibration.export():window.getImageCalibration();
 editorFields=new Map(calibration.regions.filter(r=>r.table===table).map(r=>[r.field,r.kind]));
 const item=dataset&&dataset.cases.find(c=>c.image===imageSelect.value&&c.table===table);
 if(item)for(const f of item.fields)if(!editorFields.has(f.field))editorFields.set(f.field,f.kind);
 const select=$('image-label-field'),oldField=select.value;
 select.innerHTML=Array.from(editorFields,([name,kind])=>'<option value="'+escape(name)+'">'+escape(name)+' ('+kind+')</option>').join('');
 select.value=editorFields.has(oldField)?oldField:editorFields.size?editorFields.keys().next().value:'';refreshLabel();
}
function preview(){
 $('image-validation-preview').textContent=dataset?dataset.name+' | '+dataset.source+' | '+dataset.cases.length+' labeled cases | '+
  dataset.cases.reduce((n,c)=>n+c.fields.length,0)+' expected fields | '+imageFiles.length+' selected image files | Calibration: '+(demo?'synthetic pattern references':'current Image calibration'):
  'No labeled dataset loaded. Create labels or open a manifest, then select PNG/JPEG files.';
 refreshEditor();
}
function display(data){
 const s=data.summary.overall,percent=n=>n===null?'Unavailable':(100*n).toFixed(1)+'%';
 const row=(label,value)=>'<tr><th>'+label+'</th><td>'+value+'</td></tr>';
 $('image-validation-results').innerHTML='<div class="result-table-wrap"><table class="result-table">'+
  row('Evaluation',data.complete?'All labeled fields scored':'Incomplete: some fields have no usable evidence')+
  row('Accepted label accuracy',percent(s.acceptedAccuracy))+row('Known-field coverage',percent(s.knownCoverage))+
  row('Correct accepted labels',s.acceptedCorrect)+row('Wrong accepted labels (including must-reject fields)',s.acceptedWrong)+
  row('Rejected known fields / correctly rejected negative fields',s.rejectedKnown+' / '+s.correctRejections)+
  row('Unscored fields',s.unscored)+row('Exact reference crop overlap',s.exactReferenceOverlap)+
  row('Accepted accuracy without exact reference overlap',percent(data.summary.withoutExactReferenceOverlap.acceptedAccuracy))+
  '</table></div><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Table</th><th>Field</th><th>Scored</th><th>Correct</th><th>Wrong</th><th>Rejected known</th><th>Unscored</th></tr></thead><tbody>'+
  data.summary.byField.map(x=>'<tr><td>'+x.table+'</td><td>'+escape(x.field)+'</td><td>'+x.metrics.scored+'</td><td>'+x.metrics.acceptedCorrect+'</td><td>'+x.metrics.acceptedWrong+'</td><td>'+x.metrics.rejectedKnown+'</td><td>'+x.metrics.unscored+'</td></tr>').join('')+
  '</tbody></table></div>';
 $('image-validation-detail').textContent=JSON.stringify({dataset:data.dataset,summary:data.summary,errors:data.errors,rows:data.rows},null,2);
}
async function decode(file){
 let bitmap=null,canvas=null;
 try{
  bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>20000000)throw Error('Image exceeds 20 megapixels');
  canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas image reader unavailable');ctx.drawImage(bitmap,0,0);
  return ctx.getImageData(0,0,bitmap.width,bitmap.height);
 }finally{if(bitmap)bitmap.close();if(canvas){canvas.width=canvas.height=1;}}
}
$('image-validation-nav').onclick=()=>{$('image-validation-panel').hidden=false;$('image-validation-panel').scrollIntoView({behavior:'smooth'});};
$('close-image-validation').onclick=()=>{$('image-validation-panel').hidden=true;};
$('image-validation-demo').onclick=()=>{
 const next=D.create();invalidate('Synthetic pipeline demo loaded. It deliberately includes wrong labels, must-reject cases and reference overlap. This is not a client-recognition score.');
 demo=next;dataset=next.dataset;imageFiles=next.files;missingFiles=[];$('image-label-name').value=dataset.name;preview();
};
$('image-validation-manifest-open').onclick=()=>$('image-validation-manifest-file').click();
$('image-validation-manifest-file').onchange=async()=>{
 const file=$('image-validation-manifest-file').files[0];$('image-validation-manifest-file').value='';if(!file)return;
 const ticket=++generation;runner.cancel();busy(false);
 try{
  if(file.size>X.MAX_MANIFEST_BYTES)throw Error('Dataset manifest exceeds 4 MB');const text=await file.text();if(ticket!==generation)return;
  const next=X.manifest(text);invalidate('Labeled manifest loaded. Select its PNG/JPEG files and use your current calibration.');
  if(demo)imageFiles=[];demo=null;dataset=next;$('image-label-name').value=dataset.name;preview();
 }catch(e){if(ticket===generation)status('Dataset was not loaded: '+e.message);}
};
$('image-validation-images-open').onclick=()=>$('image-validation-image-files').click();
$('image-validation-image-files').onchange=()=>{
 const next=Array.from($('image-validation-image-files').files||[]);$('image-validation-image-files').value='';if(!next.length)return;
 try{X.files(next);invalidate('Image files selected. Readable image evidence will be checked during validation.');imageFiles=next;missingFiles=[];demo=null;preview();}
 catch(e){status('Image files were not selected: '+e.message);}
};
$('image-validation-new').onclick=()=>{
 invalidate('New recorded-screenshot label set started. Select images, choose a table/field and add each expected label. Unknown fields can be left unlabeled.');
 if(demo)imageFiles=[];demo=null;dataset={format:'eightmax-image-dataset',version:1,source:'recorded-screenshot',name:$('image-label-name').value||'Recorded screenshots',cases:[]};preview();
};
$('image-label-image').onchange=()=>{clearPreview();refreshEditor();};
$('image-label-table').onchange=()=>{refreshEditor();};$('image-label-field').onchange=refreshLabel;
$('image-label-mode').onchange=()=>{$('image-label-value').disabled=$('image-label-mode').value==='reject';};
$('image-label-add').onclick=()=>{
 try{
  if(!dataset)throw Error('Create or load a labeled dataset first');const image=$('image-label-image').value,table=Number($('image-label-table').value),field=$('image-label-field').value;
  if(!imageFiles.some(f=>f.name===image))throw Error('Select a dataset image first');if(!editorFields.has(field))throw Error('Add Image calibration regions for this table first');
  const next=JSON.parse(JSON.stringify(dataset));next.name=$('image-label-name').value||next.name;
  let item=next.cases.find(c=>c.image===image&&c.table===table);
  if(!item){let n=1;while(next.cases.some(c=>c.id==='case-'+n))n++;item={id:'case-'+n,image,table,fields:[]};next.cases.push(item);}
  const expected=$('image-label-mode').value==='reject'?null:$('image-label-value').value.trim(),row={field,kind:editorFields.get(field),expected};
  const i=item.fields.findIndex(f=>f.field===field);if(i<0)item.fields.push(row);else item.fields[i]=row;
  const validated=X.manifest(next);invalidate('Expected field saved. Add other visible fields, or run validation. A must-reject label is explicit; unlabeled fields are not scored.');dataset=validated;preview();
 }catch(e){status('Expected label was not saved: '+e.message);}
};
$('image-label-remove').onclick=()=>{
 if(!dataset)return;const next=JSON.parse(JSON.stringify(dataset)),image=$('image-label-image').value,table=Number($('image-label-table').value),field=$('image-label-field').value;
 const item=next.cases.find(c=>c.image===image&&c.table===table);if(!item||!item.fields.some(f=>f.field===field)){status('No saved label for this image/table/field.');return;}
 item.fields=item.fields.filter(f=>f.field!==field);next.cases=next.cases.filter(c=>c.fields.length);
 invalidate('Expected field removed. Unlabeled fields are not scored.');dataset=next;preview();
};
$('image-validation-labels-export').onclick=()=>{
 try{const data=X.manifest(dataset),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='EightMax-image-dataset.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){status('Labels were not exported: '+e.message);}
};
$('image-validation-show').onclick=async()=>{
 if(window.workbenchImageValidationBusy){status('Stop validation before previewing an image.');return;}
 const ticket=++previewGeneration,file=imageFiles.find(f=>f.name===$('image-label-image').value);
 try{
  if(!file)throw Error('Select a dataset image first');const img=demo?demo.images.get(file.name):await decode(file);if(ticket!==previewGeneration)return;
  const canvas=$('image-validation-canvas');canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d').putImageData(img,0,0);canvas.hidden=false;
  status('Showing '+file.name+'. Enter ground truth from your visual review; this preview does not infer labels.');
 }catch(e){if(ticket===previewGeneration)status('Image preview unavailable: '+e.message);}
};
window.imageCalibrationChanged=()=>{
 invalidate('Calibration changed. Run validation again before using a previous score.');if(demo){demo=null;imageFiles=[];}preview();
};
window.stopImageValidation=()=>{
 if(window.workbenchImageValidationBusy)invalidate('Image validation stopped. Partial results are not a completed report.');
};
$('image-validation-stop').onclick=window.stopImageValidation;
$('image-validation-run').onclick=async()=>{
 const ticket=++generation;runner.cancel();workloads.release(computeLease);computeLease=null;let ownedLease=null;clearPreview();report=null;$('image-validation-results').innerHTML='';$('image-validation-detail').textContent='';
 try{
  if(!dataset)throw Error('Load a labeled dataset first');if(!imageFiles.length)throw Error('Select the dataset images first');
  if(window.workbench.coordinator.stopped)throw Error('Reset the emergency stop before validating images');
  if(window.workbenchBenchmarkBusy)throw Error('Stop the capacity test before validating images');
  const calibration=demo?demo.calibration:window.getImageCalibration();
  if(!calibration.regions.length)throw Error('Add or load Image calibration regions first');
  if(window.workbenchDesktopNativeBusy?.())throw Error('Stop the managed native study and confirm cancellation before validating images');workloads.check('images',['study']);
  window.workbench.coordinator.pause();window.workbench.render();if(window.stopStudies)window.stopStudies('Image validation started');ownedLease=workloads.acquire('images',null,'Checking compute availability');computeLease=ownedLease;busy(true);
  if(window.workbenchHasDesktop){await window.workbenchConfirmNativeIdle();if(ticket!==generation||!workloads.owns(ownedLease))return;}workloads.update(ownedLease,'Reading labeled images');status('Reading selected images one at a time. Nothing is forwarded to observation review or a solver.');
  const demoImages=demo?demo.images:null;
  const data=await runner.run({dataset,calibration,imageFiles,decode:demoImages?async f=>demoImages.get(f.name):decode,
   yieldControl:()=>new Promise(resolve=>setTimeout(resolve,0)),
   onProgress:p=>{if(ticket===generation)status('Processed '+p.processedImages+' / '+p.totalImages+' image names; '+p.fieldsProcessed+' labeled fields.');}});
  if(ticket!==generation)return;report=data;display(data);
  status((data.complete?'Validation finished.':'Validation finished with missing/unscored evidence.')+' Scores describe only this labeled dataset. Inspect wrong matches and reference overlap.');
 }catch(e){if(ticket===generation)status('Validation could not finish: '+e.message);}
 finally{workloads.release(ownedLease);if(computeLease===ownedLease)computeLease=null;if(ticket===generation)busy(false);}
};
$('image-validation-export').onclick=()=>{
 if(!report){status('Finish a validation run before exporting a report.');return;}
 const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');
 a.href=url;a.download='EightMax-image-validation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.WorkspaceLabels={capture(){return {dataset,synthetic:!!demo,report,files:[],editor:{name:$('image-label-name').value,image:$('image-label-image').value,table:Number($('image-label-table').value),field:$('image-label-field').value,mode:$('image-label-mode').value,value:$('image-label-value').value}};},files(){return demo?[]:imageFiles.concat(missingFiles);},apply(data,files,missing){invalidate('Workspace labels restored. No validation has been started.');dataset=data.dataset;demo=data.synthetic?D.create():null;imageFiles=demo?demo.files:files;missingFiles=missing;$('image-label-name').value=data.editor.name;$('image-label-image').value=data.editor.image;$('image-label-table').value=String(data.editor.table);preview();$('image-label-field').value=data.editor.field;$('image-label-mode').value=data.editor.mode;$('image-label-value').value=data.editor.value;$('image-label-value').disabled=data.editor.mode==='reject';report=data.report;if(report)display(report);status('Saved labels/report restored. '+missing.length+' original image file(s) must be reselected. Historical scores do not start a new run.');}};
busy(false);preview();
})();
