'use strict';
// Runs the actual UI handlers against a minimal in-memory DOM. No browser dependencies.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const E=require('../src/engine.js'),elements=new Map(),listeners={};let interval,downloads=[];
function element(id){if(!elements.has(id))elements.set(id,{id,style:{},innerHTML:'',textContent:'',hidden:false,disabled:false,value:id==='table-count'?'10':id==='speed'?'1':'0',files:[],click(){if(this.onclick)this.onclick();},scrollIntoView(){}});return elements.get(id);}
const document={getElementById:element,hidden:false,addEventListener(k,fn){listeners[k]=fn;},createElement(){const a={click(){downloads.push(a);}};return a;}};
const window={EightMax:E,addEventListener(){}};
const context={window,document,performance:{now:()=>0},setInterval:fn=>interval=fn,setTimeout:()=>0,clearTimeout(){},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Blob,confirm:()=>true,console};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),context);
assert.equal((element('table-grid').innerHTML.match(/data-table=/g)||[]).length,10);
element('start').click();assert.equal(window.workbench.coordinator.running,true);assert.equal(element('start').disabled,true);
for(let i=0;i<150;i++)window.workbench.coordinator.tick(i*100);window.workbench.render();assert.ok(window.workbench.coordinator.totalActions>0);
element('table-grid').onclick({target:{closest:()=>({dataset:{table:'5'}})}});assert.match(element('detail-title').textContent,/05/);
element('table-pause').click();assert.equal(window.workbench.coordinator.tables[4].paused,true);element('table-pause').click();assert.equal(window.workbench.coordinator.tables[4].paused,false);
element('pause').click();assert.equal(window.workbench.coordinator.running,false);element('start').click();assert.equal(window.workbench.coordinator.running,true);
element('replay-nav').click();assert.equal(element('replay-panel').hidden,false);assert.match(element('replay-caption').textContent,/Frame/);assert.equal(window.workbench.coordinator.running,false);
element('export').click();assert.equal(downloads.length,1);assert.match(downloads[0].download,/EightMax-simulation/);
element('stop').click();assert.equal(window.workbench.coordinator.stopped,true);assert.equal(element('start').disabled,true);element('reset').click();assert.equal(window.workbench.coordinator.stopped,false);assert.equal(window.workbench.coordinator.recording.length,0);
element('table-count').value='4';element('table-count').onchange();assert.equal(window.workbench.coordinator.tables.length,4);
element('start').click();document.hidden=true;listeners.visibilitychange();assert.equal(window.workbench.coordinator.running,false);document.hidden=false;element('start').click();listeners.keydown({key:'Escape'});assert.equal(window.workbench.coordinator.stopped,true);
assert.equal(typeof interval,'function');console.log('PASS UI logic: table grid, start/pause/resume, table selection, independent pause, replay, export, emergency stop/reset, table count, background pause and Escape.');
console.log('This test checks handlers and generated markup, not browser rendering or Windows launch.');
