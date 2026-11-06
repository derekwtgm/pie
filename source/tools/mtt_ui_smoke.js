'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=path.resolve(process.argv[2]);
function libFrom(html){const m=html.match(/<script id="em-lib">([\s\S]*?)<\/script>/);assert.ok(m);return m[1];}
const file=fs.readFileSync(path.join(dir,'EightMax-Offline.html'),'utf8');
const exe=fs.readFileSync(path.join(dir,'EightMax.exe'));
const start=exe.indexOf('<!DOCTYPE html>'),end=exe.indexOf(0,start);
const native=exe.subarray(start,end).toString('utf8').trimEnd();
assert.equal(native.replace('window.EM_NATIVE = true;',''),file.trimEnd());
const lib=libFrom(native),ctx=vm.createContext({atob,btoa,crypto,TextEncoder,performance,setTimeout,clearTimeout,console});
vm.runInContext(lib,ctx);const E=ctx.EM;
for(const fname of ['lib_pots','lib_icm','lib_deep','lib_runouts','lib_wide','lib_river','lib_quality','lib_information','lib_checkpoint','worker']){
  assert.ok(lib.includes(fs.readFileSync(path.join(dir,'source/web',fname+'.js'),'utf8')),fname);
}
require(path.join(dir,'source/web/lib_charts.js'));
for(const depth of E.CHARTS.stacks)assert.equal(E.CHARTS.data[depth],globalThis.EM.CHARTS.data[depth]);
require(path.join(dir,'source/web/lib_deeplib.js'));
for(const depth of E.DEEP_LIB.depths)assert.equal(E.DEEP_LIB.data[depth],globalThis.EM.DEEP_LIB.data[depth]);
const sample={board:'2c4d7h9sJc',common:12,stacks:[16,32,26],ranges:['QhQd,9c9d','AsAd,KsTh','JhJd,8s8d'],bets:'50,100',raises:'2.5x',maxBets:2};
const node=E.RiverGame(sample);node.iterate(100);console.log('Embedded default example:',JSON.stringify(node.metrics()));
const five={...sample,stacks:[40,15,21,40,40],ranges:['AsAd','KsKd','QhQd','8c8d','6c6d'],common:10,bets:'100',raises:'a',maxBets:5};
const game=E.RiverGame(five);game.iterate(5);const m=game.metrics();
assert.ok(m.gain.every(x=>Number.isFinite(x) && x>=0));assert.ok(Math.abs(m.ev.reduce((a,b)=>a+b,0)-10)<1e-9);
console.log('Embedded five-seat solve:',m.deals,'deals',m.nodes,'nodes');
const app=file.slice(file.indexOf('<script>',file.indexOf('</script>',file.indexOf('id="em-lib"')))+8,file.lastIndexOf('</script>'));
const uiSrc=fs.readFileSync(path.join(dir,'source/web/lib_river_ui.js'),'utf8');
assert.ok(app.includes(uiSrc));assert.ok(app.includes(fs.readFileSync(path.join(dir,'source/web/app.js'),'utf8')));
// Drive the real packaged event handlers and Blob worker in an isolated DOM
// fixture. The worker's browser message API is bridged to a separate Node thread.
const {Worker}=require('node:worker_threads');
let thread;
class BlobSource{constructor(parts){this.source=parts.join('');}}
class BrowserWorker{
  constructor(source){
    const before="const {parentPort}=require('node:worker_threads');const self={postMessage:m=>parentPort.postMessage(m)};\n";
    thread=new Worker(before+source+"\nparentPort.on('message',data=>self.onmessage({data}));",{eval:true});
    thread.on('message',data=>this.onmessage({data}));
    thread.on('error',e=>this.onerror?this.onerror(e):console.error(e));
  }
  postMessage(m){thread.postMessage(m);}
}
const elements=new Map(),events={};
function fixtureElement(id) {
  return {id,hidden:false,value:'',textContent:'',style:{},dataset:{},listeners:{},
    classList:{contains:()=>false,add(){},remove(){}},setAttribute(){},
    addEventListener(k,f){this.listeners[k]=f;},querySelector:q=>elements.get(q)||null,
    get innerHTML(){return this.html||'';},
    set innerHTML(text){
      this.html=text;
      if(this.id!=='v-river' && this.id!=='rv-output')return;
      for(const tag of text.matchAll(/<(input|div|button|tr|select|p)\b([^>]*\bid="(rv-[^"]+)"[^>]*)>/g)){
        const [,type,attrs,name]=tag, child=fixtureElement(name);
        if(type==='input'){child.value=attrs.match(/value="([^"]*)"/)?.[1]||'';child.checked=/\bchecked\b/.test(attrs);}
        if(type==='select'){
          const options=text.slice(tag.index+tag[0].length).split('</select>')[0];
          const all=[...options.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];
          const selected=all.find(o=>o[1].includes('selected'))||all[0];child.value=selected[1].match(/value="([^"]*)"/)?.[1]||selected[2];
        }
        elements.set('#'+name,child);
      }
    }
  };
}
for(const [,id] of file.matchAll(/\bid="([^"]+)"/g))elements.set('#'+id,fixtureElement(id));
const document={querySelector:q=>elements.get(q)||null,querySelectorAll:()=>[],addEventListener:(k,f)=>events[k]=f};
elements.get('#em-lib').textContent=lib;
Object.assign(ctx,{document,location:{hash:''},history:{replaceState(){}},
  navigator:{userAgent:'QA',hardwareConcurrency:2},addEventListener(){},localStorage:{getItem(){return null;},setItem(){}},
  innerWidth:1100,innerHeight:900,matchMedia:()=>({matches:false}),Worker:BrowserWorker,URL:{createObjectURL:b=>b.source},Blob:BlobSource});
ctx.window=ctx;
function button(data){return {dataset:data,closest(s){return s==='button'?this:null;},classList:{contains:()=>false}};}
function eventClick(fn,data){fn({target:button(data)});}
async function waitFor(test,message) {
  const end=Date.now()+90000;
  for(;;){
    if(test())return;
    if(Date.now()>end)throw Error(message+'; '+(elements.get('#rv-status')?.textContent||''));
    await new Promise(r=>setTimeout(r,5));
  }
}

async function verify(){
 try{
  vm.runInContext(app,ctx);eventClick(events.click,{tab:'river'});
  const root=elements.get('#v-river'),click=data=>eventClick(root.listeners.click,data),out=()=>elements.get('#rv-output').innerHTML;
  const input=(id,value)=>{elements.get('#rv-'+id).value=value;root.listeners.input({target:elements.get('#rv-'+id)});};
  const count=n=>{const el=elements.get('#rv-count');el.value=String(n);root.listeners.change({target:el});};
  click({rvExample:'Preflop'});count(6);
  assert.equal(elements.get('#rv-solve').textContent,'Solve preflop');assert.match(root.innerHTML,/Before posting/);
  assert.match(elements.get('#rv-pot-preview').textContent,/Starting pot 2.30 bb/);
  for(let i=0;i<6;i++)input('range'+i,['AsAd','KsKd','QhQd','JsJd','TsTd','9s9d'][i]);
  input('iterations','100');input('preRaises','');input('preCap','1');
  click({rvSolve:'1'});await waitFor(()=>out().includes('Preflop solution'),'linked preflop failed');
  async function action(label){const html=out(),buttons=[...html.matchAll(/data-rv-act="(\d+)">([^<]*)/g)],act=buttons.find(x=>x[2].startsWith(label));assert.ok(act,html.slice(-3000));click({rvAct:act[1]});await waitFor(()=>out()!==html,'action did not advance');}
  await action('Raise to 2');for(let i=1;i<6;i++)await action('Call');
  assert.match(out(),/Deal the flop/);const before=out();input('flop-card','2c 4d 7h');assert.equal(out(),before);
  click({rvFlop:'1'});await waitFor(()=>out().includes('SB to act'),'flop did not load');assert.match(out(),/Pot 12.80 bb/);
  console.log('Six-player preflop-to-flop UI passed.');
  click({rvExample:'Shove / call'});count(8);input('iterations','200');input('payoff','icm');
  assert.ok(!elements.get('#rv-icm-settings').hidden);input('payouts','500,300,200');input('others','');
  click({rvSolve:'1'});await waitFor(()=>out().includes('Preflop solution'),'eight-seat shove ICM failed');
  assert.match(out(),/Estimated EV \(prize units\)/);assert.match(out(),/absolute expected remaining prizes/);assert.ok(!out().includes('EV (bb)'));
  await action('All-in');assert.match(out(),/to act/);await action('Call');assert.match(out(),/to act/);
  input('check-runs','1');input('check-response','100');click({rvCheck:'1'});
  await waitFor(()=>out().includes('8 tested responses'),'shove ICM checks failed');assert.match(out(),/Tested response gain \(prize units\)/);assert.match(out(),/1 recorded solves/);
  console.log('Eight-player shove/call, ICM, overcall and response-check UI passed.');
  click({rvExample:'River'});assert.equal(elements.get('#rv-count').value,'8');count(6);assert.equal(elements.get('#rv-count').value,'6');
  input('payoff','icm');input('iterations','100');click({rvSolve:'1'});await waitFor(()=>out().includes('River solution'),'six-way ICM postflop failed');assert.match(out(),/prize units/);
  console.log('Six-player postflop ICM UI passed.');
  click({rvExample:'Shove / call'});count(3);input('anteType','bba');
  assert.match(elements.get('#rv-pot-preview').textContent,/big blind ante 1 bb · Starting pot 2.50 bb/);
  input('anteType','none');assert.match(elements.get('#rv-pot-preview').textContent,/no ante · Starting pot 1.50 bb/);
  input('anteType','bba');input('iterations','100');click({rvSolve:'1'});await waitFor(()=>out().includes('Preflop solution'),'BB ante shove failed');
  console.log('Big blind ante shove/call UI passed.');
  eventClick(events.click,{pfcOvercall:'1'});assert.match(root.innerHTML,/Shove \/ call · 2–8 players/);assert.equal(elements.get('#rv-count').value,'8');
  assert.match(root.innerHTML,/Imported from push\/fold/);
  eventClick(events.click,{dpLinked:'1'});assert.match(root.innerHTML,/Preflop → river · 2–8 players/);assert.equal(elements.get('#rv-count').value,'8');
  assert.match(root.innerHTML,/Imported from the 8-max chart\. Preflop trains/);
  input('iterations','60');click({rvSolve:'1'});await waitFor(()=>out().includes('Preflop solution'),'chart re-solve failed');
  console.log('Push/fold overcall and chart re-solve bridges passed.');
  eventClick(events.click,{tab:'postflop'});assert.match(elements.get('#v-postflop').innerHTML,/Suit isomorphism/);
  eventClick(events.click,{tab:'preflop'});eventClick(events.click,{pfSrc:'custom'});
  eventClick(events.click,{pfcAnte:'bba'});assert.match(elements.get('#v-preflop').innerHTML,/big blind ante 1 bb/);
  eventClick(events.click,{pfcAnte:'classic'});assert.match(elements.get('#v-preflop').innerHTML,/0.1 bb × 8 dealt = 0.8 bb in antes/);
  console.log('Heads-up isomorphism and push/fold ante controls render.');
  for(const [id,v] of [['pfc-ante','0.1'],['pfc-s0','12'],['pfc-s1','20'],['pfc-s2','16'],['pfc-pay','50,30,20'],['pfc-oth','']]){const e=fixtureElement(id);e.value=v;elements.set('#'+id,e);}eventClick(events.click,{pfcModel:'icm'});eventClick(events.click,{pfcN:'3'});
  assert.match(elements.get('#v-preflop').innerHTML,/Future hands \(FGS\)/);assert.match(elements.get('#v-preflop').innerHTML,/Plain ICM values stacks/);
  eventClick(events.click,{pfcFgs:'1'});assert.match(elements.get('#v-preflop').innerHTML,/solving the next hand at the same blinds/);
  eventClick(events.click,{pfcSolve:'1'});await waitFor(()=>elements.get('#v-preflop').innerHTML.includes('FGS 1 hand')||/class="err"/.test(elements.get('#v-preflop').innerHTML),'FGS push/fold solve timed out');
  assert.ok(!/class="err"/.test(elements.get('#v-preflop').innerHTML),'FGS push/fold error: '+(elements.get('#v-preflop').innerHTML.match(/class="err">([^<]*)/)||[])[1]);
  assert.match(elements.get('#v-preflop').innerHTML,/3-handed · ICM · FGS 1 hand/);
  console.log('Push/fold future-game ICM UI passed.');
 } finally {if(thread)await thread.terminate();}
}
verify().catch(e=>{console.error(e);process.exitCode=1;});
