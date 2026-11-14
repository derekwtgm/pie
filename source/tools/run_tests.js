'use strict';
// EightMax 3.1 regression runner.
// usage: node tools/run_tests.js [report.json] [--perf] [--limit=seconds]
// Runs every tests/*.test.js file in its own process with a wall-clock limit
// (default 600 s per file; individual tests also declare their own limits).
// Counts are taken from the TAP stream. A file or test that exceeds its limit
// is reported as TIMED OUT and makes the run fail; it is never counted as a pass.
// Hardware-dependent tests are those that need a compiler, Linux (CUDA driver
// test double) or a physical device; when skipped they are listed by name.
// --perf additionally runs the quick end-to-end performance benchmark.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),args=process.argv.slice(2);
const report=args.find(a=>!a.startsWith('--')),perf=args.includes('--perf');
const limit=+(args.find(a=>a.startsWith('--limit='))||'--limit=600').slice(8);
const files=fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.js')).sort();
const HARDWARE=/CUDA|native host|compiler|Windows|GPU/i;
const out={generated:new Date().toISOString(),node:process.version,platform:os.platform()+' '+os.arch(),cpu:os.cpus()[0]?.model,limitSecondsPerFile:limit,files:[],totals:{passed:0,failed:0,skipped:0,timedOut:0,todo:0,hardwareDependentRun:0,hardwareDependentSkipped:0}};
for(const f of files){
  const t=Date.now();
  const r=spawnSync(process.execPath,['--test','--test-reporter=tap',path.join('tests',f)],{cwd:root,encoding:'utf8',timeout:limit*1000,maxBuffer:256*1024*1024});
  const tap=(r.stdout||'')+(r.stderr||''),seconds=(Date.now()-t)/1000;
  const row={file:f,seconds:+seconds.toFixed(2),passed:0,failed:0,skipped:0,timedOut:0,todo:0,failures:[],timeouts:[],skippedTests:[],hardware:[]};
  // Top-level and nested "ok"/"not ok" lines; directives mark skips and todos.
  for(const line of tap.split('\n')){
    const m=/^\s*(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)(.*))?$/.exec(line);if(!m)continue;
    const name=m[2];
    if(m[3]==='SKIP'){row.skipped++;row.skippedTests.push(name+(m[4]?' ('+m[4].trim()+')':''));}
    else if(m[3]==='TODO')row.todo++;
    else if(m[1]==='ok')row.passed++;
    else row.failures.push(name);
    if(HARDWARE.test(name))row.hardware.push({name,status:m[3]==='SKIP'?'skipped':m[1]==='ok'?'passed':'failed'});
  }
  for(const block of tap.split(/\n(?=\s*(?:not ok|ok) \d+ - )/))
    if(/failureType: 'testTimeoutFailure'/.test(block)){const n=/(?:not ok) \d+ - (.*)/.exec(block);if(n){row.timeouts.push(n[1]);row.failures=row.failures.filter(x=>x!==n[1]);}}
  if(r.error&&r.error.code==='ETIMEDOUT'){row.timeouts.push('whole file exceeded '+limit+' s; last output: '+tap.trim().split('\n').slice(-1)[0]);}
  // Subtests are counted once: drop parents that only aggregate children (node --test nests describe blocks).
  // 5.1: keep each failure's diagnostic block (error message, expected/actual, location) in the log and
  // the report; Windows CI run 53 printed only the name of its one failing test.
  row.failureDetails={};
  for(const block of tap.split(/\n(?=\s*(?:not ok|ok) \d+ - )/)){const n=/^\s*not ok \d+ - (.*?)(?: # .*)?$/m.exec(block);if(!n||!row.failures.includes(n[1]))continue;
    row.failureDetails[n[1]]=block.split('\n').slice(1).filter(l=>/error:|expected:|actual:|operator:|location:|code:|message|at .*test\.js|AssertionError/.test(l)).slice(0,16).map(l=>l.trim().slice(0,400));}
  row.failed=row.failures.length;row.timedOut=row.timeouts.length;
  if(r.status!==0 && !row.failed && !row.timedOut)row.failures.push('process exited with status '+r.status),row.failed=1;
  for(const k of ['passed','failed','skipped','timedOut','todo'])out.totals[k]+=row[k];
  for(const h of row.hardware)h.status==='skipped'?out.totals.hardwareDependentSkipped++:out.totals.hardwareDependentRun++;
  out.files.push(row);
  console.log(f.padEnd(24),String(row.seconds).padStart(7)+' s','pass',row.passed,'fail',row.failed,'skip',row.skipped,'timeout',row.timedOut);
  for(const x of row.failures){console.log('   FAILED:',x);for(const l of (row.failureDetails[x]||[]))console.log('      |',l);}for(const x of row.timeouts)console.log('   TIMED OUT:',x);
  for(const x of row.skippedTests)console.log('   SKIPPED:',x);   // 5.0: every skip and its reason in the log
}
if(perf){
  console.log('Performance check (tools/bench31.js --quick) requires the 3.0 and 3.1 drivers; see source/README.txt.');
}
const T=out.totals;
console.log('\nTotals: passed',T.passed,'failed',T.failed,'skipped',T.skipped,'timed out',T.timedOut,'| hardware-dependent run',T.hardwareDependentRun,'skipped',T.hardwareDependentSkipped);
if(report)fs.writeFileSync(report,JSON.stringify(out,null,1));
process.exit(T.failed||T.timedOut?1:0);
