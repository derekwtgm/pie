(function(){
'use strict';const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){const rows=window.workbenchWorkloads.snapshot(),native=window.workbenchNativeActivity?.();
 if(native&&!rows.some(r=>r.kind==='native'||r.kind==='batch'))rows.push({label:native.label||'Managed native study',slot:native.slot,phase:native.message});
 $('compute-activity-status').textContent=rows.length?'Compute activity: '+rows.length+' active or queued workflow'+(rows.length===1?'':'s')+'.':'No managed compute workflow is active in this dashboard.';
 $('compute-activity-list').innerHTML=rows.map(r=>'<li>'+esc(r.label)+(r.slot?' · slot '+r.slot:'')+' · '+esc(r.phase)+'</li>').join('');
}
window.workbenchWorkloads=new window.WorkbenchWorkloads.Workloads(render);window.renderWorkbenchWorkloads=render;render();setInterval(render,1000);
})();
