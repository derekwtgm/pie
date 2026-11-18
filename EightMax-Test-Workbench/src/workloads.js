/* In-page compute ownership; not a process RAM meter or an OS scheduler. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkbenchWorkloads=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const LABELS={study:'CPU studies',native:'managed native study',benchmark:'capacity test',diagnostics:'browser checks',images:'image validation',batch:'native batch'};
class Workloads {
 constructor(notify=()=>{}){this.entries=new Map();this.serial=0;this.notify=notify;}
 _emit(){try{this.notify(this.snapshot());}catch(e){/* Display failure cannot revoke compute ownership. */}}
 check(kind,ignore=[]){if(!Object.hasOwn(LABELS,kind)||!Array.isArray(ignore))throw Error('Unknown compute workflow');for(const e of this.entries.values())if(!ignore.includes(e.kind)&&!(kind==='study'&&e.kind==='study'))throw Error('Stop '+(['study','images','diagnostics'].includes(e.kind)?'':'the ')+LABELS[e.kind]+' before starting '+LABELS[kind]);return true;}
 acquire(kind,slot=null,phase='Preparing'){
  this.check(kind);if(kind==='study'||kind==='native'){if(!Number.isInteger(slot)||slot<1||slot>10)throw Error('Compute study slot must be 1 to 10');}else if(slot!==null)throw Error('This compute workflow has no study slot');
  if(typeof phase!=='string'||phase.length>160)throw Error('Invalid compute phase');
  // Replacing the same browser slot is followed synchronously by queue cancellation.
  if(kind==='study')for(const [id,e] of this.entries)if(e.kind===kind&&e.slot===slot)this.entries.delete(id);
  const lease=Object.freeze({id:++this.serial});this.entries.set(lease.id,{lease,kind,slot,phase});this._emit();return lease;
 }
 owns(lease){return !!lease&&this.entries.get(lease.id)?.lease===lease;}
 update(lease,phase){if(!this.owns(lease))return false;if(typeof phase!=='string'||phase.length>160)throw Error('Invalid compute phase');this.entries.get(lease.id).phase=phase;this._emit();return true;}
 release(lease){if(!this.owns(lease))return false;this.entries.delete(lease.id);this._emit();return true;}
 clear(kind,slot=null){let removed=0;for(const [id,e] of this.entries)if(e.kind===kind&&(slot===null||e.slot===slot)){this.entries.delete(id);removed++;}if(removed)this._emit();return removed;}
 snapshot(){return Array.from(this.entries.values(),e=>({kind:e.kind,label:LABELS[e.kind],slot:e.slot,phase:e.phase}));}
}
return {Workloads,LABELS};
});
