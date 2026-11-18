/* Fixed-layout, labeled-template recognition for user-loaded images. No client access. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkbenchVision=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';const W=24,H=32,LIMIT=128,ok=(x,m)=>{if(!x)throw Error(m);};
function label(kind,value){ok(typeof value==='string','Missing template label');if(kind==='card')ok(/^[2-9TJQKA][cdhs]$/.test(value),'Use a card such as As or Td');else if(kind==='amount')ok(/^\d{1,6}(\.\d{1,2})?$/.test(value),'Use a plain amount such as 12.50');else throw Error('Choose card or amount');return value;}
function rect(r){ok(r&&['x','y','w','h'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))&&r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=1.0000001&&r.y+r.h<=1.0000001,'Region must fit inside the image');return {x:r.x,y:r.y,w:r.w,h:r.h};}
function normalize(image,box){
 rect(box);ok(image&&Number.isInteger(image.width)&&Number.isInteger(image.height)&&image.width>0&&image.height>0&&image.width*image.height<=20000000&&image.data&&image.data.length===image.width*image.height*4,'Invalid image');
 const out=new Array(W*H);let low=1,high=0;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const px=Math.min(image.width-1,Math.floor((box.x+(x+.5)*box.w/W)*image.width)),py=Math.min(image.height-1,Math.floor((box.y+(y+.5)*box.h/H)*image.height)),i=(py*image.width+px)*4;const value=(.2126*image.data[i]+.7152*image.data[i+1]+.0722*image.data[i+2])/255;out[y*W+x]=value;low=Math.min(low,value);high=Math.max(high,value);}
 const contrast=high-low;return {pixels:out.map(x=>contrast>.05?(x-low)/contrast:0),contrast};
}
class Calibration {
 constructor(){this.regions=[];this.templates=[];}
 setRegion(table,field,kind,box,aspect){ok(Number.isInteger(table)&&table>=1&&table<=10,'Use table 1 to 10');ok(typeof field==='string'&&/^[a-z][a-z0-9_]{0,39}$/.test(field),'Field name: lowercase letters, digits and underscores');ok(['card','amount'].includes(kind),'Choose a field type');ok(Number.isFinite(aspect)&&aspect>0&&aspect<20,'Invalid image aspect');const region={table,field,kind,box:rect(box),aspect};const index=this.regions.findIndex(r=>r.table===table&&r.field===field);if(index>=0)this.regions[index]=region;else{ok(this.regions.filter(r=>r.table===table).length<32,'At most 32 regions per table');this.regions.push(region);}return region;}
 addTemplate(kind,value,normalized){label(kind,value);ok(normalized&&normalized.contrast>.05,'Reference region has too little contrast');ok(Array.isArray(normalized.pixels)&&normalized.pixels.length===W*H&&normalized.pixels.every(v=>Number.isFinite(v)&&v>=0&&v<=1),'Invalid reference pixels');ok(this.templates.length<LIMIT,'At most 128 reference samples');this.templates.push({kind,label:value,pixels:normalized.pixels.slice()});}
 classify(kind,normalized){
  if(normalized.contrast<=.05)return {accepted:false,label:null,score:0,margin:0,reason:'Region has too little contrast'};
  const byLabel=new Map();for(const t of this.templates.filter(t=>t.kind===kind)){const mse=t.pixels.reduce((sum,p,i)=>sum+(p-normalized.pixels[i])**2,0)/(W*H),score=Math.max(0,1-Math.sqrt(mse));byLabel.set(t.label,Math.max(byLabel.get(t.label)||0,score));}
  const ranked=Array.from(byLabel,([label,score])=>({label,score})).sort((a,b)=>b.score-a.score);if(!ranked.length)return {accepted:false,label:null,score:0,margin:0,reason:'No reference templates'};
  // One label provides no competing class: it cannot establish discrimination.
  const best=ranked[0],margin=ranked.length>1?best.score-ranked[1].score:0,accepted=ranked.length>1&&best.score>=.92&&margin>=.04;
  return {...best,accepted,margin,reason:accepted?'Template match; score is not a calibrated probability':ranked.length<2?'Add a second distinct label before recognition':best.score<.92?'Low template similarity':'Ambiguous templates'};
 }
 read(image,table){const aspect=image.width/image.height;const rows=this.regions.filter(r=>r.table===table).map(r=>{if(Math.abs(aspect/r.aspect-1)>.03)return {field:r.field,accepted:false,label:null,score:0,margin:0,reason:'Image layout aspect differs from calibration'};return {field:r.field,kind:r.kind,...this.classify(r.kind,normalize(image,r.box))};});const counts=new Map();rows.filter(r=>r.accepted&&r.kind==='card').forEach(r=>counts.set(r.label,(counts.get(r.label)||0)+1));rows.forEach(r=>{if(r.kind==='card'&&r.accepted&&counts.get(r.label)>1){r.accepted=false;r.reason='Duplicate visible card across calibrated fields';}});return rows;}
 export(){return {format:'eightmax-image-calibration',version:1,width:W,height:H,regions:this.regions,templates:this.templates};}
 static load(text){ok(typeof text==='string'&&text.length<=4000000,'Calibration exceeds 4 MB');const x=JSON.parse(text);ok(x&&x.format==='eightmax-image-calibration'&&x.version===1&&x.width===W&&x.height===H&&Array.isArray(x.regions)&&x.regions.length<=320&&Array.isArray(x.templates)&&x.templates.length<=LIMIT,'Unsupported calibration');const c=new Calibration();for(const r of x.regions)c.setRegion(r.table,r.field,r.kind,r.box,r.aspect);ok(c.regions.length===x.regions.length,'Duplicate calibration region');for(const t of x.templates)c.addTemplate(t.kind,t.label,{pixels:t.pixels,contrast:1});return c;}
}
return {Calibration,normalize,W,H};
});
