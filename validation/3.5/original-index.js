// EM_TEST_HOST=<original 3.4 Linux host> node original-index.js output.json
const {withHost}=require('../../source/tests/checkpoint_host');
const fs=require('fs'),os=require('os'),path=require('path');
const fixture=require('../../source/tests/fixtures/checkpoints-2.5.json');
(async()=>{const result={};
 for(const mode of ['intact','corrupt','missing']){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'em34-repro-'));
  try{await withHost(home,{},async api=>{
   const dir=(await(await api('info')).json()).saveDir;
   for(const value of [fixture.wide.text,fixture.exact.text])if((await api('checkpoint/write',value)).status!==200)throw Error('baseline save failed');
   const index=path.join(dir,'autosave.index');
   if(mode==='corrupt')fs.writeFileSync(index,'bad');if(mode==='missing')fs.unlinkSync(index);
   const row=result[mode]={};for(const op of ['latest','previous']){
    const r=await api('checkpoint/'+op);row[op]={status:r.status,matchesExpected:(await r.text())===(op==='latest'?fixture.exact.text:fixture.wide.text)};
   }row.write=(await api('checkpoint/write',fixture.wide.text)).status;
  });}finally{fs.rmSync(home,{recursive:true,force:true});}
 }
 fs.writeFileSync(process.argv[2],JSON.stringify(result,null,1));
})().catch(e=>{console.error(e);process.exitCode=1;});
