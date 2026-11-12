// Use one fresh process per operation. Record peak RSS including the live strategy.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const [tree,op,metaFile,raw,file,out]=process.argv.slice(2),src=path.resolve(tree,'source'),E=require(path.join(src,'tools/loadlib'));
for(const l of ['lib_runouts','lib_wide','lib_river'])require(path.join(src,'web',l));
if(!op.startsWith('old'))require(path.join(src,'web/lib_archive'));
(async()=>{
 const meta=JSON.parse(fs.readFileSync(metaFile));let g;
 if(op.endsWith('save')){g=E.MultiwayGame(meta.cfg);g.importNative(fs.readFileSync(raw),true);}
 const t=performance.now(),cpu=process.cpuUsage();
 if(op==='old-save')await fs.promises.writeFile(file,await E.encodeCheckpoint(g.snapshot(meta.labels)));
 else if(op==='new-save'){
  const a=g.archiveState(meta.labels),f=await fs.promises.open(file,'w');
  try{await E.archiveTo(a.meta,a.bytes.length,E.nativeBlocks(a.bytes),async b=>{let n=0;while(n<b.length){const r=await f.write(b,n,b.length-n);if(!r.bytesWritten)throw Error('Short write');n+=r.bytesWritten;}});}finally{await f.close();}
 }else if(op==='old-load')g=E.restoreCheckpoint(await E.decodeCheckpoint(fs.readFileSync(file,'utf8'))).game;
 else g=(await E.loadStudyFile(await fs.openAsBlob(file))).game;
 const seconds=(performance.now()-t)/1000,u=process.cpuUsage(cpu);
 const r={op,iterations:g.iterations,bytes:fs.statSync(file).size,wallSeconds:seconds,cpuSeconds:(u.user+u.system)/1e6,peakRSSKiB:process.resourceUsage().maxRSS};
 if(op.endsWith('load')){const sha=b=>crypto.createHash('sha256').update(b).digest('hex');r.stateSHA256=sha(g.exportNative(true));if(r.stateSHA256!==sha(fs.readFileSync(raw)))throw Error('State mismatch');}
 fs.writeFileSync(out,JSON.stringify(r,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
