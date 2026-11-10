// EM_TEST_HOST=/path/to/eightmax node desktop-stress.js results.json
const {withHost}=require('../../source/tests/checkpoint_host'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'em35-stress-')),rows=[];
 try{await withHost(root,{},async api=>{
  const json=async(route,v)=>{const r=await api(route,v);assert.equal(r.status,200,route);return r.json();};
  const tests=['es-six-weighted','es-preflop8','es-grouped-six'];
  for(let i=0;i<12;i++){
   const name=tests[i%3],spec=require('../../source/tests/fixtures/'+name+'.json');
   const init=await json('mw/init',{...spec,tableLimitMiB:8});const cancel=i%2===1;
   await json('mw/train',{threads:2,iterations:cancel?1000000:200});
   if(cancel){await new Promise(r=>setTimeout(r,20));await json('mw/stop',{});}
   let s,peak=0;
   for(let j=0;j<1000;j++){
    s=await json('mw/status');peak=Math.max(peak,(await json('memory')).residentMiB);
    if(!s.running)break;await new Promise(r=>setTimeout(r,8));
   }
   assert.ok(!s.running && !s.error);const state=await api('mw/state');assert.equal(state.status,200);
   const bytes=(await state.arrayBuffer()).byteLength;assert.ok(bytes>16);await json('mw/free',{});
   rows.push({name,cancel,budgetMiB:init.budgetMiB,peakSampledResidentMiB:peak,afterFree:await json('memory'),checkpointBytes:bytes,engine:s.engine});
  }
 });fs.writeFileSync(process.argv[2],JSON.stringify(rows,null,1));}finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
