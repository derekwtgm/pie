/* Offline review continuation. Rebuild derived evidence by replaying source operations. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./observations.js'));
 else root.WorkbenchReviewSession=factory(root.WorkbenchObservations);
})(typeof globalThis!=='undefined'?globalThis:this,function(O){
'use strict';
const FORMAT='eightmax-observation-review',RULES='eightmax-review-0.8.0';
const MAX_BYTES=20000000,MAX_OPERATIONS=10000,MAX_INSPECTION_STEPS=256;
const copy=x=>JSON.parse(JSON.stringify(x));
const ok=(condition,message)=>{if(!condition)throw Error(message);};
function integer(value,min,max,name){ok(Number.isSafeInteger(value)&&value>=min&&value<=max,'Invalid '+name);}
function keys(value,expected,name){
 ok(value&&typeof value==='object'&&!Array.isArray(value),'Invalid '+name);
 ok(Object.keys(value).length===expected.length&&expected.every(key=>Object.prototype.hasOwnProperty.call(value,key)),
  'Unsupported '+name+' fields');
}
function boundedText(text,limit,name){
 ok(typeof text==='string'&&text.length<=limit,name+' exceeds its file limit');
 // Count UTF-8 bytes, including replacement characters for lone surrogates.
 let bytes=0;
 for(let i=0;i<text.length;i++){
  const c=text.charCodeAt(i);
  if(c<128)bytes++;else if(c<2048)bytes+=2;
  else if(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF){bytes+=4;i++;}
  else bytes+=3;
  ok(bytes<=limit,name+' exceeds its file limit');
 }
 return text;
}
function source(data){const text=typeof data==='string'?data:JSON.stringify(data);return O.sequence(boundedText(text,10000000,'Observation sequence'));}
function settings(value){
 if(value===undefined)return new O.Tracker().settings;
 keys(value,['stableFrames','stableMs','maxGapMs','maxHandGapMs'],'review settings');
 return new O.Tracker(value).settings;
}
class Session {
 constructor(sequence,options){
  this.sequence=source(sequence);this.settings=settings(options);
  this.tracker=new O.Tracker(this.settings);this.operations=[];this.cursor=0;this.revision=0;
 }
 next(){
  if(this.cursor>=this.sequence.frames.length)return null;
  ok(this.operations.length<MAX_OPERATIONS,'Review operation limit reached; export and start a separate review');
  const index=this.cursor,event=this.tracker.ingest(this.sequence.frames[index]);
  this.operations.push({kind:'frame',index});this.cursor++;this.revision++;return event;
 }
 batch(limit=250){
  integer(limit,1,250,'review batch size');let last=null;
  for(let i=0;i<limit&&this.cursor<this.sequence.frames.length;i++)last=this.next();
  return last;
 }
 reset(table){
  ok(this.operations.length<MAX_OPERATIONS,'Review operation limit reached; export and start a separate review');
  const event=this.tracker.reset(table);this.operations.push({kind:'reset',table});this.revision++;return event;
 }
 serialize(){
  return boundedText(JSON.stringify({format:FORMAT,version:1,rules:RULES,settings:this.settings,
   sequence:this.sequence,operations:this.operations,cursor:this.cursor,decisionReady:false}),MAX_BYTES,'Review file');
 }
 trajectory(table){
  integer(table,1,10,'review table');const current=this.tracker.tables.get(table);
  ok(current&&current.status==='stable'&&current.round&&!current.round.closed&&!current.finished,'Select a stable, open betting position');
  const replay=new O.Tracker(this.settings);let states=[],frames=[],count=0;
  for(const operation of this.operations){
   if(operation.kind==='reset'){replay.reset(operation.table);if(operation.table===table){states=[];frames=[];count=0;}continue;}
   const event=replay.ingest(this.sequence.frames[operation.index]);if(event.table!==table||!event.state)continue;
   if(['anchor','next-hand'].includes(event.transition.kind)){states=[];frames=[];count=0;}
   count++;if(count<=129){states.push(copy(event.state));frames.push(operation.index);}
  }
  ok(count<=128,'Reviewed study exceeds 128 accepted snapshots; choose a supported shorter anchored review');
  ok(replay.tables.get(table)&&replay.tables.get(table).status==='stable'&&replay.tables.get(table).hand===current.hand,'Replayed table does not have a matching stable hand');
  ok(states.length&&JSON.stringify(states.at(-1))===JSON.stringify(current.accepted),'Reviewed trajectory could not reproduce the current accepted state');
  return {format:'eightmax-reviewed-position',version:1,source:this.sequence.source,table,hand:current.hand,frames,states,decisionReady:false};
 }
 inspectedTrajectory(recordId,index){
  const view=this.inspect(recordId);integer(index,0,view.steps.length-1,'selected accepted step');
  ok(!view.truncated&&['anchor','next-hand'].includes(view.steps[0].transition.kind),'Selected hand has an omitted anchor/history and cannot prepare a full study path');
  const steps=view.steps.slice(0,index+1);ok(steps.length<=128,'Reviewed study exceeds 128 accepted snapshots');
  return {format:'eightmax-reviewed-position',version:1,source:this.sequence.source,table:view.record.table,hand:view.record.hand,
   frames:steps.map(s=>s.sourceIndex),states:steps.map(s=>copy(s.state)),decisionReady:false};
 }
 inspect(recordId){
  integer(recordId,1,Number.MAX_SAFE_INTEGER,'completed record identity');
  const record=this.tracker.completed.find(h=>h.recordId===recordId);
  ok(record,'Completed record is no longer retained');
  const replay=new O.Tracker(this.settings);let steps=[],totalSteps=0;
  for(let i=0;i<this.operations.length;i++){
   const operation=this.operations[i];
   if(operation.kind==='reset'){
    replay.reset(operation.table);if(operation.table===record.table){steps=[];totalSteps=0;}continue;
   }
   const frame=this.sequence.frames[operation.index],event=replay.ingest(frame);
   if(event.table===record.table&&event.state){
    if(['anchor','next-hand'].includes(event.transition.kind)){steps=[];totalSteps=0;}
    totalSteps++;steps.push({sourceIndex:operation.index,operationIndex:i,sequence:frame.sequence,
     timeMs:frame.timeMs,transition:copy(event.transition),state:copy(event.state)});
    if(steps.length>MAX_INSPECTION_STEPS)steps.shift();
    if(event.transition.kind==='settlement'&&replay.completedSerial===recordId){
     return {format:'eightmax-completed-hand-review',version:1,source:this.sequence.source,
      rules:RULES,record:copy(replay.completed.at(-1)),steps,totalSteps,truncated:totalSteps>steps.length,
      decisionReady:false,scope:'Replayed supplied observations; not an authenticated client history. Integer chips and fixed payout policy.'};
    }
   }
  }
  throw Error('Completed record could not be rebuilt from the retained source');
 }
}
function load(text){
 const data=JSON.parse(boundedText(text,MAX_BYTES,'Review file'));
 keys(data,['format','version','rules','settings','sequence','operations','cursor','decisionReady'],'review file');
 ok(data.format===FORMAT&&data.version===1,'Unsupported observation review file');
 ok(data.rules===RULES,'Review uses a different audit rules version');
 ok(data.decisionReady===false,'Review cannot certify executable decisions');
 const session=new Session(data.sequence,data.settings);
 integer(data.cursor,0,session.sequence.frames.length,'review cursor');
 ok(Array.isArray(data.operations)&&data.operations.length<=MAX_OPERATIONS,'Review operation limit exceeded');
 let cursor=0;
 for(const operation of data.operations){
  ok(operation&&['frame','reset'].includes(operation.kind),'Unsupported review operation');
  if(operation.kind==='frame'){
   keys(operation,['kind','index'],'frame operation');
   integer(operation.index,0,session.sequence.frames.length-1,'source frame index');
   ok(operation.index===cursor,'Review frames must be consumed once in source order');cursor++;
  }else{keys(operation,['kind','table'],'reset operation');integer(operation.table,1,10,'reset table');}
 }
 ok(cursor===data.cursor,'Review cursor disagrees with the operation history');
 for(const operation of data.operations){if(operation.kind==='frame')session.next();else session.reset(operation.table);}
 return session;
}
return {Session,load,FORMAT,RULES,MAX_BYTES,MAX_OPERATIONS,MAX_INSPECTION_STEPS};
});
