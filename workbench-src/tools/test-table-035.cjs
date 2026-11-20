#!/usr/bin/env node
'use strict';
/* EightMax Test Workbench 0.35.0: run the CONTROLLED WINDOWS TEST TABLES (fixture) - one dealer process, N table windows.
 *
 *   node tools/test-table-035.cjs --tables 2 [--width 960] [--layout cascade|grid|stack] [--convention raise-to|raise-by]
 *        [--oracle-dir DIR] [--seed 7] [--hand-gap 600] [--turn-delay 0] [--exe desktop/bin/EightMaxTestTable.exe]
 *   --turn-delay: after each action the table shows no controls for this long (the other players 'think'), so a table needs
 *   input only on its own turn - the realistic multi-table load. 0 = every frame needs an action (maximum load).
 *
 * Prints one JSON line {"type":"ready","tables":[{table,hwnd,pid,client,controls}]} when every window is up, then serves JSON
 * commands on stdin (one per line, replies on stdout):
 *   {"cmd":"move","table":1,"x":..,"y":..,"w":..}   {"cmd":"minimize"|"restore"|"activate"|"close"|"describe","table":1}
 *   {"cmd":"summary"}  -> oracle summaries of every table      {"cmd":"stop"} -> close all windows and exit
 * The oracle (oracle-table-NN.jsonl) is written continuously to --oracle-dir. This process is the "simulator": the Workbench
 * never reads its state; acceptance tools read the oracle only after actions, to grade them.
 */
const path = require('path'), fs = require('fs'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const FD = require(path.join(ROOT, 'src', 'fixture-dealer.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
const N = Math.max(1, Math.min(10, Number(arg('tables', '1')))), W = Number(arg('width', '960')), layout = arg('layout', 'cascade'), convention = arg('convention', 'raise-to');
const oracleDir = arg('oracle-dir', null), seed = Number(arg('seed', '7')), gap = Number(arg('hand-gap', '600')), exe = arg('exe', path.join(ROOT, 'desktop', 'bin', 'EightMaxTestTable.exe'));
const screenW = Number(arg('screen-width', '1920')), screenH = Number(arg('screen-height', '1080')), turnDelay = Number(arg('turn-delay', '0'));
if (oracleDir) fs.mkdirSync(oracleDir, { recursive: true });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

function position(i) {
  const h = Math.round(W / 1.6);
  if (layout === 'grid') { const cols = Math.max(1, Math.floor(screenW / (W + 16))), rows = Math.max(1, Math.floor((screenH - 40) / (h + 40))); const k = i % (cols * rows); return { x: 8 + (k % cols) * (W + 16), y: 8 + Math.floor(k / cols) * (h + 40) }; }
  if (layout === 'stack') return { x: 40, y: 40 };
  return { x: 20 + i * 36, y: 10 + i * 28 };   // cascade: every title bar stays visible
}
const tables = [];
for (let i = 0; i < N; i++) {
  const id = i + 1, pos = position(i), oracle = oracleDir ? fs.openSync(path.join(oracleDir, 'oracle-table-' + String(id).padStart(2, '0') + '.jsonl'), 'w') : null;
  const child = cp.spawn(exe, ['--table', String(id), '--x', String(pos.x), '--y', String(pos.y), '--width', String(W)], { stdio: ['pipe', 'pipe', 'inherit'] });
  const rec = { id, child, ready: null, dealer: null, buf: '' };
  rec.dealer = new FD.TableDealer({ table: id, seed: seed * 1000 + id, convention, handGapMs: gap, turnDelayMs: turnDelay, send: (m) => { try { child.stdin.write(JSON.stringify(m) + '\n'); } catch (e) { /* window gone */ } },
    record: (e) => { if (oracle !== null) fs.writeSync(oracle, JSON.stringify({ t: Date.now(), table: id, ...e }) + '\n'); } });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { rec.buf += d; let k; while ((k = rec.buf.indexOf('\n')) >= 0) { const line = rec.buf.slice(0, k); rec.buf = rec.buf.slice(k + 1); let m; try { m = JSON.parse(line); } catch (e) { continue; }
    if (m.type === 'ready') { rec.ready = m; checkReady(); } if (m.type === 'describe') out({ type: 'describe', table: id, ...m }); rec.dealer.onWindow(m); } });
  child.on('exit', (code) => { rec.exited = code; rec.dealer.closed = true; out({ type: 'exited', table: id, code }); if (tables.every((t) => t.exited !== undefined)) process.exit(0); });
  tables.push(rec);
}
let announced = false;
function checkReady() { if (announced || !tables.every((t) => t.ready)) return; announced = true; out({ type: 'ready', exe, convention, tables: tables.map((t) => ({ table: t.id, hwnd: t.ready.hwnd, pid: t.ready.pid, client: t.ready.client, controls: t.ready.controls, dpi: t.ready.dpi })) }); }
setTimeout(() => { if (!announced) { out({ type: 'error', error: 'windows not ready within 30 s', ready: tables.filter((t) => t.ready).length }); } }, 30000);

let ibuf = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { ibuf += d; let k; while ((k = ibuf.indexOf('\n')) >= 0) { const line = ibuf.slice(0, k); ibuf = ibuf.slice(k + 1); let m; try { m = JSON.parse(line); } catch (e) { continue; } handle(m); } });
process.stdin.on('end', stop);
function handle(m) {
  if (m.cmd === 'summary') return out({ type: 'summary', id: m.id, tables: tables.map((t) => t.dealer.summary()) });
  if (m.cmd === 'stop') return stop();
  const t = tables.find((x) => x.id === m.table); if (!t) return out({ type: 'error', id: m.id, error: 'no table ' + m.table });
  if (['move', 'minimize', 'restore', 'activate', 'close', 'describe'].includes(m.cmd)) { t.dealer.send({ type: m.cmd, x: m.x, y: m.y, w: m.w }); return out({ type: 'done', id: m.id, cmd: m.cmd, table: m.table }); }
  out({ type: 'error', id: m.id, error: 'unknown command' });
}
function stop() { for (const t of tables) { try { t.dealer.send({ type: 'close' }); t.child.stdin.end(); } catch (e) { /* gone */ } } setTimeout(() => { for (const t of tables) { try { t.child.kill(); } catch (e) { /* gone */ } } process.exit(0); }, 3000).unref(); }
