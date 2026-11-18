(function(EM){
'use strict';
const windows=[0x100f,...Array.from({length:9},(_,i)=>31<<i)];
// All features use only the player's cards and the currently visible board.
// Suit names are interchangeable in Detailed; Exact cards retains actual suits.
EM.handFeatures=function(h,board,score){
  const own=[h.a,h.b],all=[...board,...own],rankCount=Array(13).fill(0),bs=Array(4).fill(0),os=Array(4).fill(0);
  let ranks=0,publicRanks=0,ownRanks=0;
  for(const c of all){ranks|=1<<(c>>2);rankCount[c>>2]++;}
  for(const c of board){publicRanks|=1<<(c>>2);bs[c&3]++;}
  for(const c of own){ownRanks|=1<<(c>>2);os[c&3]++;}
  let outs=0,backdoor=0,blockers=0,connect=0;
  windows.forEach((mask,i)=>{
    const count=EM.POP13[ranks&mask],bc=EM.POP13[publicRanks&mask];connect=Math.max(connect,bc);
    if(board.length<5 && count===4)outs|=mask&~ranks;
    if(board.length===3 && count===3 && (ownRanks&mask))backdoor|=1<<i;
    if(bc>=3)blockers|=ownRanks&mask;
  });
  let openEnded=false;
  for(let low=0;low<=9;low++)if((ranks&(15<<low))===(15<<low) && low>0 && low+4<=12 && (outs&(1<<(low-1))) && (outs&(1<<(low+4))))openEnded=true;
  const flush=[];let flushDraw=0,backdoorFlush=0;
  for(let suit=0;suit<4;suit++)if(os[suit] && bs[suit]){
    const top=Math.max(...own.filter(c=>(c&3)===suit).map(c=>c>>2));
    let higher=0;for(let r=top+1;r<13;r++)if(!board.includes(r*4+suit))higher++;
    flush.push([bs[suit],os[suit],top,higher].map(x=>x.toString(36)).join('.'));
    if(board.length<5 && bs[suit]+os[suit]===4)flushDraw++;
    if(board.length===3 && bs[suit]+os[suit]===3)backdoorFlush++;
  }
  flush.sort();
  const counts=Array(13).fill(0);board.forEach(c=>counts[c>>2]++);
  const shape=counts.filter(Boolean).sort((a,b)=>b-a).join('');
  const texture=[shape,Math.max(...board.map(c=>c>>2)),Math.max(...bs),connect,board.filter(c=>(c>>2)>=8).length].join('.');
  const drawType=EM.POP13[outs]===0?'none':EM.POP13[outs]===1?'gutshot':openEnded?'open-ended':'multiple-gutshot';
  const key=[EM.CLS[h.id],score,outs,backdoor,blockers].map(x=>x.toString(36)).join('.')+':'+texture+':'+flush.join(',');
  return {key,straightOutRanks:outs,drawType,flushDraw,backdoorFlush,flush,texture,backdoor,blockers};
};
EM.exactHandKey=function(h,board){
  return h.id+':'+board.slice(0,3).sort((a,b)=>a-b).concat(board.slice(3)).join('.');
};
})(globalThis.EM || (globalThis.EM = {}));
