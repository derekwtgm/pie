(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./round-audit.js'),require('./settlement.js'));else root.WorkbenchCompletedDemo=factory(root.WorkbenchRound,root.WorkbenchSettlement);})(typeof globalThis!=='undefined'?globalThis:this,function(R,S){
'use strict';const copy=x=>JSON.parse(JSON.stringify(x));
function build(){const frames=[];return {frames,push(state,hand){for(let j=0;j<2;j++){const i=frames.length;frames.push({table:1,hand,frame:'accounting-'+i,sequence:i,timeMs:i*200,quality:{accepted:true,minScore:.99,minMargin:.1},state:copy(state)});}},result(){return {format:'eightmax-observation-sequence',version:1,source:'synthetic',frames};}};}
function observed(base,round){return {...copy(base),actor:round.actor,...(round.closed?{roundClosed:true}:{}),seats:copy(round.seats),pot:base.deadMoney+round.seats.reduce((a,p)=>a+p.committed,0)};}
function paid(before,round){const result=S.plan(before,round.dealer),after=copy(before);after.phase='settled';after.awards=result.awards;after.refunds=result.refunds;after.pot=0;after.deadMoney=0;after.seats.forEach((p,i)=>{p.stack+=result.awards[i]+result.refunds[i];p.committed=0;p.bet=0;});return after;}
function session(hands=1){if(!Number.isInteger(hands)||hands<1||hands>200)throw Error('Demo hand count outside 1–200');const log=build();let balances=[2500,2500];
 function anchor(dealer){const sb=dealer,bb=1-dealer;return {street:'preflop',board:[],hero:dealer?['Kh','Kd']:['As','Ad'],heroSeat:0,actor:sb,bigBlind:100,deadMoney:0,pot:170,roundStart:{dealer,smallBlind:sb,bigBlindSeat:bb,ante:10,dealt:2},seats:balances.map((stack,i)=>{const bet=i===sb?50:100;return {stack:stack-bet-10,committed:bet+10,bet,folded:false};})};}
 for(let h=0;h<hands;h++){const id='completed-'+(h+1),base=anchor(h%2);log.push(base,id);const round=new R.Round(base,h%2);round.apply('fold');const closed=observed(base,round);log.push(closed,id);const refund=copy(closed);refund.phase='refund';refund.refunds=S.refundsFor(closed);refund.pot-=refund.refunds.reduce((a,b)=>a+b,0);refund.seats.forEach((p,i)=>{p.stack+=refund.refunds[i];p.committed-=refund.refunds[i];p.bet-=refund.refunds[i];});const adjusted=S.refund(closed,refund,round).round;log.push(refund,id);const final=paid(refund,adjusted);log.push(final,id);balances=final.seats.map(p=>p.stack);}
 log.push(anchor(hands%2),'completed-'+(hands+1));return log.result();
}
function sidepots(){const log=build(),id='sidepot-demo',base={street:'river',board:['2c','3d','4h','8s','9c'],hero:['As','Ad'],heroSeat:0,actor:0,bigBlind:100,deadMoney:0,pot:300,roundStart:{dealer:2},seats:[100,200,300].map(stack=>({stack,committed:100,bet:0,folded:false}))},round=new R.Round(base,2);log.push(base,id);
 for(const [type,to] of [['raise',100],['raise',200],['call',0]]){round.apply(type,to);log.push(observed(base,round),id);}
 const reveal=observed(base,round);reveal.phase='showdown';reveal.showdown=[{seat:1,cards:['Ks','Kd']},{seat:2,cards:['Qs','Qd']}];log.push(reveal,id);log.push(paid(reveal,round),id);return log.result();
}
return {session,sidepots};
});
