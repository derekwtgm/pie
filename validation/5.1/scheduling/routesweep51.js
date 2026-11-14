// EightMax 5.1: sweep of the simulated CPU cost on the original device fixture; prints calibrations, the measured
// device/CPU ratios and violations of the reuse invariant (no measurement inside a guaranteed window of an earlier one).
// usage: node validation/5.1/scheduling/routesweep51.js <mwcli> <dir with the libcuda.so.1 test double> <work dir>
const fs=require('fs'),cp=require('child_process'),path=require('path');const [cli,fx,dir]=process.argv.slice(2);
const base=JSON.parse(fs.readFileSync('/home/user/pie/source/tests/fixtures/device-turn.json','utf8'));
for(const ns of [0,50,100,200,400,800,1500])for(const mode of ['gpu','hybrid']){const s={...base,device:mode};fs.writeFileSync(dir+'/s.json',JSON.stringify(s));try{fs.unlinkSync(dir+'/t.txt')}catch{}
const r=cp.spawnSync(cli,[dir+'/s.json',100,4,dir+'/x.state',1024],{encoding:'utf8',env:{...process.env,LD_LIBRARY_PATH:fx,EM_TEST_ROUTE_TRACE:dir+'/t.txt',...(ns?{EM_TEST_CPU_SCORE_NS:String(ns)}:{})}});
const info=JSON.parse(r.stdout),sc=info.scheduling;const tr=fs.readFileSync(dir+'/t.txt','utf8').trim().split('\n').map(l=>{const[u,route,m,c,d]=l.split(' ').map(Number);return{u,route,m,c,d}});
const ms=tr.filter(x=>x.m),cov=(u,m)=>m.route===0?(u>=m.u/4&&u<=m.u):(u>=m.u&&u<=2*m.u);let viol=0;ms.forEach((m,i)=>{for(const e of ms.slice(0,i))if(cov(m.u,e))viol++});
console.log('cpuNs',ns,mode,'cal',sc.calibrationsThisCall,'violations',viol,'rho',ms.map(m=>(m.d/m.c).toFixed(2)+'@'+m.u+'r'+m.route).join(' '),'units',sc.batchUnitsMin,sc.batchUnitsMax,JSON.stringify(sc.recalibrationReasons))}
