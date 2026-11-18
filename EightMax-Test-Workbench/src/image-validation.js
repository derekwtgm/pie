/* Labeled, user-loaded screenshot evaluation. No capture, solver or action path. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./vision.js'));
 else root.WorkbenchImageValidation=factory(root.WorkbenchVision);
})(typeof globalThis!=='undefined'?globalThis:this,function(V){
'use strict';
const MAX_MANIFEST_BYTES=4000000,MAX_CASES=200,MAX_FIELDS=2000,MAX_FILES=100,MAX_FILE_BYTES=10000000,MAX_TOTAL_BYTES=100000000;
const copy=x=>JSON.parse(JSON.stringify(x)),ok=(v,m)=>{if(!v)throw Error(m);};
function integer(v,min,max,name){ok(Number.isSafeInteger(v)&&v>=min&&v<=max,'Invalid '+name);}
function keys(v,fields,name){ok(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.prototype.hasOwnProperty.call(v,k)),'Unsupported '+name+' fields');}
function filename(name){ok(typeof name==='string'&&name.length<=120&&/^.+\.(png|jpe?g)$/i.test(name)&&!/[\/\\\u0000-\u001f\u007f<>:"|?*]/.test(name)&&!name.includes('..'),'Use a plain PNG/JPEG filename without a path');return name;}
function expected(kind,value){
 ok(['card','amount'].includes(kind),'Unknown expected field kind');
 if(value===null)return;
 ok(typeof value==='string'&&(kind==='card'?/^[2-9TJQKA][cdhs]$/:/^\d{1,6}(\.\d{1,2})?$/).test(value),'Invalid expected label');
}
function manifest(input){
 const text=typeof input==='string'?input:JSON.stringify(input);
 ok(typeof text==='string'&&text.length<=MAX_MANIFEST_BYTES&&new Blob([text]).size<=MAX_MANIFEST_BYTES,'Dataset manifest exceeds 4 MB');
 const d=JSON.parse(text);keys(d,['format','version','source','name','cases'],'dataset');
 ok(d.format==='eightmax-image-dataset'&&d.version===1&&['synthetic','recorded-screenshot'].includes(d.source),'Unsupported image dataset');
 ok(typeof d.name==='string'&&d.name.length>=1&&d.name.length<=80,'Dataset name must be 1 to 80 characters');
 ok(Array.isArray(d.cases)&&d.cases.length>=1&&d.cases.length<=MAX_CASES,'Use 1 to 200 labeled cases');
 const identities=new Set(),targets=new Set(),images=new Set(),kinds=new Map();let fields=0;
 for(const c of d.cases){
  keys(c,['id','image','table','fields'],'dataset case');
  ok(typeof c.id==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(c.id)&&!identities.has(c.id),'Invalid or duplicate case identity');identities.add(c.id);
  filename(c.image);integer(c.table,1,10,'dataset table');
  const target=c.image.toLowerCase()+'|'+c.table;ok(!targets.has(target),'Duplicate image/table case');targets.add(target);images.add(c.image.toLowerCase());
  ok(Array.isArray(c.fields)&&c.fields.length>=1&&c.fields.length<=32,'Use 1 to 32 labeled fields per case');
  const names=new Set(),cards=new Set();
  for(const f of c.fields){
   keys(f,['field','kind','expected'],'expected field');
   ok(typeof f.field==='string'&&/^[a-z][a-z0-9_]{0,39}$/.test(f.field)&&!names.has(f.field),'Invalid or duplicate expected field');names.add(f.field);
   expected(f.kind,f.expected);const key=c.table+':'+f.field;ok(!kinds.has(key)||kinds.get(key)===f.kind,'Expected field kind changes across dataset');kinds.set(key,f.kind);
   if(f.kind==='card'&&f.expected!==null){ok(!cards.has(f.expected),'Duplicate expected visible card');cards.add(f.expected);}
   fields++;
  }
 }
 ok(fields<=MAX_FIELDS,'Dataset exceeds 2,000 labeled fields');ok(images.size<=MAX_FILES,'Dataset exceeds 100 image filenames');return d;
}
function files(input){
 const list=Array.from(input||[]);ok(list.length<=MAX_FILES,'Select at most 100 images');const map=new Map(),names=new Set();let bytes=0;
 for(const f of list){
  ok(f&&typeof f==='object','Invalid image file');filename(f.name);ok(!names.has(f.name.toLowerCase()),'Duplicate image filename');names.add(f.name.toLowerCase());
  integer(f.size,1,MAX_FILE_BYTES,'image file size');ok(['image/png','image/jpeg'].includes(f.type),'Use PNG or JPEG images');bytes+=f.size;map.set(f.name,f);
 }
 ok(bytes<=MAX_TOTAL_BYTES,'Selected images exceed 100 MB');return map;
}
function metric(){return {total:0,scored:0,unscored:0,knownExpected:0,mustRejectExpected:0,knownScored:0,mustRejectScored:0,acceptedCorrect:0,acceptedWrong:0,wrongLabel:0,falseAccepts:0,rejectedKnown:0,correctRejections:0,exactReferenceOverlap:0};}
function add(m,r){
 m.total++;
 if(r.expected===null)m.mustRejectExpected++;else m.knownExpected++;
 if(r.outcome==='unscored'){m.unscored++;return;}m.scored++;
 if(r.expected===null)m.mustRejectScored++;else m.knownScored++;
 if(r.exactReferenceOverlap)m.exactReferenceOverlap++;
 if(r.outcome==='correct-match')m.acceptedCorrect++;
 else if(r.outcome==='wrong-match'){m.acceptedWrong++;if(r.expected===null)m.falseAccepts++;else m.wrongLabel++;}
 else if(r.expected===null)m.correctRejections++;else m.rejectedKnown++;
}
function ratios(m){return {...m,acceptedAccuracy:m.acceptedCorrect+m.acceptedWrong?m.acceptedCorrect/(m.acceptedCorrect+m.acceptedWrong):null,
 knownCoverage:m.knownExpected?(m.acceptedCorrect+m.wrongLabel)/m.knownExpected:null,
 knownCorrectRate:m.knownExpected?m.acceptedCorrect/m.knownExpected:null,
 falseAcceptanceRate:m.mustRejectScored?m.falseAccepts/m.mustRejectScored:null};}
function summarize(rows){
 const all=metric(),heldOut=metric(),tables=new Map(),fields=new Map(),confusion=new Map();
 for(const r of rows){
  add(all,r);if(r.outcome!=='unscored'&&!r.exactReferenceOverlap)add(heldOut,r);
  if(!tables.has(r.table))tables.set(r.table,metric());add(tables.get(r.table),r);
  const key=r.table+':'+r.field;if(!fields.has(key))fields.set(key,{table:r.table,field:r.field,kind:r.kind,metrics:metric()});add(fields.get(key).metrics,r);
  if(r.outcome==='wrong-match'){const key=JSON.stringify([r.expected,r.label]);confusion.set(key,(confusion.get(key)||0)+1);}
 }
 return {overall:ratios(all),withoutExactReferenceOverlap:ratios(heldOut),byTable:Array.from(tables,([table,m])=>({table,metrics:ratios(m)})).sort((a,b)=>a.table-b.table),
  byField:Array.from(fields.values(),x=>({...x,metrics:ratios(x.metrics)})).sort((a,b)=>a.table-b.table||a.field.localeCompare(b.field)),
  confusions:Array.from(confusion,([key,count])=>{const [expected,predicted]=JSON.parse(key);return {expected,predicted,count};})};
}
function validImage(image){ok(image&&Number.isSafeInteger(image.width)&&image.width>0&&Number.isSafeInteger(image.height)&&image.height>0&&image.width*image.height<=20000000&&image.data&&ArrayBuffer.isView(image.data)&&['[object Uint8Array]','[object Uint8ClampedArray]'].includes(Object.prototype.toString.call(image.data))&&image.data.length===image.width*image.height*4,'Invalid or oversized decoded image');}
class Cancelled extends Error{constructor(){super('Image validation cancelled');this.code='cancelled';}}
class Runner{
 constructor(){this.generation=0;this.busy=false;}
 cancel(){this.generation++;this.busy=false;}
 async run({dataset,calibration,imageFiles,decode,onProgress=()=>{},yieldControl=async()=>{}}){
  this.cancel();const ticket=this.generation;this.busy=true;
  const current=()=>{if(ticket!==this.generation)throw new Cancelled();};
  try{
   const d=manifest(dataset),c=V.Calibration.load(JSON.stringify(calibration instanceof V.Calibration?calibration.export():calibration)),selected=files(imageFiles);
   ok(typeof decode==='function'&&typeof onProgress==='function'&&typeof yieldControl==='function','Invalid validation callbacks');
   const groups=new Map();for(const item of d.cases){if(!groups.has(item.image))groups.set(item.image,[]);groups.get(item.image).push(item);}
   const rows=[],errors=[];let processedImages=0,decodedImages=0;
   const unscored=(item,reason)=>{for(const f of item.fields)rows.push({caseId:item.id,image:item.image,table:item.table,field:f.field,kind:f.kind,expected:f.expected,
    outcome:'unscored',accepted:null,label:null,score:null,margin:null,exactReferenceOverlap:false,reason});};
   for(const [name,cases] of groups){
    await yieldControl();current();let image=null,problem=null;
    if(!selected.has(name))problem='Image file not selected; filenames must match exactly';
    else {try{image=await decode(selected.get(name));current();validImage(image);decodedImages++;}catch(e){current();problem='Image decode failed: '+e.message;}}
    if(problem){errors.push({image:name,reason:problem});for(const item of cases)unscored(item,problem);}
    else for(const item of cases){
     current();const readings=c.read(image,item.table);
     for(const f of item.fields){
      const region=c.regions.find(r=>r.table===item.table&&r.field===f.field),reading=readings.find(r=>r.field===f.field);
      if(!region||!reading||region.kind!==f.kind){const reason=!region?'Missing calibrated region':'Calibrated field kind differs from ground truth';
       errors.push({caseId:item.id,field:f.field,reason});unscored({...item,fields:[f]},reason);continue;}
      let overlap=false;
      if(Math.abs((image.width/image.height)/region.aspect-1)<=.03){const n=V.normalize(image,region.box);
       overlap=n.contrast>.05&&c.templates.some(t=>t.kind===region.kind&&t.pixels.every((p,i)=>p===n.pixels[i]));}
      const accepted=reading.accepted===true;
      rows.push({caseId:item.id,image:name,table:item.table,field:f.field,kind:f.kind,expected:f.expected,
       outcome:accepted?(f.expected!==null&&reading.label===f.expected?'correct-match':'wrong-match'):'rejected',accepted,
       label:accepted?reading.label:null,bestCandidate:reading.label,score:reading.score,margin:reading.margin,exactReferenceOverlap:overlap,reason:reading.reason});
     }
    }
    image=null;processedImages++;current();onProgress({processedImages,totalImages:groups.size,fieldsProcessed:rows.length});
   }
   current();const summary=summarize(rows);
   return {format:'eightmax-image-validation',version:1,dataset:{name:d.name,source:d.source,cases:d.cases.length,images:groups.size},
    calibration:{regions:c.regions.length,templates:c.templates.length,sampleWidth:V.W,sampleHeight:V.H},
    thresholds:{minScore:.92,minMargin:.04},processedImages,decodedImages,unusedFiles:Array.from(selected.keys()).filter(name=>!groups.has(name)),
    complete:summary.overall.unscored===0,summary,rows,errors,decisionReady:false,recognitionValidatedForLiveUse:false,
    scope:'Labeled supplied screenshots only. Scores are template similarities, not probabilities. Exact-reference overlap is a limited warning, not proof of independent evaluation or source authenticity.'};
  }finally{if(ticket===this.generation)this.busy=false;}
 }
}
return {manifest,files,Runner,Cancelled,summarize,MAX_MANIFEST_BYTES,MAX_CASES,MAX_FIELDS,MAX_FILES,MAX_FILE_BYTES,MAX_TOTAL_BYTES};
});
