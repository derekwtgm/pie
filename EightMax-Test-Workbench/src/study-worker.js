/* Runs inside a disposable Worker. Source libraries are prepended by tools/build.py. */
self.onmessage=function(event){
 const {id,request,mode}=event.data;
 try{
  const start=performance.now(),p=WorkbenchStudy.prepare(EM,request),C=WorkbenchCPUCheckpoint,inspect=mode==='inspect-cpu-checkpoint',resume=mode==='resume-study';
  if(request.cpuCheckpoint&&!resume&&!inspect)throw Error('Checkpoint state requires an explicit Open or Continue operation');
  if((resume||inspect)&&!request.cpuCheckpoint)throw Error('No CPU checkpoint was supplied');
  let from=0;if(resume||inspect){self.postMessage({id,kind:'progress',updates:0,memoryMiB:p.game.strategyMiB,phase:'restoring'});from=C.restore(p,request.cpuCheckpoint,request.reviewed||null);}
  let mapped=null;if(mode==='review-study'||mode==='native-review-job'||((resume||inspect)&&request.reviewed)){self.postMessage({id,kind:'progress',updates:p.game.iterations,memoryMiB:p.game.strategyMiB,phase:'mapping'});mapped=WorkbenchReviewed.replay(EM,p,request.reviewed);}
  if(mode==='native-job'||mode==='native-review-job'){self.postMessage({id,kind:'native-job',value:mapped?WorkbenchNative.reviewedJob(EM,p,mapped,id):WorkbenchStudy.nativeJob(p,id)});return;}
  const trainingStart=(resume||inspect||mapped)?performance.now():start;
  if(!inspect)while(p.game.iterations<p.options.iterations&&!p.game.limitReached&&performance.now()-trainingStart<p.options.timeMs){p.game.iterate(1);if(p.game.iterations%100===0)self.postMessage({id,kind:'progress',updates:p.game.iterations,memoryMiB:p.game.strategyMiB});}
  const value=WorkbenchStudy.result(EM,p,performance.now()-start);
  if(inspect)value.stopped='checkpoint-opened';
  if(mapped)value.reviewedNode=WorkbenchReviewed.query(EM,p,mapped);
  if(mode==='play-study')value.practice=WorkbenchPlay.play(EM,p,{seed:request.playSeed===undefined?771:request.playSeed});
  if(request.retainCPU||resume||inspect){value.cpuContinuation={version:1,operation:inspect?'inspect':resume?'resume':'fresh',fromUpdates:from,addedUpdates:p.game.iterations-from};
   try{value.cpuCheckpoint=inspect?request.cpuCheckpoint:C.capture(p,request.reviewed||null);}catch(e){value.cpuCheckpointError=e.message;}
  }
  value.elapsedMs=performance.now()-start;self.postMessage({id,kind:'result',value});
 }catch(error){self.postMessage({id,kind:'error',message:error.message});}
};
