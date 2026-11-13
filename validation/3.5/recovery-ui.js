// EM_TEST_HOST=<host> CHROMIUM_PATH=<chromium> node recovery-ui.js
const {chromium}=require('playwright'),{withHost}=require('../../source/tests/checkpoint_host');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const fixtures=require('../../source/tests/fixtures/checkpoints-2.5.json');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'em35-ui-'));
 try{await withHost(tmp,{},async(api,url)=>{
  const folder=(await(await api('info')).json()).saveDir;
  fs.writeFileSync(path.join(folder,'autosave.emstudy'),fixtures.wide.text);
  fs.writeFileSync(path.join(folder,'autosave.previous.emstudy'),fixtures.exact.text);
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
  try{
   const page=await browser.newPage();await page.goto(url);await page.locator('[data-tab="river"]').click();
   await page.getByRole('button',{name:'Checkpoint recovery details'}).click();
   await page.getByText('Download legacy slot 1').waitFor();
   assert.match(await page.locator('#rv-storage').innerText(),/ambiguous/);
   await page.locator('[data-rv-adopt="1"]').click();await page.getByText('Download generation 1').waitFor();
   assert.equal(await(await api('checkpoint/latest')).text(),fixtures.exact.text);
   fs.unlinkSync(path.join(folder,'autosave.index'));
   await page.getByRole('button',{name:'Checkpoint recovery details'}).click();
   await page.waitForFunction(()=>document.querySelector('#rv-storage').textContent.includes('(rebuilt)'));
   console.log('PASS desktop UI detected ambiguity, adopted the selected checkpoint and reported reconstructed generation 1.');
  }finally{await browser.close();}
 });}finally{fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
