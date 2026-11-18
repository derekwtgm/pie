/* Deterministic pixel patterns for exercising evaluation, not client-card training. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./vision.js'));
 else root.WorkbenchImageValidationDemo=factory(root.WorkbenchVision);
})(typeof globalThis!=='undefined'?globalThis:this,function(V){
'use strict';
function image(code=0,noisy=false,blank=false){
 const width=V.W*2,height=V.H,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const xx=x%V.W,right=x>=V.W,bit=(right?(xx*5+y*3)%13<6:(xx*7+y*5)%11<5)!==(code===1);
  const value=blank?128:bit?(noisy?249+(xx*3+y)%7:255):(noisy?(xx+y)%7:0),i=(y*width+x)*4;
  data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
 }
 return {width,height,data};
}
function create(){
 const calibration=new V.Calibration(),cardBox={x:0,y:0,w:.5,h:1},amountBox={x:.5,y:0,w:.5,h:1};
 calibration.setRegion(1,'hero_1','card',cardBox,1.5);calibration.setRegion(1,'pot','amount',amountBox,1.5);
 for(let code=0;code<2;code++){
  const img=image(code);calibration.addTemplate('card',code?'Kd':'As',V.normalize(img,cardBox));
  calibration.addTemplate('amount',code?'200':'100',V.normalize(img,amountBox));
 }
 const definitions=[['match-a.png',image(0,true),'As','100'],['match-b.png',image(1,true),'Kd','200'],
  ['blank.png',image(0,false,true),null,null],['intentional-wrong.png',image(0,true),'Kd','200'],
  ['must-reject.png',image(0,true),null,null],['reference-overlap.png',image(0),'As','100']];
 const images=new Map(definitions.map(([name,img])=>[name,img]));
 const dataset={format:'eightmax-image-dataset',version:1,source:'synthetic',name:'Synthetic evaluation pipeline — deliberate errors included',
  cases:definitions.map(([name,,card,amount],i)=>({id:'pattern-'+i,image:name,table:1,fields:[
   {field:'hero_1',kind:'card',expected:card},{field:'pot',kind:'amount',expected:amount}]}))};
 const files=definitions.map(([name,img])=>({name,type:'image/png',size:img.data.length}));
 return {dataset,calibration,files,images};
}
return {create,image};
});
