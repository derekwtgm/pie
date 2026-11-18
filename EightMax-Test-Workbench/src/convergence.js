/* Convergence (response-gain) measurements for native studies.
   The numbers come from the unmodified EightMax 5.1 engine (`mwcli --gain`). This module only
   validates what the native runner saved and turns it into a per-seat summary and a plain verdict.
   Exact best response is an upper bound on what any seat can win by deviating inside the study's
   card and betting abstraction. Restricted and sampled methods are LOWER bounds: they can show a
   study is not converged, never that it is. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkbenchConvergence=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const ok=(v,m)=>{if(!v)throw Error(m);},copy=x=>JSON.parse(JSON.stringify(x));
const METHODS=['auto','exact','restricted','sampled','off'],ENGINE_METHODS=['exact','restricted','sampled'];
const MODES={exactBestResponse:'exact',restrictedBestResponse:'restricted',sampledOneDecisionDeviation:'sampled'};
const DEFAULTS=Object.freeze({method:'auto',everyChunks:0,timeLimitSeconds:30,targetPctPot:1});
const LIMITS=Object.freeze({everyChunks:[0,1000],timeLimitSeconds:[5,3600],targetPctPot:[0.001,100],measurements:51,errorText:600});
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function integer(v,min,max,name){ok(Number.isSafeInteger(v)&&v>=min&&v<=max,'Invalid convergence '+name);return v;}
// Settings travel inside the native job. Missing settings mean the defaults (older jobs).
function settings(value){
 const s=value===undefined||value===null?{...DEFAULTS}:copy(value);
 ok(s&&typeof s==='object'&&!Array.isArray(s),'Invalid convergence settings');
 ok(Object.keys(s).every(k=>k in DEFAULTS),'Unknown convergence setting');
 for(const k of Object.keys(DEFAULTS))if(s[k]===undefined)s[k]=DEFAULTS[k];
 ok(METHODS.includes(s.method),'Convergence method must be auto, exact, restricted, sampled or off');
 integer(s.everyChunks,...LIMITS.everyChunks,'checkpoint interval (0 to 1,000 checkpoints)');
 integer(s.timeLimitSeconds,...LIMITS.timeLimitSeconds,'time limit (5 to 3,600 seconds)');
 ok(finite(s.targetPctPot)&&s.targetPctPot>=LIMITS.targetPctPot[0]&&s.targetPctPot<=LIMITS.targetPctPot[1],'Convergence target must be 0.001% to 100% of the starting pot');
 return s;
}
// Methods the runner tries, in order. Auto falls back when exact is refused (tree too big) or times out.
function plan(s){s=settings(s);return s.method==='off'?[]:s.method==='auto'?ENGINE_METHODS.slice():[s.method];}
function request(method,s,threads){ok(ENGINE_METHODS.includes(method),'Unknown engine method');s=settings(s);return {method,timeLimitMs:s.timeLimitSeconds*1000,threads:integer(threads,1,64,'threads')};}
function seatGain(seat){
 // Exact: gain is a number with stdErr 0. Restricted/sampled: gain{mean,stdErr,ci95}.
 if(seat.available===false)return null;
 if(finite(seat.gain))return {mean:seat.gain,stdErr:finite(seat.stdErr)?seat.stdErr:0,ci95:null};
 const g=seat.gain;if(!g||typeof g!=='object'||!finite(g.mean))return null;
 const se=finite(g.stdErr)&&g.stdErr>=0?g.stdErr:null,ci=Array.isArray(g.ci95)&&g.ci95.length===2&&g.ci95.every(finite)?g.ci95.slice():null;
 return {mean:g.mean,stdErr:se,ci95:ci};
}
function measurement(m,ctx){
 ok(m&&typeof m==='object'&&!Array.isArray(m),'Invalid convergence measurement');
 integer(m.updates,0,ctx.maxUpdates,'measurement updates');
 ok(finite(m.elapsedMs)&&m.elapsedMs>=0,'Invalid convergence measurement time');
 ok(Array.isArray(m.attempts)&&m.attempts.length<=3,'Invalid convergence attempts');
 const attempts=m.attempts.map(a=>{ok(a&&ENGINE_METHODS.includes(a.method)&&typeof a.error==='string','Invalid convergence attempt');return {method:a.method,error:a.error.slice(0,LIMITS.errorText)};});
 const out={updates:m.updates,elapsedMs:m.elapsedMs,attempts,available:false,method:null,bound:null,seats:[],maxGain:null,maxPctPot:null,maxUpperPctPot:null,nashConv:null,exploitability:null,unit:null};
 if(m.response===null||m.response===undefined){ok(attempts.length>0,'A missing convergence measurement must say why');return out;}
 const r=m.response;ok(r&&typeof r==='object'&&MODES[r.mode],'Unknown response-gain mode');
 ok(r.players===ctx.players,'Response gain was measured for a different seat count');
 ok(r.updates===m.updates,'Response gain was measured on a different checkpoint');
 ok(Array.isArray(r.seats)&&r.seats.length>=1&&r.seats.length<=ctx.players,'Invalid response-gain seats');
 const unit=r.utility&&typeof r.utility.unit==='string'?r.utility.unit.slice(0,20):'BB',chip=!r.utility||r.utility.model!=='icm',seen=new Set();
 out.available=true;out.method=MODES[r.mode];out.bound=out.method==='exact'?'exact':'lower-bound';out.unit=unit;
 for(const seat of r.seats){
  integer(seat.seat,0,ctx.players-1,'seat');ok(!seen.has(seat.seat),'Duplicate response-gain seat');seen.add(seat.seat);
  const g=seatGain(seat);if(!g){out.seats.push({seat:seat.seat,available:false,gain:null,stdErr:null,pctPot:null,upperPctPot:null});continue;}
  const upper=g.ci95?g.ci95[1]:g.mean+(g.stdErr||0)*1.96,lower=g.ci95?g.ci95[0]:g.mean-(g.stdErr||0)*1.96;
  const pct=x=>chip&&ctx.pot>0?100*x/ctx.pot:null;
  out.seats.push({seat:seat.seat,available:true,gain:g.mean,stdErr:g.stdErr,pctPot:pct(g.mean),upperPctPot:pct(upper),lowerPctPot:pct(lower)});
 }
 out.seats.sort((a,b)=>a.seat-b.seat);
 const live=out.seats.filter(s=>s.available);
 if(live.length){
  const worst=live.reduce((a,b)=>b.gain>a.gain?b:a);out.maxGain=worst.gain;out.maxPctPot=worst.pctPot;
  out.maxUpperPctPot=live.every(s=>s.upperPctPot!==null)?Math.max(...live.map(s=>s.upperPctPot)):null;
  out.maxLowerPctPot=live.every(s=>s.lowerPctPot!==null)?Math.max(...live.map(s=>s.lowerPctPot)):null;
 }else out.available=false;
 if(out.method==='exact'){if(finite(r.nashConv))out.nashConv=r.nashConv;if(finite(r.exploitability))out.exploitability=r.exploitability;}
 out.seatsMissing=ctx.players-live.length;
 return out;
}
function verdict(final,s){
 const target=s.targetPctPot,fmt=x=>(+x.toPrecision(3)).toString();
 if(!final)return {code:'not-measured',text:'Convergence was not measured for this study.'};
 if(!final.available){const why=final.attempts.length?final.attempts.map(a=>a.method+': '+a.error).join(' · '):'no method succeeded';return {code:'unavailable',text:'Convergence could not be measured ('+why+'). Try a longer convergence time limit or a smaller tree.'};}
 if(final.maxPctPot===null)return {code:'measured',text:'Largest seat gain '+fmt(final.maxGain)+' '+final.unit+' (ICM units; the % of pot target is not applied).'};
 const partial=final.seatsMissing?' '+final.seatsMissing+' seat(s) could not be evaluated.':'';
 if(final.bound==='exact'){
  if(final.maxPctPot<=target)return {code:'within-target',text:'Within target: no seat can gain more than '+fmt(final.maxPctPot)+'% of the starting pot by changing its strategy (target '+fmt(target)+'%). Exact best response inside this study\'s cards and bet sizes.'+partial};
  return {code:'above-target',text:'Keep training: one seat can still gain '+fmt(final.maxPctPot)+'% of the starting pot (target '+fmt(target)+'%). Exact best response.'+partial};
 }
 const sure=final.maxLowerPctPot!==null&&final.maxLowerPctPot!==undefined&&final.maxLowerPctPot>target;
 if(sure)return {code:'above-target',text:'Keep training: a '+final.method+' check found a seat gaining at least '+fmt(final.maxLowerPctPot)+'% of the starting pot (target '+fmt(target)+'%).'+partial};
 return {code:'not-proven',text:'Not proven: the '+final.method+' check (a lower bound) found up to '+fmt(final.maxPctPot)+'% of the pot, below or near the '+fmt(target)+'% target, but the true gain can be larger. Only an exact check can confirm convergence.'+partial};
}
function trend(curve){
 const pts=curve.filter(p=>p.available&&p.maxPctPot!==null);if(pts.length<2)return null;
 const a=pts[pts.length-2],b=pts[pts.length-1];if(a.method!==b.method)return {text:'Method changed between the last two checks; compare like with like.'};
 if(a.maxPctPot<=0)return {ratio:null,text:'Already at zero measured gain.'};
 const ratio=b.maxPctPot/a.maxPctPot;
 return {ratio,text:ratio<0.95?'Still improving: largest gain fell '+Math.round((1-ratio)*100)+'% between '+a.updates.toLocaleString('en-US')+' and '+b.updates.toLocaleString('en-US')+' updates.':ratio<=1.05?'Flat between the last two checks; more updates of this kind may not help much.':'Rose between the last two checks (sampling noise or a still-moving average strategy).'};
}
// Validate the runner's saved block against its job and training counters; return a compact summary.
function summarize(block,job,training){
 ok(block&&block.format==='eightmax-native-convergence'&&block.version===1,'Unsupported convergence block');
 const s=settings(job.convergence);const saved=settings(block.settings);ok(Object.keys(DEFAULTS).every(k=>saved[k]===s[k]),'Convergence settings differ from the job');
 const pot=job.spec&&job.spec.rules&&job.spec.rules.pot0;ok(finite(pot)&&pot>0,'Native spec has no starting pot');
 ok(Array.isArray(block.measurements)&&block.measurements.length<=LIMITS.measurements,'Too many convergence measurements');
 const ctx={players:job.spec.n,pot,maxUpdates:job.iterations},curve=block.measurements.map(m=>measurement(m,ctx));
 for(let i=1;i<curve.length;i++)ok(curve[i].updates>=curve[i-1].updates,'Convergence measurements are out of order');
 if(s.method==='off')ok(curve.length===0,'Convergence was disabled but measured');
 const final=curve.length?curve[curve.length-1]:null;
 if(final&&training)ok(final.updates===training.iterations,'The final convergence check is not from the final checkpoint');
 if(s.method!=='off'&&training)ok(final,'The final convergence check is missing');
 return {format:'eightmax-convergence-summary',version:1,settings:s,startingPot:pot,players:ctx.players,final,curve:curve.map(p=>({updates:p.updates,available:p.available,method:p.method,bound:p.bound,maxGain:p.maxGain,maxPctPot:p.maxPctPot})),verdict:verdict(final,s),trend:trend(curve)};
}
// Re-validate a stored summary (workspace restore / cache) without the raw engine output.
function validateSummary(v){
 ok(v&&v.format==='eightmax-convergence-summary'&&v.version===1,'Unsupported convergence summary');settings(v.settings);
 ok(finite(v.startingPot)&&v.startingPot>0&&Number.isInteger(v.players)&&v.players>=2&&v.players<=8,'Invalid convergence context');
 ok(Array.isArray(v.curve)&&v.curve.length<=LIMITS.measurements,'Invalid convergence curve');
 for(const p of v.curve){ok(Number.isSafeInteger(p.updates)&&p.updates>=0&&typeof p.available==='boolean','Invalid convergence point');if(p.available)ok(MODES[Object.keys(MODES).find(k=>MODES[k]===p.method)]&&finite(p.maxGain)&&(p.maxPctPot===null||finite(p.maxPctPot)),'Invalid convergence point values');}
 ok(v.verdict&&['not-measured','unavailable','measured','within-target','above-target','not-proven'].includes(v.verdict.code)&&typeof v.verdict.text==='string','Invalid convergence verdict');
 return v;
}
return {DEFAULTS,LIMITS,METHODS,settings,plan,request,measurement,summarize,validateSummary,verdict};
});
