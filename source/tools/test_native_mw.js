'use strict';
// Native multiway protocol test against a built host (Linux binary, or EightMax.exe through Wine).
// Usage: node tools/test_native_mw.js <executable> [report.json]
// Trains through /api/mw on the host and checks the state bit for bit against the
// JavaScript reference, then cancellation, refusal of concurrent jobs, malformed
// state, memory reporting and release of the tables.
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),{spawn}=require('child_process'),assert=require('assert/strict');
const E=require('./loadlib.js');for(const l of ['lib_runouts','lib_wide','lib_river','lib_river_ui'])require('../web/'+l+'.js');
const exe=path.resolve(process.argv[2]),reportFile=process.argv[3],viaWine=exe.toLowerCase().endsWith('.exe')&&process.platform!=='win32';
const checks=[],pass=m=>{checks.push(m);console.log('PASS  '+m);};
function rows(u8){const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength),hl=dv.getUint32(8,true);let p=12+hl;const c=dv.getUint32(p,true);p+=4;const m=new Map();
  for(let i=0;i<c;i++){const k=u8[p+8],v=Buffer.from(u8.subarray(p+9,p+9+16*k));if(v.some(x=>x))m.set(Buffer.from(u8.subarray(p,p+8)).toString('hex'),v.toString('hex'));p+=9+16*k;}return m;}
const same=(a,b)=>{const x=rows(a),y=rows(b);if(x.size!==y.size)return false;for(const [k,v] of x)if(y.get(k)!==v)return false;return true;};
const river3={board:'Ks8d5h2c2s',common:12,stacks:[30,30,30],ranges:['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc,QhJh,9c9d','AsKd,KcJc,5d5c,8h7h,AdQd,JdTd,6h6d,4c3c','Kc9c,QsQc:0.5,7d7c,Ah5s,Td9d,JhJc,6s5s,AdJd'],
  streets:{river:{bets:'50,125',raises:'2.5x',maxBets:2}},privateMode:'sampled',abstraction:'exact',traversal:'full',evaluationDeals:128,privateSeed:9,batchDeals:4};
(async()=>{
  const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'em-mw-'));
  const env={...process.env,HOME:home,USERPROFILE:home,EIGHTMAX_GPU:'off',EIGHTMAX_THREADS:'4',WINEDEBUG:'-all'};
  const args=['--no-browser','--port='+port],host=viaWine?spawn('wine',[exe,...args],{env,stdio:'ignore'}):spawn(exe,args,{env,stdio:'ignore'});
  const base='http://127.0.0.1:'+port;let failure=null;
  const call=async(route,body,raw)=>{const init={method:body===undefined?'GET':'POST',headers:{'X-EightMax':'1'}};
    if(body!==undefined){init.body=raw?body:JSON.stringify(body);init.headers['Content-Type']=raw?'application/octet-stream':'application/json';}
    const r=await fetch(base+route,init);return {status:r.status,body:r.headers.get('content-type')?.includes('octet')?new Uint8Array(await r.arrayBuffer()):await r.json()};};
  const idle=async()=>{for(;;){const st=(await call('/api/mw/status')).body;if(!st.running)return st;await new Promise(r=>setTimeout(r,25));}};
  try{
    let info=null;for(let i=0;i<600&&!info;i++){try{info=(await call('/api/info')).body;}catch(e){await new Promise(r=>setTimeout(r,100));}}
    assert.equal(info.multiwayProtocol,1);pass('Host '+info.version+' build '+info.build+' advertises multiway protocol 1 ('+info.logicalCPUs+' logical CPUs)');
    for(const [cfg,label,its,threads] of [[river3,'3-player river, 4 deals/update',400,4],[{...river3,updates:'enumerate'},'3-player river, own-hand enumeration',40,4],
      [{...E.multiwaySpotConfig(E.multiwayExample(6,'River',8)),privateMode:'sampled',abstraction:'exact',engine:'native',batchDeals:16,evaluationDeals:128},'6-player river, 16 deals/update (threaded merge)',4,4]]){
      const js=E.MultiwayGame(cfg),nat=E.MultiwayGame(cfg);
      assert.equal((await call('/api/mw/init',nat.nativeSpec())).status,200);
      const t0=Date.now();assert.equal((await call('/api/mw/train',{iterations:its,threads})).status,200);const st=await idle();
      assert.equal(st.error,null);nat.importNative((await call('/api/mw/state')).body);js.iterate(its);
      assert.ok(same(js.exportNative(),nat.exportNative()),'state differs');
      pass(`${label}: ${its} updates on the host (${st.threads} threads, ${((Date.now()-t0)/1000).toFixed(2)} s) are bit-identical to JavaScript`);
    }
    const g=E.MultiwayGame(river3);await call('/api/mw/init',g.nativeSpec());
    assert.equal((await call('/api/mw/train',{iterations:5000000,threads:2})).status,200);
    assert.equal((await call('/api/mw/train',{iterations:1})).status,409);assert.equal((await call('/api/mw/state')).status,409);
    await new Promise(r=>setTimeout(r,300));const t=Date.now();await call('/api/mw/stop',{});const st=await idle();const stopMs=Date.now()-t;
    assert.ok(st.iterations>0&&st.iterations<5000000);
    const back=E.MultiwayGame(river3);back.importNative((await call('/api/mw/state')).body);const ref=E.MultiwayGame(river3);ref.iterate(back.iterations);
    assert.ok(same(ref.exportNative(),back.exportNative()));
    pass(`Cancellation stops training in ${stopMs} ms after ${st.iterations} updates; the stopped state is complete and resumable (matches ${back.iterations} JavaScript updates); concurrent jobs are refused`);
    assert.equal((await call('/api/mw/import',Buffer.from('EMMW1 junk'),true)).status,400);pass('A malformed native state is refused');
    const mem=(await call('/api/memory',{browserMiB:200})).body;assert.ok(mem.appLimitMiB>0&&mem.residentMiB>0&&mem.browserReportedMiB===200);
    pass(`Memory: application limit ${mem.appLimitMiB} MiB, native process limit ${mem.processLimitMiB} MiB, resident ${mem.residentMiB} MiB, tables ${mem.multiwayTablesMiB} MiB, available ${mem.availableForTablesMiB} MiB`);
    const huge=E.MultiwayGame({...E.multiwaySpotConfig(E.multiwayExample(8,'River',8)),privateMode:'sampled',abstraction:'exact',engine:'native',batchDeals:4,evaluationDeals:128,ranges:Array(8).fill('random')});
    const r=await call('/api/mw/init',huge.nativeSpec());
    if(r.status===400)pass('An oversized 8-player full-range river is refused before allocation: '+r.body.error.slice(0,110));
    else pass('8-player full-range river fits the available budget ('+r.body.engine.tableMiB+' MiB)');
    assert.equal((await call('/api/mw/free',{})).status,200);pass('Tables released');
  }catch(e){failure=e.stack||String(e);console.log('FAIL  '+failure);}
  finally{host.kill('SIGKILL');fs.rmSync(home,{recursive:true,force:true});
    if(reportFile)fs.writeFileSync(reportFile,JSON.stringify({passed:!failure,runtime:viaWine?'wine (not Windows)':process.platform,executable:path.basename(exe),checks,error:failure,generated:new Date().toISOString()},null,1)+'\n');
    process.exitCode=failure?1:0;}
})();
