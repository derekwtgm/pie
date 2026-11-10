const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const fingerprint=require('../tools/fingerprint');
test('native sources and compiler options alter the deterministic build ID',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'em-id-')),root=path.join(dir,'source');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const d of ['native','wasm','web','tools','../.github/workflows']) fs.mkdirSync(path.join(root,d),{recursive:true});
 fs.writeFileSync(path.join(root,'VERSION'),'3.0');
 for(const file of ['native/mw.cpp','native/p.hpp','native/p.cc','native/p.c','native/p.h','native/build.sh','web/worker.js']){
   const before=fingerprint(root).build,fn=path.join(root,file);
   fs.writeFileSync(fn,'first\n');const a=fingerprint(root).build;assert.notEqual(a,before);
   fs.writeFileSync(fn,'first\r\n');assert.equal(fingerprint(root).build,a);
   fs.writeFileSync(fn,'second\n');assert.notEqual(fingerprint(root).build,a);
 }
});
