/* Guided settings preserve advanced study fields; no solver is reimplemented here. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkbenchForms=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';const ok=(v,m)=>{if(!v)throw Error(m);};
function number(v,min,max,name,integer=false){ok((typeof v==='number'||typeof v==='string')&&String(v).trim()!=='','Enter '+name);const n=Number(v);ok(Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isInteger(n)),'Invalid '+name+' ('+min+' to '+max+')');return n;}
function stage(c){return c.preflop?(c.preflop.mode==='shove'?'pushfold':'linked'):({3:'flop',4:'turn',5:'river'}[String(c.board).replace(/[\s,]/g,'').length/2]||'river');}
function read(c){const s=stage(c),street=['linked','pushfold'].includes(s)?'flop':s,row=c.streets&&c.streets[street]||{};return {stage:s,board:c.board||'',common:c.common,seats:c.stacks.map((stack,i)=>({stack,range:c.ranges[i]})),bets:row.bets===undefined?'50':row.bets,raises:row.raises===undefined?'a':row.raises,maxBets:row.maxBets===undefined?2:row.maxBets,opens:c.preflop&&c.preflop.opens||'2.2',preRaises:c.preflop&&c.preflop.raises||'a',preCap:c.preflop&&c.preflop.maxBets||2};}
function apply(base,model){
 const c=JSON.parse(JSON.stringify(base)),s=model.stage,pre=['linked','pushfold'].includes(s);ok(pre||['flop','turn','river'].includes(s),'Choose a study street');
 ok(Array.isArray(model.seats)&&model.seats.length>=2&&model.seats.length<=(pre?8:6),'Use 2 to '+(pre?8:6)+' seats');
 const advanced=(c.prior&&c.prior.some(x=>x!==0))||(c.folded&&c.folded.length)||c.icm;
 ok(!advanced||(model.seats.length===c.stacks.length&&s===stage(c)),'This study has previous wagers or ICM. Keep its seat count/street, or load a fresh example.');
 const board=String(model.board||'').replace(/[\s,]/g,'').replace(/./g,(x,i)=>i%2===0?x.toUpperCase():x.toLowerCase());
 if(!pre){ok(board.length===({flop:6,turn:8,river:10}[s])&&/^(?:[2-9TJQKA][cdhs])+$/.test(board),'Board cards must match the selected street (for example Ks 8d 5h)');ok(new Set(board.match(/../g)).size===board.length/2,'Board contains duplicate cards');}
 c.board=pre?'':board;c.common=pre?0:number(model.common,0,100000,'common pot');
 c.stacks=model.seats.map((p,i)=>number(p.stack,2,250,'seat '+(i+1)+' stack'));
 c.ranges=model.seats.map((p,i)=>{ok(typeof p.range==='string'&&p.range.trim().length>0&&p.range.length<=2000,'Enter a range for seat '+(i+1));return p.range.trim();});
 if(!advanced){delete c.prior;delete c.folded;}
 if(c.dealt!==undefined)c.dealt=Math.max(c.dealt,c.stacks.length);if(pre){c.dealt=c.stacks.length;c.preflop={...(c.preflop||{}),mode:s==='pushfold'?'shove':'linked',opens:String(model.opens||'2.2'),raises:String(model.preRaises||''),maxBets:number(model.preCap,1,5,'preflop raise cap',true)};}else delete c.preflop;
 c.streets=c.streets||{};const street=pre?'flop':s;for(const k of ['flop','turn','river'].slice(['flop','turn','river'].indexOf(street))){if(!c.streets[k])c.streets[k]={bets:'50',raises:'a',maxBets:2};}
 c.streets[street]={bets:String(model.bets||''),raises:String(model.raises||''),maxBets:number(model.maxBets,1,5,'street bet cap',true)};
 return c;
}
return {read,apply,stage};
});
