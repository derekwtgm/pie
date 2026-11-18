/* Postflop betting reconstruction from an explicit street-start anchor. No client input. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkbenchRound=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';const ok=(x,m)=>{if(!x)throw Error(m);},copy=x=>JSON.parse(JSON.stringify(x));
class Round {
 constructor(s,dealer){
 ok(Number.isInteger(dealer)&&dealer>=0&&dealer<s.seats.length,'Dealer position required');this.dealer=dealer;this.seats=copy(s.seats);this.bigBlind=s.bigBlind;this.price=0;this.lastRaise=s.bigBlind;this.posts=null;let after=dealer;
 if(s.street==='preflop'){
  const p=s.roundStart,n=s.seats.length,sb=n===2?dealer:(dealer+1)%n,bb=(sb+1)%n;
  ok(p&&p.dealt===n&&p.smallBlind===sb&&p.bigBlindSeat===bb,'Explicit dealt seats and correctly positioned blinds are required');
  ok(s.bigBlind%10===0&&p.ante===s.bigBlind/10,'Preflop anchor requires an exact 0.1 BB individual ante');
  ok(s.deadMoney===0&&s.seats.every((q,i)=>!q.folded&&q.stack>0&&q.bet===(i===sb?s.bigBlind/2:i===bb?s.bigBlind:0)&&q.committed===q.bet+p.ante),'Preflop anchor must follow full blind/ante posts, before any action; short posts are unsupported');
  this.posts={dealt:n,smallBlind:sb,bigBlindSeat:bb,ante:p.ante};this.price=s.bigBlind;after=bb;
 }else ok(s.seats.every(p=>p.bet===0),'Verified reconstruction requires a postflop street-start anchor');
 this.acted=this.seats.map(()=>null);this.pending=this.seats.map((p,i)=>!p.folded&&p.stack>0?i:-1).filter(i=>i>=0);this.actions=[];this.closed=false;this.handClosed=false;this.settle(after);ok(!!s.roundClosed===this.closed,'Street-start closure flag disagrees with eligible players');ok(this.actor===s.actor,'Street-start actor does not follow dealer/action order');
 }
 next(after){for(let n=1;n<=this.seats.length;n++){const i=(after+n)%this.seats.length;if(this.pending.includes(i))return i;}return -1;}
 clone(){const r=Object.create(Round.prototype);Object.assign(r,copy(this));return r;}
 settle(after){this.pending=this.pending.filter(i=>!this.seats[i].folded&&this.seats[i].stack>0);const live=this.seats.filter(p=>!p.folded),able=live.filter(p=>p.stack>0);this.handClosed=live.length===1; if(this.handClosed||(able.length<=1&&able.every(p=>p.bet>=this.price)))this.pending=[];this.closed=this.pending.length===0;this.actor=this.closed?-1:this.next(after);}
 apply(type,to=0){ok(!this.closed,'Betting round already closed');const i=this.actor,p=this.seats[i],call=Math.min(p.stack,this.price-p.bet);ok(['check','fold','call','raise'].includes(type),'Unknown observed action');
 if(type==='check')ok(call===0,'Check faces an outstanding bet');if(type==='call')ok(call>0,'Nothing to call');
 if(type==='raise'){ok(Number.isSafeInteger(to)&&to>this.price&&to<=p.bet+p.stack,'Raise amount outside stack/price limits');ok(this.acted[i]===null||this.price-this.acted[i]>=this.lastRaise,'Raise rights have not reopened');ok(this.seats.some((q,j)=>j!==i&&!q.folded&&q.stack>Math.max(0,this.price-q.bet)),'No opponent can respond to a raise');ok(to>=this.price+this.lastRaise||to===p.bet+p.stack,'Raise is below minimum and not all-in');}
 this.pending=this.pending.filter(j=>j!==i);const old=this.price;let paid=0;if(type==='fold')p.folded=true;else if(type==='call'||type==='raise'){paid=type==='call'?call:to-p.bet;p.stack-=paid;p.committed+=paid;p.bet+=paid;}
 if(type==='raise'){this.price=to;if(to-old>=this.lastRaise){this.lastRaise=to-old;this.pending=this.seats.map((q,j)=>j!==i&&!q.folded&&q.stack>0?j:-1).filter(j=>j>=0);}else this.seats.forEach((q,j)=>{if(j!==i&&!q.folded&&q.stack>0&&q.bet<this.price&&!this.pending.includes(j))this.pending.push(j);});}
 this.acted[i]=this.price;const action={seat:i,type,to:p.bet,paid};this.actions.push(action);this.settle(i);return action;
 }
 transition(before,after){const next=this.clone();ok(before.seats.length===after.seats.length&&before.bigBlind===after.bigBlind&&before.deadMoney===after.deadMoney,'Round configuration changed');ok(JSON.stringify(before.hero)===JSON.stringify(after.hero)&&before.board.every((c,i)=>after.board[i]===c),'Known cards changed');if(after.roundStart)ok(after.roundStart.dealer===this.dealer,'Dealer changed during hand');
 if(after.roundStart&&this.posts)for(const key of Object.keys(this.posts))if(after.roundStart[key]!==undefined)ok(after.roundStart[key]===this.posts[key],'Blind/ante posting evidence changed');
 const streets=['preflop','flop','turn','river'],delta=streets.indexOf(after.street)-streets.indexOf(before.street);ok(delta===0||delta===1,'Street skipped or moved backwards');let action=null;
 if(!next.closed){const i=next.actor,a=before.seats[i],b=after.seats[i],paid=b.committed-a.committed;let type;if(b.folded&&!a.folded)type='fold';else if(paid===0)type='check';else type=a.bet+paid>next.price?'raise':'call';action=next.apply(type,a.bet+paid);}
 ok(next.seats.every((p,i)=>p.stack===after.seats[i].stack&&p.committed===after.seats[i].committed&&p.folded===after.seats[i].folded),'Observed chips/folds do not match one legal action');
 if(delta===1){ok(next.closed&&!next.handClosed,'Street advanced before betting completed, or hand already ended');ok(after.seats.every(p=>p.bet===0),'New street contains unexplained wagers');const fresh=new Round(after,next.dealer);fresh.posts=copy(next.posts);return {round:fresh,action:action?{...action,street:before.street}:null,streetChanged:true};}
 ok(next.seats.every((p,i)=>p.bet===after.seats[i].bet),'Observed street bets do not match the action');ok(next.actor===after.actor,'Turn order mismatch or missed actions');ok(!!after.roundClosed===next.closed,'Round-closed flag disagrees with pending actions');return {round:next,action:action?{...action,street:before.street}:null,streetChanged:false};
 }
}
function study(s,round,ranges){
 if(s.street==='preflop'){
  ok(round&&round.posts&&!round.closed&&round.actions.length===0,'Preflop study requires the initial verified posting anchor');ok(Array.isArray(ranges)&&ranges.length===s.seats.length,'Supply a range for every original seat');
  const order=Array.from({length:s.seats.length},(_,i)=>(round.posts.bigBlindSeat+1+i)%s.seats.length),stacks=order.map(i=>(s.seats[i].stack+s.seats[i].committed)/s.bigBlind);ok(stacks.every(v=>v>=2&&v<=250),'Preflop starting stacks must be 2 to 250 BB');
  return {config:{board:'',common:0,dealt:s.seats.length,stacks,ranges:order.map(i=>{ok(typeof ranges[i]==='string'&&ranges[i].trim(),'Explicit range missing for seat '+(i+1));return ranges[i].trim();}),preflop:{mode:'linked',opens:'2.2',raises:'3x,a',maxBets:2},streets:{flop:{bets:'50',raises:'a',maxBets:2},turn:{bets:'50',raises:'a',maxBets:2},river:{bets:'50',raises:'a',maxBets:2}},privateSeed:17},originalSeats:order,scope:'Reviewed preflop posting anchor; stacks restored before posts so EightMax posts blinds and individual antes exactly once.'};
 }
ok(round&&!round.closed&&round.actions.length===0&&s.street!=='preflop'&&s.seats.every(p=>p.bet===0),'Only verified postflop street-start states can prepare a study');ok(Array.isArray(ranges)&&ranges.length===s.seats.length,'Supply a range for every original seat');const order=[];for(let j=0;j<s.seats.length;j++){const i=(round.actor+j)%s.seats.length;if(!s.seats[i].folded)order.push(i);}ok(order.length>=2&&order.length<=6,'Study bridge supports 2 to 6 live seats');const stacks=order.map(i=>s.seats[i].stack/s.bigBlind);ok(stacks.every(v=>v>=2&&v<=250),'Study bridge currently requires every live stack to be 2 to 250 BB');
 const result={board:s.board.join(''),common:s.deadMoney/s.bigBlind,stacks,prior:order.map(i=>s.seats[i].committed/s.bigBlind),folded:s.seats.filter(p=>p.folded).map(p=>p.committed/s.bigBlind),ranges:order.map(i=>{ok(typeof ranges[i]==='string'&&ranges[i].trim(),'Explicit range missing for seat '+(i+1));return ranges[i].trim();}),streets:{flop:{bets:'50',raises:'a',maxBets:2},turn:{bets:'50',raises:'a',maxBets:2},river:{bets:'50',raises:'a',maxBets:2}},privateSeed:17};
 return {config:result,originalSeats:order,scope:'Reviewed street-start chip-EV study. No mid-street, ICM, payout or execution mapping.'};
}
return {Round,study};
});
