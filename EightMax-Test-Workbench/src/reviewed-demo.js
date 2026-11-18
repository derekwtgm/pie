/* Synthetic exact-menu history: opponent bets half-pot, hero faces the bet. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./round-audit.js'));else root.WorkbenchReviewedDemo=factory(root.WorkbenchRound);})(typeof globalThis!=='undefined'?globalThis:this,function(R){
'use strict';const copy=x=>JSON.parse(JSON.stringify(x));
function create(){
 const root={street:'river',board:['2c','3d','4h','8s','9c'],hero:['As','Ad'],heroSeat:0,actor:1,bigBlind:100,pot:400,deadMoney:0,roundStart:{dealer:0},seats:[{stack:1000,committed:200,bet:0,folded:false},{stack:1000,committed:200,bet:0,folded:false}]};
 const round=new R.Round(root,0);round.apply('raise',200);const target={...copy(root),actor:round.actor,seats:copy(round.seats),pot:600};
 return {format:'eightmax-observation-sequence',version:1,source:'synthetic',frames:[root,root,target,target].map((state,index)=>({table:1,hand:'reviewed-demo',frame:'reviewed-'+index,sequence:index,timeMs:index*200,quality:{accepted:true,minScore:.99,minMargin:.1},state:copy(state)}))};
}
return {create};
});
