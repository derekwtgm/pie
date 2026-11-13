'use strict';
const fs=require('node:fs'),os=require('node:os'),net=require('node:net'),path=require('node:path');
const {spawn}=require('node:child_process'),build=require('./native_build');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function withHost(home,extra,fn){
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
  const exe=process.env.EM_TEST_HOST||build.host().exe;
  // 4.6: EM_TEST_HOST_STDERR=<file> appends the host's standard error (sanitizer reports) to a file
  const errFd=process.env.EM_TEST_HOST_STDERR?fs.openSync(process.env.EM_TEST_HOST_STDERR,'a'):'ignore';
  const proc=spawn(exe,['--no-browser','--port='+port],{env:{...process.env,HOME:home,USERPROFILE:home,EIGHTMAX_GPU:'off',EIGHTMAX_THREADS:'2',...extra},stdio:['ignore','ignore',errFd]});
  if(typeof errFd==='number')fs.closeSync(errFd);
  const url='http://127.0.0.1:'+port;
  const api=(route,body)=>fetch(url+'/api/'+route,body===undefined?{}:{method:'POST',headers:{'X-EightMax':'1'},body:typeof body==='string'?body:JSON.stringify(body)});
  try{
    for(let i=0;;i++){try{if((await api('info')).ok)break;}catch{}if(i===150)throw Error('host startup failed');await pause(30);}
    await fn(api,url);
  }finally{if(proc.exitCode===null && proc.signalCode===null){const done=new Promise(r=>proc.once('exit',r));proc.kill();await done;}}
}
const home=t=>{const h=fs.mkdtempSync(path.join(os.tmpdir(),'em34-'));t.after(()=>fs.rmSync(h,{recursive:true,force:true}));return h;};
module.exports={withHost,home};
