/* Native job exchange. Browser controls never start an OS process. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./study-adapter.js'),require('./reviewed-study.js'),require('./convergence.js'));else root.WorkbenchNative=factory(root.WorkbenchStudy,root.WorkbenchReviewed,root.WorkbenchConvergence);})(typeof globalThis!=='undefined'?globalThis:this,function(A,Q,C){
'use strict';const ok=(v,m)=>{if(!v)throw Error(m);},copy=x=>JSON.parse(JSON.stringify(x)),MAX_RESULT_BYTES=6000000;
function integer(v,min,max,name){ok(Number.isSafeInteger(v)&&v>=min&&v<=max,'Invalid native '+name);return v;}
function near(a,b){return typeof a==='number'&&Number.isFinite(a)&&Math.abs(a-b)<=Math.max(6e-11,128*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b)));}
function equal(a,b){return A.canonical(a)===A.canonical(b);}
// 0.18: limits raised to what the unmodified engine accepts (10M updates; memory checked against the PC's RAM by the runner).
const LIMITS=Object.freeze({updates:A.MAX_ITERATIONS,threads:[1,4],memoryMiB:[32,16384],timeoutSeconds:[1,604800],chunkUpdates:[1,1000000]});
function options(o){ok(o&&typeof o==='object','Missing native controls');return {threads:integer(o.threads,...LIMITS.threads,'thread count (1 to 4)'),memoryMiB:integer(o.memoryMiB,...LIMITS.memoryMiB,'strategy memory (32 to 16,384 MiB)'),timeoutSeconds:integer(o.timeoutSeconds,...LIMITS.timeoutSeconds,'training time limit (1 second to 7 days)'),chunkUpdates:integer(o.chunkUpdates,...LIMITS.chunkUpdates,'checkpoint interval (1 to 1,000,000 updates)'),convergence:C.settings(o.convergence)};}
function nativeQuery(node,rootBoard){return {path:node.steps.filter(s=>typeof s==='number'),board:node.board.slice(rootBoard.length),offset:0,limit:1326};}
function menu(actions){ok(Array.isArray(actions)&&actions.length>=1&&actions.length<=7,'Invalid native action menu');actions.forEach((a,i)=>ok(a.slot===i&&typeof a.label==='string'&&a.label.length<=100,'Invalid native action label'));}
function compatible(range,board){return range.filter(h=>!board.includes(h[1])&&!board.includes(h[2]));}
function job(value){
 const j=copy(value);ok(j&&j.format==='eightmax-workbench-native-job'&&[1,2].includes(j.version)&&j.engine&&j.engine.build===A.ENGINE.build,'Unsupported native job');
 ok(typeof j.id==='string'&&j.id.length>=1&&j.id.length<=100,'Invalid native job identity');A.input({config:j.config,iterations:j.iterations});
 options({...j,chunkUpdates:j.chunkUpdates===undefined?1000:j.chunkUpdates});
 ok(j.spec&&j.spec.protocol===4&&j.spec.algorithm==='external'&&j.spec.device==='cpu','Native job must use CPU protocol-4 external sampling');
 ok(j.query&&Array.isArray(j.query.path)&&Array.isArray(j.query.board)&&j.query.offset===0&&j.query.limit===1326&&Object.keys(j.query).length===4,'Native query must request the complete acting range');
 if(j.version===1){ok(!j.query.path.length&&!j.query.board.length&&j.reviewed===undefined&&j.rootActions===undefined,'Version-1 native jobs accept root queries only');}
 else{
  const n=Q.validateNode(j.reviewed,j.config);menu(j.rootActions);
  const model=Q.validate(n.proof),rootBoard=model.root.board.map(c=>'23456789TJQKA'.indexOf(c[0])*4+'cdhs'.indexOf(c[1]));
  ok(equal(j.spec.board,rootBoard)&&j.spec.n===n.originalSeats.length&&Array.isArray(j.spec.hands)&&j.spec.hands.length===n.originalSeats.length,'Invalid reviewed native spec ranges/board');
  for(const hands of j.spec.hands){ok(Array.isArray(hands)&&hands.length>=1&&hands.length<=1326,'Invalid native range length');const seen=new Set();
   for(const h of hands){ok(Array.isArray(h)&&h.length===4&&h.slice(1,3).every(c=>Number.isInteger(c)&&c>=0&&c<52)&&h[1]<h[2]&&h[0]===h[1]*(103-h[1])/2+h[2]-h[1]-1&&!seen.has(h[0])&&!rootBoard.includes(h[1])&&!rootBoard.includes(h[2])&&typeof h[3]==='number'&&h[3]>0&&h[3]<=1,'Invalid native spec hand');seen.add(h[0]);}
  }
  const range=j.spec.hands[n.actor];
  const rows=compatible(range,n.board);ok(rows.length===n.hands.length&&rows.every((h,i)=>equal(h.slice(1,3),n.hands[i].cards)&&near(n.hands[i].weight,h[3])),'Reviewed native input range differs from its target');
  ok(n.hands.every(h=>!h.stored&&h.average===null),'Native export target must contain no trained policies');
  ok(equal(j.query,nativeQuery(n,j.spec.board)),'Native query differs from the captured reviewed path');
 }
 if(j.workbench){integer(j.workbench.slot,1,10,'study slot');ok(typeof j.workbench.token==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(j.workbench.token),'Invalid native request binding');}
 ok(JSON.stringify(j).length<=1000000,'Native job exceeds 1 MB');return j;
}
function reviewedJob(EM,prepared,mapped,id){
 ok(prepared.game.iterations===0,'Native export must map a fresh untrained study');
 const reviewed=Q.query(EM,prepared,mapped),rootActions=prepared.game.view([]).actions.map((a,slot)=>({slot,label:a.label}));
 return job({...A.nativeJob(prepared,String(id)),version:2,reviewed,rootActions,query:nativeQuery(reviewed,prepared.spec.board)});
}
function bind(value,slot,token,o){ok(typeof value.id==='string'||Number.isSafeInteger(value.id)&&value.id>0,'Invalid worker job identity');return job({...value,id:String(value.id),...options(o),workbench:{slot,token}});}
function same(expected,received,slot){const actual=job(received);ok(actual.workbench&&actual.workbench.slot===slot,'Native result belongs to a different or unbound study slot');ok(equal(job(expected),actual),'Native result does not match the latest exported job; re-export for these inputs');return true;}
function label(action,put){
 ok(typeof action.to==='number'&&Number.isFinite(action.to)&&action.to>=0,'Invalid native action amount');const format=x=>String(+x.toFixed(3));
 if(action.name==='Fold'||action.name==='Check')return action.name;
 if(action.name==='Call')return 'Call '+format(action.to-put);
 ok(['Bet to','Raise to','All-in'].includes(action.name),'Unknown native action kind');return ({'Bet to':'Bet ','Raise to':'Raise to ','All-in':'All-in to '})[action.name]+format(action.to);
}
function checkNode(q,node,model,root=false){
 const state=root?model.root:model.target,actor=root?0:node.actor,board=root?model.root.board.map(c=>'23456789TJQKA'.indexOf(c[0])*4+'cdhs'.indexOf(c[1])):node.board,bb=model.root.bigBlind,order=model.originalSeats;
 ok(q&&q.node&&q.node.kind==='decision'&&q.node.actor===actor&&equal(q.node.board,board)&&near(q.node.pot,state.pot/bb),'Native query reached a different reviewed decision');
 for(const [key,expected] of [['behind',order.map(i=>state.seats[i].stack/bb)],['streetPut',order.map(i=>state.seats[i].bet/bb)]])ok(Array.isArray(q.node[key])&&q.node[key].length===order.length&&q.node[key].every((v,i)=>near(v,expected[i])),'Native '+key+' differs from reviewed evidence');
 ok(equal(q.node.live,order.map(i=>!state.seats[i].folded)),'Native fold status differs from reviewed evidence');
 const actions=root?node.rootActions:node.actions;ok(Array.isArray(q.actions)&&q.actions.length===actions.length&&q.actions.every((a,i)=>a.slot===i&&label(a,q.node.streetPut[actor])===actions[i].label),'Native action menu differs from the captured study');
 const expected=[];if(!root)for(let i=0;i<model.transitions.length;i++){const t=model.transitions[i];if(t.action)expected.push({slot:node.steps[expected.length],seat:order.indexOf(t.action.seat),to:t.action.to/bb,street:t.action.street,type:t.action.type});if(t.streetChanged)expected.push({cards:model.proof.states[i+1].board.slice(model.proof.states[i].board.length).map(c=>'23456789TJQKA'.indexOf(c[0])*4+'cdhs'.indexOf(c[1]))});}
 ok(Array.isArray(q.history)&&q.history.length===expected.length&&q.history.every((h,i)=>{const e=expected[i];if(e.cards)return h.chance===true&&equal(h.cards,e.cards);return !h.chance&&h.slot===e.slot&&h.seat===e.seat&&h.street===e.street&&near(h.to,e.to)&&(['fold','check','call'].includes(e.type)?h.action===e.type[0].toUpperCase()+e.type.slice(1):['Bet to','Raise to','All-in'].includes(h.action));}),'Native history differs from the captured action/card path');
}
function rows(q,range,board,width){
 ok(q.hands&&q.hands.actingSeat===true&&q.hands.seat===q.node.actor&&q.hands.offset===0&&q.hands.total===range.length&&Array.isArray(q.hands.items)&&q.hands.items.length===range.length,'Native query did not return the complete acting range');const result=[];
 q.hands.items.forEach((h,i)=>{const expected=range[i],blocked=board.includes(expected[1])||board.includes(expected[2]);ok(h.i===i&&equal(h.cards,expected.slice(1,3))&&near(h.weight,expected[3])&&h.blocked===blocked,'Native hand identity, weight or blocker differs from the exported range');
  if(blocked){ok(h.row!==true&&(h.average===undefined||h.average===null),'Blocked native hand cannot contain a policy');return;}
  ok(typeof h.row==='boolean'&&(h.average===null||Array.isArray(h.average)),'Invalid native policy row');const stored=h.row&&h.average!==null;
  if(h.average!==null)ok(h.row&&h.average.length===width&&h.average.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)&&Math.abs(h.average.reduce((a,b)=>a+b,0)-1)<1e-6,'Invalid native policy probabilities');
  result.push({cards:h.cards.slice(),weight:expected[3],average:stored?h.average.slice():null,stored});
 });return result;
}
function result(value){
 if(value&&value.version===1){
  const original=value.job,legacy=original&&Number.isSafeInteger(original.id)&&original.id>0?{...original,id:String(original.id)}:original,j=job(legacy);
  ok(j.version===1&&value.query&&value.query.node&&equal(value.query.node.board,j.spec.board)&&Array.isArray(value.query.history)&&!value.query.history.length,'Version-1 native result must query the study root');const r1=A.validateResult(value);return withConvergence(r1,value,j);
 }
 ok(value&&value.format==='eightmax-workbench-native-result'&&value.version===2&&value.build===A.ENGINE.build,'Unsupported native result');
 ok(new TextEncoder().encode(JSON.stringify(value)).length<=MAX_RESULT_BYTES,'Native result exceeds 6 MB');
 const j=job(value.job);ok(j.version===2,'Reviewed result requires a version-2 native job');const n=copy(j.reviewed),model=Q.validate(n.proof),t=value.training;
 ok(t&&t.requestedTotalUpdates===j.iterations,'Native cumulative target differs from its job');integer(t.iterations,0,j.iterations,'completed updates');integer(t.trainingDeals,0,Number.MAX_SAFE_INTEGER,'sampled deals');ok(typeof t.limitReached==='boolean','Invalid native memory-limit flag');
 ok(typeof value.elapsedMs==='number'&&Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0,'Invalid native elapsed time');
 for(const q of [value.rootQuery,value.query])ok(q&&q.study&&q.study.updates===t.iterations&&q.study.sampledDeals===t.trainingDeals,'Native root/target queries do not share the completed training counters');
 checkNode(value.rootQuery,{...n,rootActions:j.rootActions},model,true);checkNode(value.query,n,model);
 const rootRows=rows(value.rootQuery,j.spec.hands[0],value.rootQuery.node.board,value.rootQuery.actions.length);
 n.hands=rows(value.query,j.spec.hands[n.actor],n.board,n.actions.length);Q.validateNode(n,j.config);
 const r=A.normalizeNative(j,value.rootQuery,t,value.elapsedMs);r.actions=copy(j.rootActions);r.hands=rootRows;r.reviewedNode=n;r.quality.description='Native root context and captured reviewed-node stored averages from one completed checkpoint; no EV bound.';
 return withConvergence(A.validateResult(r),value,j);
}
// Older results have no convergence block; results from a 0.18 runner always do unless the job disabled it.
function withConvergence(r,value,j){if(value.convergence===undefined||value.convergence===null)return r;r.convergence=C.summarize(value.convergence,j,value.training||{iterations:r.updates});return A.validateResult(r);}
function status(value){
 const s=copy(value);ok(s&&s.format==='eightmax-native-job-status'&&s.version===1&&s.build===A.ENGINE.build,'Unsupported native status');
 ok(['starting','restoring','training','querying','complete','cancelled','failed'].includes(s.stage),'Invalid native status stage');
 ok(typeof s.id==='string'&&s.id.length<=100,'Invalid native status identity');integer(s.committedUpdates,0,LIMITS.updates,'committed updates');integer(s.targetUpdates,1,LIMITS.updates,'target updates');
 ok(s.committedUpdates<=s.targetUpdates&&typeof s.elapsedMs==='number'&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>=0,'Invalid native status counters');
 for(const k of ['message','checkpoint'])ok(typeof s[k]==='string'&&s[k].length<=2000,'Invalid native status '+k);
 if(s.workbench){integer(s.workbench.slot,1,10,'status slot');ok(typeof s.workbench.token==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(s.workbench.token),'Invalid native status binding');}
 return s;
}
return {MAX_RESULT_BYTES,LIMITS,options,job,reviewedJob,bind,same,result,status};
});
