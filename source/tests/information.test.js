'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../tools/loadlib');
for(const lib of ['lib_runouts','lib_wide','lib_river'])require('../web/'+lib+'.js');
function hand(text){const [a,b]=E.parseBoard(text);return {a,b,id:E.PIDX[a*52+b]};}
function features(h,b){const own=hand(h),board=E.parseBoard(b);return E.handFeatures(own,board,E.evalCards([...board,own.a,own.b]));}
test('Detailed groups distinguish nut and weak flush draws and one-card draws',()=>{
 const nut=features('AhKh','2h7hJc'),weak=features('9h8h','2h7hJc'),one=features('AhKc','2h7hJh');
 assert.equal(nut.flushDraw,1);assert.equal(weak.flushDraw,1);assert.equal(one.flushDraw,1);
 assert.notEqual(nut.key,weak.key);assert.match(nut.flush[0],/^2\.2\.c\.0$/);assert.match(one.flush[0],/^3\.1\.c\.0$/);
 assert.equal(features('AhKh','2h7cJd').backdoorFlush,1);assert.equal(features('AhKh','2c7dJs').backdoorFlush,0);
});
test('Straight features separate open ends, inside draws, double gutters and backdoors',()=>{
 assert.equal(features('8c9d','6h7sKc').drawType,'open-ended');
 assert.equal(features('8cTd','6h7sKc').drawType,'gutshot');
 assert.equal(features('8cTd','6h9sQc').drawType,'multiple-gutshot');
 assert.ok(features('8c9d','6h2sKc').backdoor>0);
 assert.equal(features('8c9d','6h7sKc2d3c').drawType,'none');
});
test('Detailed information is invariant under suit renaming and hole-card order',()=>{
 const own=hand('AhKh'),board=E.parseBoard('2h7hJc'),f=E.handFeatures(own,board,E.evalCards([...board,own.a,own.b]));
 for(const permutation of [[1,2,3,0],[3,2,1,0],[2,0,3,1]]){
  const change=c=>(c>>2)*4+permutation[c&3],a=change(own.b),b=change(own.a),h={a,b,id:E.PIDX[a*52+b]},pub=board.map(change);
  assert.equal(E.handFeatures(h,pub,E.evalCards([...pub,a,b])).key,f.key);
 }
 assert.notEqual(features('AhKh','2h7hJc').texture,features('AhKh','2h2cJd').texture);
});
test('Exact-card keys retain suits and turn/river order while canonicalizing the flop',()=>{
 const h=hand('AhKh'),board=E.parseBoard('2h7hJc9dTs');
 assert.equal(E.exactHandKey(h,board),E.exactHandKey(h,[board[2],board[0],board[1],...board.slice(3)]));
 assert.notEqual(E.exactHandKey(h,board),E.exactHandKey(h,[...board.slice(0,3),board[4],board[3]]));
 assert.notEqual(E.exactHandKey(h,board),E.exactHandKey(hand('AsKs'),board));
});
test('Detailed root signals use only current cards and retain histories on later streets',()=>{
 const cfg={board:'2h7hJc',common:10,stacks:[3,3],ranges:['random','random'],privateMode:'sampled',traversal:'external',bets:'a',raises:'',maxBets:1,evaluationDeals:128};
 const g=E.MultiwayGame(cfg);g.iterate(50);const rows=g.snapshot().state.records;
 const root=rows.find(r=>r.path==='r');assert.ok(root);
 for(const [key] of root.rows){assert.equal(key.split('/').length,2);assert.ok(!key.includes('undefined'));}
 assert.ok(rows.some(r=>r.path.includes('c')&&r.rows.some(([key])=>key.split('/').length>=3)));
});
