'use strict';
const fs=require('fs'),E=require('./loadlib');
for(const l of ['lib_runouts','lib_wide','lib_river'])require('../web/'+l+'.js');
const ranges=['QhQd,9c9d','AsAd,KsTh','JhJd,8s8d','AcKd,5c5d','AhKh,6s6h','TsTc,7c7d','9h9s,AdQd','KhQh,4c4d'];
const rows=[];
for(let n=3;n<=8;n++){
 const cfg={board:'2c4d7h9sJc',common:10,stacks:Array(n).fill(10),ranges:ranges.slice(0,n),bets:'50',raises:'',maxBets:1,privateMode:'sampled',abstraction:'exact',traversal:'external',privateSeed:17,evaluationDeals:1024,batchDeals:4};
 const g=E.MultiwayGame(cfg);g.iterate(1000);const metrics=g.metrics(),exact=E.exactCheckSampled(cfg,g),responses=[];
 for(let seat=0;seat<n;seat++){const p=g.responseProbe(seat);p.iterate(500);responses.push({seat,...p.finish()});}
 rows.push({players:n,cfg,metrics,exact,responses});console.log(n,'players checked');
}
fs.writeFileSync(process.argv[2],JSON.stringify({note:'Single seed diagnostic. Trained responses are lower bounds, with evaluation sampling standard errors. Exact checks, when available, use the same configured tree. No full-poker equilibrium claim.',rows},null,2));
