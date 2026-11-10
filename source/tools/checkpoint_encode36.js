// Stream an existing EMMW4 file through the same encoder used by the desktop worker.
const fs=require('node:fs'),{performance}=require('node:perf_hooks');
const E=require('./loadlib');require('../web/lib_archive');
(async()=>{const [metadata,src,dest]=process.argv.slice(2),meta=JSON.parse(fs.readFileSync(metadata)),file=await fs.promises.open(src),out=await fs.promises.open(dest,'w');
  try{const total=(await file.stat()).size,pre=Buffer.alloc(12);await file.read(pre,0,12,0);
    const header=Buffer.alloc(pre.readUInt32LE(8));await file.read(header,0,header.length,12);meta.state.iterations=JSON.parse(header).iterations;
    async function* chunks(){for(let pos=0;pos<total;){const size=Math.min(E.archiveBlockSize,total-pos),b=Buffer.allocUnsafe(size);
      const {bytesRead}=await file.read(b,0,size,pos);if(bytesRead!==size)throw Error('Truncated input');pos+=size;yield b;}}
    const start=performance.now(),cpu=process.cpuUsage();await E.archiveTo(meta,total,chunks(),async b=>{let offset=0;while(offset<b.length){const {bytesWritten}=await out.write(b,offset,b.length-offset);if(!bytesWritten)throw Error('Short write');offset+=bytesWritten;}});
    const usage=process.cpuUsage(cpu);console.log(JSON.stringify({rawBytes:total,archiveBytes:(await out.stat()).size,milliseconds:performance.now()-start,cpuMilliseconds:(usage.user+usage.system)/1000,peakRssKiB:process.resourceUsage().maxRSS,iterations:meta.state.iterations}));
  }finally{await out.close();await file.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
