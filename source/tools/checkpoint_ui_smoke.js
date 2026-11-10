'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=path.resolve(process.argv[2]);
function libFrom(html){const m=html.match(/<script id="em-lib">([\s\S]*?)<\/script>/);assert.ok(m);return m[1];}
const file=fs.readFileSync(path.join(dir,'EightMax-Offline.html'),'utf8');
const exe=fs.readFileSync(path.join(dir,'EightMax.exe'));
const start=exe.indexOf('<!DOCTYPE html>'),end=exe.indexOf(0,start);
const native=exe.subarray(start,end).toString('utf8').trimEnd();
assert.equal(native.replace('window.EM_NATIVE = true;',''),file.trimEnd());
const lib=libFrom(native),ctx=vm.createContext({atob,btoa,crypto,TextEncoder,TextDecoder,performance,setTimeout,clearTimeout,console});
vm.runInContext(lib,ctx);const E=ctx.EM;
for(const fname of ['lib_pots','lib_icm','lib_deep','lib_runouts','lib_wide','lib_river','lib_quality','lib_information','lib_checkpoint','lib_archive','lib_select','worker']){
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
let thread;const downloads=[],requests=new Map(),replies=new Map();
class BlobSource{constructor(parts){this.source=parts.join('');}}
class BrowserWorker{
  constructor(source){
    const before="const {parentPort}=require('node:worker_threads');const self={postMessage:m=>parentPort.postMessage(m)};\n";
    thread=new Worker(before+source+"\nparentPort.on('message',data=>self.onmessage({data}));",{eval:true});
    thread.on('message',data=>{if(data.type==='result'||data.type==='error')replies.set(requests.get(data.id),data);this.onmessage({data});});
    thread.on('error',e=>this.onerror?this.onerror(e):console.error(e));
  }
  postMessage(m){requests.set(m.id,m.type);thread.postMessage(m);}
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
const document={body:{appendChild(){}},createElement(){return {click(){downloads.push({name:this.download,text:this.href});},remove(){}};},querySelector:q=>elements.get(q)||null,querySelectorAll:()=>[],addEventListener:(k,f)=>events[k]=f};
elements.get('#em-lib').textContent=lib;
Object.assign(ctx,{document,location:{hash:''},history:{replaceState(){}},
  navigator:{userAgent:'QA',hardwareConcurrency:2},addEventListener(){},localStorage:{getItem(){return null;},setItem(){}},
  innerWidth:1100,innerHeight:900,matchMedia:()=>({matches:false}),Worker:BrowserWorker,URL:{createObjectURL:b=>b.source??b,revokeObjectURL(){}},Blob:BlobSource});
ctx.window=ctx;ctx.setTimeout=(f,ms,...args)=>{const timer=setTimeout(f,ms,...args);if(ms===30000)timer.unref();return timer;};
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
  const input=(id,value)=>{const e=elements.get('#rv-'+id);assert.ok(e,id);e.value=String(value);root.listeners.input({target:e});};
  const change=(id,value)=>{const e=elements.get('#rv-'+id);e.value=String(value);root.listeners.change({target:e});};
  const saved=async()=>{const n=downloads.length;click({rvSave:'1'});await waitFor(()=>downloads.length>n&&elements.get('#rv-status').textContent.includes('prepared'),'download failed');const item=downloads.at(-1);assert.ok(item.text instanceof Blob);
    const loaded=await E.loadStudyFile(item.text);return {...item,payload:JSON.parse(JSON.stringify(loaded.game.snapshot(loaded.labels)))};};
  const load=async text=>{replies.delete('multi-load');const e=elements.get('#rv-load');e.files=[typeof text==='string'?new Blob([text]):text];root.listeners.change({target:e});await waitFor(()=>replies.has('multi-load')&&!/Validating|Loading checkpoint/.test(elements.get('#rv-status').textContent),'load did not complete');};
  // Train a small six-way river through the actual form. Grouping, budget and
  // ICM hand-start fields must be included in its saved configuration.
  change('count',6);click({rvExample:'River'});input('iterations',50);input('abstraction','exact');input('memoryMiB',32);
  input('payoff','icm');input('startStacks','25,25,25,25,25,25');
  click({rvSolve:'1'});await waitFor(()=>out().includes('River solution'),'river solve failed');
  assert.match(out(),/Exact cards/);assert.match(out(),/prize units/);
  const first=await saved(),payload=first.payload;
  assert.match(first.name,/EightMax-River-50\.emstudy/);assert.equal(payload.state.iterations,50);assert.equal(payload.cfg.abstraction,'exact');assert.equal(payload.cfg.strategyBudgetMiB,32);assert.equal(payload.cfg.dealt,8);assert.equal(payload.cfg.icm.startStacks.length,6);
  input('resume-iterations',50);input('resume-memory',64);assert.match(out(),/River solution/);
  click({rvResume:'1'});await waitFor(()=>out().includes('100 training iterations'),'resume failed');
  const continued=await saved();
  await load(first.text);assert.match(out(),/50 training iterations/);assert.equal(elements.get('#rv-abstraction').value,'exact');assert.equal(elements.get('#rv-memoryMiB').value,'32');assert.equal(elements.get('#rv-startStacks').value,'25,25,25,25,25,25');
  input('resume-iterations',50);input('resume-memory',64);click({rvResume:'1'});await waitFor(()=>out().includes('100 training iterations'),'loaded resume failed');
  const resumed=await saved();assert.deepEqual(resumed.payload,continued.payload);
  // A rejected file leaves the previously displayed setup and worker intact.
  await load('invalid');assert.match(elements.get('#rv-status').textContent,/checkpoint/i);assert.match(out(),/100 training iterations/);
  const before=out();click({rvAct:'0'});await waitFor(()=>out()!==before,'failed load lost explorer');
  const again=await saved();assert.equal(again.payload.state.iterations,100);
  // Load a linked six-seat preflop study, then save it again without a new solve.
  click({rvExample:'Preflop'});input('iterations',20);input('abstraction','detailed');click({rvSolve:'1'});
  await waitFor(()=>out().includes('Preflop solution'),'linked solve failed');const linked=await saved();
  click({rvExample:'Flop'});await load(linked.text);assert.equal(elements.get('#rv-solve').textContent,'Solve preflop');assert.equal(elements.get('#rv-count').value,'6');assert.match(elements.get('#rv-pot-preview').textContent,/Starting pot 2.30 bb/);
  const roundtrip=await saved();assert.deepEqual(roundtrip.payload,linked.payload);
  // Enumeration also supports lossless resumption with absolute iteration weights.
  click({rvExample:'River'});change('count',3);input('iterations',20);input('target',0);click({rvSolve:'1'});
  await waitFor(()=>out().includes('River solution'),'enumeration failed');const exact=await saved();assert.equal(exact.payload.state.kind,'exact');
  input('resume-iterations',10);click({rvResume:'1'});await waitFor(()=>out().includes('30 iterations'),'exact resume failed');
  console.log('Checkpoint UI/worker passed: six-way ICM, grouping and budget controls, file download/load, exact replay, corrupt-file preservation, linked preflop and enumerated continuation.');
 }finally{if(thread)await thread.terminate();}
}
verify().catch(e=>{console.error(e);process.exitCode=1;});
