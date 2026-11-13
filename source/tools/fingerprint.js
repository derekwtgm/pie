'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fingerprint(root) {
  const files = ['VERSION'];
  function visit(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes:true})) {
      const name = dir + '/' + entry.name;
      if (entry.isDirectory()) visit(name);
      else if (/\.(?:js|mjs|cjs|ts|c|cc|cpp|cxx|h|hh|hpp|cu|cuh|cl|py|sh|ps1|css|html|cmake|json|yml|yaml)$|(?:^|\/)(?:CMakeLists\.txt|Makefile)$/i.test(name)) files.push(name);
    }
  }
  for (const dir of ['native','web','wasm','tools','../.github/workflows']) visit(dir);
  const kernel=path.join(root,'native/score.cu');
  if(fs.existsSync(kernel)){
    const sha=crypto.createHash('sha256').update(fs.readFileSync(kernel,'utf8').replace(/\r\n/g,'\n')).digest('hex');
    if(!fs.readFileSync(path.join(root,'native/score_ptx.hpp'),'utf8').startsWith('// score.cu SHA256 '+sha+'\n') &&
       !fs.readFileSync(path.join(root,'native/score_ptx.hpp'),'utf8').startsWith('// score.cu SHA256 '+sha+'\r\n')) throw Error('Regenerate score_ptx.hpp with gen_ptx.py');
  }
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) {
    const bytes = Buffer.from(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n'));
    hash.update(file+'\0'+bytes.length+'\0'); hash.update(bytes);
  }
  return {build:hash.digest('hex').slice(0,16),files};
}
module.exports = fingerprint;
