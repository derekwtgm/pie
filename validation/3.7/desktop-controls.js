// Execute the shipped UI code in a small DOM fixture against a real Linux desktop server.
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert/strict');
const {withHost}=require('../../source/tests/checkpoint_host'),root=path.resolve(__dirname,'../..');
process.env.EM_TEST_HOST=path.resolve(process.argv[2]);const home=fs.mkdtempSync(path.join(os.tmpdir(),'em37-ui-'));
async function until(fn){const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw Error('UI timeout');await new Promise(r=>setTimeout(r,20));}}
(async()=>{try{await withHost(home,{},async(api,base)=>{
 const binary=fs.readFileSync(path.join(root,'EightMax.exe')),start=binary.indexOf('<!DOCTYPE html>'),html=binary.subarray(start,binary.indexOf(0,start)).toString();
 const lib=html.match(/<script id="em-lib">([\s\S]*?)<\/script>/)[1],ui=fs.readFileSync(path.join(root,'source/web/lib_river_ui.js'),'utf8');assert.ok(html.includes(ui));
 const routes=[],events={},elems=new Map();const el=k=>elems.get('#rv-desktop-'+k);
 const dom={addEventListener:(k,fn)=>events[k]=fn,querySelector:q=>elems.get(q)||null,set innerHTML(html){
  for(const m of html.matchAll(/\bid="(rv-[^"]+)"/g))elems.set('#'+m[1],{id:m[1],style:{},value:'',textContent:'',items:[],append(o){this.items.push(o);},replaceChildren(){this.items=[];}});}};
 const ctx=vm.createContext({performance,TextEncoder,TextDecoder,atob,btoa,crypto,Blob,console,setTimeout,clearTimeout,setInterval,clearInterval,window:{EM_NATIVE:true},document:{createElement:()=>({})},fetch:(url,init)=>{routes.push((init?.method||'GET')+' '+url);return fetch(base+url,init);}});
 vm.runInContext(lib,ctx);vm.runInContext(ui,ctx);ctx.EM.multiwayPanel(dom,()=>{throw Error('Unexpected browser state request');},String,String,(v,d)=>Number(v).toFixed(d)).render();
 const has=v=>el('status').textContent.includes(v),click=key=>events.click({target:{closest:()=>({dataset:{nativeAction:key}})}});
 el('file').files=[new Blob([fs.readFileSync(path.join(__dirname,'fixtures/eight-seat-3.6.emstudy'))])];events.change({target:el('file')});await until(()=>has('8 updates'));
 click('policy');await until(()=>el('hand').items.length===1326);assert.match(el('mix').textContent,/%/);el('updates').value='7';click('train');await until(()=>has('15 updates'));
 click('save');await until(()=>has('committed'));click('release');await until(()=>has('closed'));click('latest');await until(()=>has('15 updates'));
 assert.ok(!routes.includes('GET /api/checkpoint/latest')&&!routes.includes('GET /api/mw/state'));
 fs.writeFileSync(process.argv[3],JSON.stringify({method:'Windows executable UI JavaScript, simulated DOM, real native Linux HTTP host',status:el('status').textContent,initialUpdates:8,rootHands:1326,generation:(await(await api('checkpoint/status')).json()).generation,routes},null,2));
});}finally{fs.rmSync(home,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
