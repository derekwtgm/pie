'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
require('../web/lib_deeplib');const E=globalThis.EM,old=E.DEEP_LIB;
function unpack(s){return s.replace(/\.(.)(.)/g,(_,ch,count)=>ch.repeat(old.alph.indexOf(count)+4));}
const rows=old.depths.map(S=>{
 const gen=JSON.parse(fs.readFileSync(path.join(process.argv[2],'deeplib_'+S+'.json')));
 assert.equal(gen.anteType,'classic');assert.equal(gen.ante,0.1);
 const a=unpack(old.data[S]),b=unpack(gen.data);assert.equal(a.length,b.length);assert.equal(b.length,gen.raw);
 let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;
 return {S,iterations:gen.it,packedStrategyValues:b.length,changed,originalReportedGap:old.meta[S].ex,regeneratedReportedGap:gen.exq,sha256:crypto.createHash('sha256').update(b).digest('hex')};
});
fs.writeFileSync(process.argv[3],JSON.stringify({rows,note:'Independent rerun of the shipped chart generator with its existing fitted continuation-value model. This tests chart reproducibility. It does not refit the coefficients or establish full-game equilibrium.'},null,2));
