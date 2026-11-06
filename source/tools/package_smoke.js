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
async function verify() {
  try{
    vm.runInContext(app,ctx);assert.ok(elements.get('#v-preflop').innerHTML.includes('Push/fold'));
    eventClick(events.click,{tab:'river'});
    const root=elements.get('#v-river');assert.equal(elements.get('#rv-solve').textContent,'Solve flop');
    const click=data=>eventClick(root.listeners.click,data);
    const out=()=>elements.get('#rv-output').innerHTML;
    // Six-seat example uses the actual selector and the actual submit button.
    const count=elements.get('#rv-count');count.value='6';root.listeners.change({target:count});
    assert.ok(root.innerHTML.includes('Seat 6 range'));
    const preview=()=>elements.get('#rv-pot-preview').textContent;
    const dealt=elements.get('#rv-dealt');
    assert.match(preview(),/0.8 bb in antes · Starting pot 12.80 bb/);
    dealt.value='6';root.listeners.input({target:dealt});
    assert.match(preview(),/0.6 bb in antes · Starting pot 12.60 bb/);
    dealt.value='8';root.listeners.input({target:dealt});
    click({rvSolve:'1'});
    await waitFor(()=>out().includes('Flop solution'),'flop did not finish');assert.match(out(),/Pot 12.80 bb/);
    assert.match(out(),/Sampled betting traversal/);assert.match(out(),/Seat 6/);
    for (const next of ['Turn','River']){
      for(let i=0;i<6;i++){
        const before=out();assert.ok(before.includes('data-rv-act="0"'));click({rvAct:'0'});
        await waitFor(()=>out()!==before,'action explorer did not advance');
      }
      assert.match(out(),new RegExp('Deal the '+next.toLowerCase()));
      const card=out().match(/data-rv-card="(\d+)"/)[1];click({rvCard:card});
      await waitFor(()=>out().includes('to act'),'card did not advance');
    }
    click({rvExample:'Turn'});assert.equal(elements.get('#rv-solve').textContent,'Solve turn');
    assert.equal(elements.get('#rv-privateMode').value,'sampled');
    click({rvSolve:'1'});await waitFor(()=>out().includes('Turn solution'),'exact turn did not finish');
    assert.match(out(),/Wide ranges/);
    click({rvExample:'River'});assert.equal(elements.get('#rv-solve').textContent,'Solve river');
    click({rvSolve:'1'});await waitFor(()=>out().includes('River solution'),'fixed river did not finish');assert.match(out(),/Wide ranges/);
    // Exercise the real comparison controls and response report after a
    // shorter river solve, keeping the interface test independent of timings.
    elements.get('#rv-iterations').value='150';
    root.listeners.input({target:elements.get('#rv-iterations')});
    click({rvSolve:'1'});await waitFor(()=>out().includes('River solution'),'short river solve failed');
    elements.get('#rv-check-response').value='100';
    root.listeners.input({target:elements.get('#rv-check-response')});
    click({rvCheck:'1'});
    await waitFor(()=>out().includes('6 recorded solves'),'accuracy report did not finish');
    assert.match(out(),/6 tested responses/);assert.match(out(),/Paired EV change/);
    assert.match(out(),/Tested response gain/);assert.match(out(),/Individual runs/);
    assert.match(out(),/data-rv-act="0"/);
    // The three-seat example still supports exact enumeration.
    click({rvExample:'Turn'});
    const fewer=elements.get('#rv-count');fewer.value='3';root.listeners.change({target:fewer});
    assert.equal(elements.get('#rv-privateMode').value,'exact');
    click({rvSolve:'1'});await waitFor(()=>out().includes('Turn solution'),'exact turn failed');
    assert.match(out(),/All legal future cards/);
    eventClick(events.click,{dpWide25:'1'});
    assert.match(preview(),/0.8 bb in antes · Starting pot 6.80 bb/);
    assert.equal(elements.get('#rv-stack0').value,'22.9');
    assert.equal(elements.get('#rv-stack1').value,'22.9');
    assert.equal(elements.get('#rv-stack2').value,'22.9');
    assert.equal(elements.get('#rv-privateMode').value,'sampled');
    assert.equal(elements.get('#rv-board').value,'2c 4d 7h');
    click({rvSolve:'1'});
    await waitFor(()=>out().includes('Flop solution'),'full chart solve did not finish');
    assert.match(out(),/Wide ranges/);assert.match(out(),/10,000 training iterations/);assert.match(out(),/Standard error/);
    assert.match(out(),/SB/);assert.match(out(),/BB/);assert.match(out(),/BTN/);
    console.log('Packaged 25 bb full-range preset and worker result passed.');
    console.log('Packaged UI/worker integration passed: 6-seat flop through turn and river, exact turn, fixed river, accuracy report, seed repeats, added sizes and trained responses through normal controls.');
  }finally{if(thread)await thread.terminate();}
}
verify().catch(e=>{console.error(e);process.exitCode=1;});
