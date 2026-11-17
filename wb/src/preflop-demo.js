(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./round-audit.js'));else root.WorkbenchPreflopDemo=factory(root.WorkbenchRound);})(typeof globalThis!=='undefined'?globalThis:this,function(R){
'use strict';const copy=x=>JSON.parse(JSON.stringify(x));
function create(n=8){if(![2,6,8].includes(n))throw Error('Choose 2, 6 or 8 seats');const sb=n===2?0:1,bb=(sb+1)%n,base={street:'preflop',board:[],hero:['As','Ad'],actor:(bb+1)%n,bigBlind:100,deadMoney:0,pot:150+n*10,roundStart:{dealer:0,smallBlind:sb,bigBlindSeat:bb,ante:10,dealt:n},seats:Array.from({length:n},(_,i)=>{const bet=i===sb?50:i===bb?100:0;return {stack:2500-10-bet,committed:10+bet,bet,folded:false};})},frames=[];
 function push(s){for(let j=0;j<2;j++){const i=frames.length;frames.push({table:1,hand:'preflop-demo',frame:'pre-'+i,sequence:i,timeMs:i*200,quality:{accepted:true,minScore:.99,minMargin:.1},state:copy(s)});}}
 push(base);const r=new R.Round(base,0);while(!r.closed){const p=r.seats[r.actor],type=n===8&&[3,4].includes(r.actor)?'fold':r.price>p.bet?'call':'check';r.apply(type);const s=copy(base);s.seats=copy(r.seats);s.actor=r.actor;s.pot=s.seats.reduce((a,p)=>a+p.committed,0);if(r.closed)s.roundClosed=true;push(s);}
 const flop=copy(frames.at(-1).state);flop.street='flop';flop.board=['2c','3d','4h'];delete flop.roundClosed;flop.seats.forEach(p=>p.bet=0);flop.actor=Array.from({length:n},(_,j)=>(j+1)%n).find(i=>!flop.seats[i].folded&&flop.seats[i].stack>0);push(flop);
 return {format:'eightmax-observation-sequence',version:1,source:'synthetic',frames};
}
return {create};
});
