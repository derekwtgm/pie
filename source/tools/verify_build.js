const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const dir=path.resolve(process.argv[2]), root=path.join(dir,'source');
const {build,files}=require('./fingerprint')(root);
const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'BUILD-INFO.json'))),{version,build,files});
for(const name of ['EightMax.exe','mwcli.exe']) {
  const bytes=fs.readFileSync(path.join(dir,name));
  assert.equal(bytes.toString('ascii',0,2),'MZ');
  assert.deepEqual(bytes.toString('latin1').match(/EightMaxBuild=[a-f0-9]{16}\x00/g),['EightMaxBuild='+build+'\0'],name);
}
assert.ok(fs.readFileSync(path.join(dir,'EightMax-Offline.html'),'utf8').includes('EM.BUILD = Object.freeze({version:"'+version+'",build:"'+build+'"})'));
console.log('Verified both executables, interface and source:',build);
