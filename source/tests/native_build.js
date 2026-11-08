'use strict';
// Shared native build for the regression suites (3.1). node --test runs test
// files in parallel processes; each used to compile the same C++ sources. The
// binaries are now built once per source fingerprint into the OS temp directory
// and published with an atomic rename, so concurrent suites reuse one build.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const crypto=require('node:crypto');
const native=path.join(__dirname,'../native');
function fingerprint(){
  const h=crypto.createHash('sha256');
  for(const f of fs.readdirSync(native).sort())if(/\.(c|cpp|h|hpp|cu|cl|py|sh)$/.test(f))h.update(f).update(fs.readFileSync(path.join(native,f)));
  for(const f of ['tests/cuda_driver_fixture.cpp','tools/timed_training.cpp'])h.update(f).update(fs.readFileSync(path.join(__dirname,'..',f)));
  return h.digest('hex').slice(0,16);
}
function publish(dir,make){
  if(fs.existsSync(path.join(dir,'.complete')))return dir;
  const work=fs.mkdtempSync(dir+'-work-');
  try{make(work);fs.writeFileSync(path.join(work,'.complete'),'');try{fs.renameSync(work,dir);}catch(e){if(!fs.existsSync(path.join(dir,'.complete')))throw e;}}
  finally{fs.rmSync(work,{recursive:true,force:true});}
  return dir;
}
let cached=null;
function cli(){
  if(cached)return cached;
  // EM_TEST_MWCLI runs the suites against another build (for example a sanitizer build);
  // the CUDA test double still comes from the cache.
  try{
    const dir=publish(path.join(os.tmpdir(),'eightmax-native-'+fingerprint()),work=>{
      execFileSync('gcc',['-O2','-c',path.join(native,'json.c'),'-o',path.join(work,'json.o')]);
      execFileSync('g++',['-std=c++20','-O2','-ffp-contract=off','-I'+native,path.join(native,'mw.cpp'),path.join(native,'mwcli.cpp'),path.join(work,'json.o'),'-lpthread','-ldl','-o',path.join(work,'mwcli')]);
      if(process.platform==='linux')execFileSync('g++',['-std=c++20','-O2','-shared','-fPIC',path.join(__dirname,'cuda_driver_fixture.cpp'),'-o',path.join(work,'libcuda.so.1')]);
    });
    cached={cli:process.env.EM_TEST_MWCLI||path.join(dir,'mwcli'),fixtureDir:dir,why:''};
  }catch(e){cached={cli:null,why:'C/C++ compiler unavailable: '+String(e.message).split('\n')[0]};}
  return cached;
}
// UI bundle + Linux desktop host, keyed by the release build fingerprint
// (tools/fingerprint.js covers every source file the host embeds).
let hostCached=null;
function host(){
  if(hostCached)return hostCached;
  const id=require('../tools/fingerprint.js')(path.join(__dirname,'..')).build;
  const dir=publish(path.join(os.tmpdir(),'eightmax-host-'+id),work=>{
    execFileSync(process.execPath,[path.join(__dirname,'../tools/build.js'),work],{stdio:'ignore'});
    execFileSync('sh',[path.join(native,'build.sh'),'linux',path.join(work,'native.html'),path.join(work,'linux')],{stdio:'ignore'});
  });
  return hostCached={dir,exe:path.join(dir,'linux','eightmax')};
}
module.exports={cli,host,fingerprint};
