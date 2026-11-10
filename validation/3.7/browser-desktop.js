// Optional renderer smoke test. Install Playwright and its Chromium in the test environment first.
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {withHost}=require('../../source/tests/checkpoint_host'),{chromium}=require('playwright');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'em37-browser-'));
process.env.EM_TEST_HOST=path.resolve(process.argv[2]);
(async()=>{try{await withHost(home,{},async(api,base)=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage(),requests=[],errors=[];page.on('request',r=>requests.push(r.method()+' '+new URL(r.url()).pathname));page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('[data-tab="river"]').click();await page.locator('#rv-desktop-file').setInputFiles(path.join(__dirname,'fixtures/eight-seat-3.6.emstudy'));
  const status=text=>page.waitForFunction(t=>document.querySelector('#rv-desktop-status')?.textContent.includes(t),text);
  const click=action=>page.locator('[data-native-action="'+action+'"]').click();
  await status('8 updates');await click('policy');await page.locator('#rv-desktop-hand option').first().waitFor({state:'attached'});
  assert.equal(await page.locator('#rv-desktop-hand option').count(),1326);await page.locator('#rv-desktop-updates').fill('7');await click('train');await status('15 updates');
  await click('save');await status('committed');await click('release');await status('closed');await click('latest');await status('15 updates');
  assert.deepEqual(errors,[]);assert.ok(!requests.includes('GET /api/mw/state')&&!requests.includes('GET /api/checkpoint/latest'));
  fs.writeFileSync(process.argv[3],JSON.stringify({chromium:browser.version(),os:process.platform,initial:8,resumed:15,startingHands:1326,requests,errors},null,2));
 }finally{await browser.close();}
});}finally{fs.rmSync(home,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
