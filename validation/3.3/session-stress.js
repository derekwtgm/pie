// EightMax 3.3 Linux end-to-end stress (extends validation/3.2/session-stress.js):
// exact, Detailed-grouped and DCFR studies on 6- and 8-seat flops and 8-seat linked
// preflop; malformed (negative-ante) specs must be refused with 400 while the host
// stays up; then the same 3.2 rounds. Hold a JS solver in memory while starting,
// cancelling and freeing native studies on one host process.
'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const E=require('../../source/tools/loadlib');
for(const lib of ['lib_runouts','lib_wide','lib_river'])require('../../source/web/'+lib);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const host=spawn(path.resolve(process.argv[2]),['--no-browser','--port='+port],{stdio:'ignore'});
  const call=async(route,data)=>{const r=await fetch('http://127.0.0.1:'+port+'/api/'+route,
    data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-EightMax':'1'},body:JSON.stringify(data)});
    assert.equal(r.status,200);return r.json();};
  const report={platform:process.platform,rounds:[]};
  try {
    for(let i=0;;i++){try{await call('info');break;}catch(err){if(i>100)throw err;await wait(50);}}
    // 3.3: malformed specs are refused and the host keeps serving.
    const bad=E.MultiwayGame({board:'Td7c2h',dealt:8,common:1.5,stacks:Array(6).fill(30),prior:Array(6).fill(2.5),ranges:Array(6).fill('22+,A2s+'),streets:{flop:{bets:'33',raises:'',maxBets:1},turn:{bets:'50',raises:'',maxBets:1},river:{bets:'75',raises:'',maxBets:1}},privateMode:'sampled',traversal:'external',abstraction:'exact'}).nativeSpec();
    for(const mutate of [s=>{s.anteOf[2]=-0.1;},s=>{s.rules.ownAnte[1]=-0.1;},s=>{s.rules.pot0+=1;},s=>{s.batchDeals=2.5;}]){
      const s=JSON.parse(JSON.stringify(bad));mutate(s);
      const r=await fetch('http://127.0.0.1:'+port+'/api/mw/init',{method:'POST',headers:{'Content-Type':'application/json','X-EightMax':'1'},body:JSON.stringify(s)});
      assert.equal(r.status,400);(report.refused=report.refused||[]).push((await r.json()).error||'refused');
    }
    await call('info');
    for(let i=0;i<12;i++){
      const n=i%3===0?6:8;
      const cfg={board:i%3===2?'':'Td7c2h',...(i%3===2?{preflop:{mode:'linked',opens:'2.2,a',raises:'a',maxBets:2}}:{}),
        dealt:n,common:i%3===2?0:2.3,stacks:Array(n).fill(30),ranges:Array(n).fill('22+,A2s+,K9s+,QTs+,JTs,ATo+:0.6'),
        streets:{flop:{bets:'33,75',raises:'3x',maxBets:2},turn:{bets:'66',raises:'a',maxBets:2},river:{bets:'75,a',raises:'',maxBets:1}},
        strategyBudgetMiB:256,privateMode:'sampled',traversal:'external',abstraction:i>=9?'detailed':'exact',...(i>=6&&i<9?{weighting:'dcfr'}:{}),actionStreams:'deal',batchDeals:16,privateSeed:i+1};
      const g=E.MultiwayGame(cfg);g.iterate(2);
      const mem=await call('memory',{browserMiB:Math.ceil(process.memoryUsage().rss/1048576)});
      const init=await call('mw/init',{...g.nativeSpec(),tableLimitMiB:16});await call('mw/train',{iterations:1e6,threads:4});
      let peak=0;const start=performance.now();
      while(performance.now()-start<4000){
        g.iterate(1);const line=fs.readFileSync('/proc/'+host.pid+'/status','utf8').match(/VmRSS:\s+(\d+)/);
        peak=Math.max(peak,Number(line[1]));await wait(100);
      }
      await call('mw/stop',{});let st;
      do{st=await call('mw/status');if(st.running)await wait(20);}while(st.running);
      assert.ok(st.iterations>0 && st.iterations<1e6 && !st.error);
      const r=await fetch('http://127.0.0.1:'+port+'/api/mw/state');assert.equal(r.status,200);
      const checkpoint=new Uint8Array(await r.arrayBuffer());const recovered=E.MultiwayGame(cfg);recovered.importNative(checkpoint);
      assert.equal(recovered.trainingDeals,st.iterations*16);
      await call('mw/free',{});
      report.rounds.push({n,street:cfg.board?'flop':'preflop',abstraction:cfg.abstraction,weighting:cfg.weighting||'linear',elapsedMs:performance.now()-start,
        nativeTableBudgetMiB:init.budgetMiB,availableTableMiB:mem.availableForTablesMiB,peakNativeSampledKiB:peak,
        jsProcessHighWaterKiB:process.resourceUsage().maxRSS,iterations:st.iterations,checkpointBytes:checkpoint.length,
        engine:st.engine});
    }
    fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));
  }finally{host.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
