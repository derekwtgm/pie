// Assemble both offline entry points from the files shipped in source/web.
const fs = require('node:fs');
const path = require('node:path');
const web = path.resolve(__dirname, '../web');
const dest = path.resolve(process.argv[2] || path.join(__dirname, '../build'));
const read = name => fs.readFileSync(path.join(web, name), 'utf8');
// Version and a reproducible build identifier: SHA-256 over the version file and
// every engine and interface source file (sorted paths and contents). The same
// identifier is embedded in both HTML entry points and compiled into the native
// host by native/build.sh, so mismatched pieces can be detected.
const root = path.resolve(__dirname, '..');
const VERSION = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
if (!/^\d+\.\d+(\.\d+)?$/.test(VERSION)) throw Error('Bad source/VERSION');
const {build:BUILD,files:inputs}=require('./fingerprint')(root);
const buildInfo='globalThis.EM.BUILD = Object.freeze({version:'+JSON.stringify(VERSION)+',build:'+JSON.stringify(BUILD)+'});';

function compactCharts() {
  const source = read('lib_charts.js');
  const match = /EM\.CHARTS = (\{[^\n]+\});/.exec(source);
  if (!match) throw Error('Could not read push/fold charts');
  const charts = JSON.parse(match[1]);
  for (const key of Object.keys(charts.data)) {
    const plain = charts.data[key];
    const packed = plain.replace(/(.)\1{3,66}/g, run => '.' + run[0] + charts.alph[run.length-4]);
    const decoded = packed.replace(/\.(.)(.)/g, (_, c, n) => c.repeat(4+charts.alph.indexOf(n)));
    if (decoded !== plain) throw Error('Push/fold chart packing failed');
    charts.data[key] = packed;
  }
  const unpack = "for (const key of Object.keys(EM.CHARTS.data)) EM.CHARTS.data[key] = EM.CHARTS.data[key].replace(/\\.(.)(.)/g, (_,c,n) => c.repeat(4+EM.CHARTS.alph.indexOf(n)));";
  return source.replace(match[0], () => 'EM.CHARTS = ' + JSON.stringify(charts) + ';\n' + unpack);
}
// Dictionary packing changes only the on-disk chart representation. Check every
// entry against its source before embedding it in the fixed Windows resource.
function compactDeepCharts() {
  const source=read('lib_deeplib.js'),match=/EM\.DEEP_LIB = (\{[^\n]+\});/.exec(source);
  if(!match)throw Error('Could not read deeper preflop charts');
  const charts=JSON.parse(match[1]),original={...charts.data},counts=new Map();
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  for(const plain of Object.values(original)){
    if(plain.includes('~'))throw Error('Chart marker is already used');
    for(const size of [4,6,8,12,16,24,32])for(let i=0;i+size<=plain.length;i+=2){
      const word=plain.slice(i,i+size);counts.set(word,(counts.get(word)||0)+1);
    }
  }
  const candidates=[...counts].filter(([word,n])=>n>3).sort((a,b)=>(b[0].length-2)*b[1]-(a[0].length-2)*a[1]).slice(0,6000),dict=[];
  for(const [word] of candidates){
    if(dict.length===alphabet.length)break;
    const entries=Object.entries(charts.data).map(([key,text])=>[key,text.split(/(~[A-Za-z0-9_-])/).map((part,i)=>i%2?[part]:part.split(word))]);
    const count=entries.reduce((n,[,parts])=>n+parts.reduce((v,chunk)=>v+chunk.length-1,0),0);
    if(count*(word.length-2)<=word.length+24)continue;
    const code='~'+alphabet[dict.length];dict.push(word);
    for(const [key,parts] of entries)charts.data[key]=parts.map(chunk=>chunk.join(code)).join('');
  }
  for(const [key,text] of Object.entries(charts.data)){
    const plain=text.replace(/~([A-Za-z0-9_-])/g,(_,c)=>dict[alphabet.indexOf(c)]);
    if(plain!==original[key])throw Error('Deeper chart packing failed at '+key);
  }
  const unpack='const dictionary='+JSON.stringify(dict)+', codes='+JSON.stringify(alphabet)+';\nfor(const key of Object.keys(EM.DEEP_LIB.data)) EM.DEEP_LIB.data[key]=EM.DEEP_LIB.data[key].replace(/~([A-Za-z0-9_-])/g,(_,c)=>dictionary[codes.indexOf(c)]);';
  return source.replace(match[0],()=> 'EM.DEEP_LIB = '+JSON.stringify(charts)+';\n'+unpack);
}
const files=['lib_cards','lib_eval','lib_pots','lib_icm','lib_information','lib_checkpoint','lib_archive','lib_eqdata','lib_pushfold','lib_fgs','lib_charts',
  'lib_postflop','lib_wasm','lib_deep','lib_deeplib','lib_flops','lib_runouts','lib_wide','lib_river','lib_select','lib_quality','lib_explorer','lib_dashboard','worker'];
const libParts=files.map(x => x==='lib_charts'?compactCharts():x==='lib_deeplib'?compactDeepCharts():read(x+'.js')).join('\n;\n');
const lib=libParts+'\n;\n'+buildInfo;
const app=read('lib_river_ui.js')+'\n;\n'+read('app.js'), css=read('app.css');
for(const source of [lib,app,css]) if(source.includes('</script')) throw Error('Unexpected script terminator');
let html=read('index.template.html').replace('/*VERSION*/',VERSION);
for(const [marker,source] of [['/*CSS*/',css],['/*LIB*/',lib],['/*APP*/',app]]) {
  if(!html.includes(marker)) throw Error('Missing '+marker);
  html=html.replace(marker,()=>source);
}
fs.mkdirSync(dest,{recursive:true});
for(const native of [false,true]) {
  const output=html.replace('/*NATIVE*/',native?'window.EM_NATIVE = true;':'');
  const filename=native?'native.html':'EightMax-Offline.html';
  fs.writeFileSync(path.join(dest,filename),output);
  console.log(filename,Buffer.byteLength(output),'bytes');
}
fs.writeFileSync(path.join(dest,'build-info.json'),JSON.stringify({version:VERSION,build:BUILD,files:inputs},null,1)+'\n');
console.log('EightMax',VERSION,'build',BUILD);
