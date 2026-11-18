'use strict';
/* A local, offline AUTHORIZED-QA test client: serves the controlled poker table over HTTP so Authorized QA Mode can be exercised
 * end to end. Loopback only, bearer token required, idempotent revision-bound actions. It is a stand-in for an operator-owned
 * test client; it is not a model of any commercial poker site. Usage: node tools/qa-test-server.cjs [--port=48800] [--seed=1] [--token=...] */
const http = require('node:http'), crypto = require('node:crypto');
const EM = require('../src/engine.js'), SIM = require('../src/sim-display.js'), IC = require('../src/image-codec.js');

function startQaServer(options = {}) {
  const table = options.table || new EM.Table(1, options.seed || 1), token = options.token || crypto.randomBytes(16).toString('hex'), width = options.width || 960;
  const seen = new Map(); let lastView = 0, frameId = 0, actions = 0; const stats = { frames: 0, actions: 0, duplicates: 0, rejected: 0, unauthorized: 0 };
  const faults = options.faults || {};
  const server = http.createServer((req, res) => {
    const send = (code, body) => { const b = JSON.stringify(body); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
    const auth = req.headers.authorization || '', a = Buffer.from(auth), b = Buffer.from('Bearer ' + token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { stats.unauthorized++; return send(401, { ok: false, reason: 'Bad or missing bearer token' }); }
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      let body = {}; try { if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(400, { ok: false, reason: 'Invalid JSON' }); }
      try {
        if (req.method === 'GET' && req.url === '/v1/health') return send(200, { ok: true, kind: 'eightmax-qa-test-client', version: 1, table: table.id });
        if (req.method === 'GET' && req.url === '/v1/frame') {
          if (faults.dropFrames > 0) { faults.dropFrames--; return send(503, { ok: false, reason: 'Injected frame outage' }); }
          if (table.actor >= 0 && table.status === 'playing') lastView = table.actor; stats.frames++;
          const img = SIM.renderTable(table, width, { v2: true, heroSeat: lastView, seed: ++frameId });
          return send(200, { ok: true, frameId, viewSeat: lastView, revision: table.revision, hand: table.hand, width: img.width, height: img.height, png: IC.encodePng(img).toString('base64') });
        }
        if (req.method === 'POST' && req.url === '/v1/new-hand') { if (table.status === 'playing') return send(409, { ok: false, reason: 'A hand is in progress' }); table.startHand(); return send(200, { ok: true, hand: table.hand, revision: table.revision }); }
        if (req.method === 'POST' && req.url === '/v1/action') {
          const key = body.idempotencyKey; if (typeof key !== 'string' || key.length < 4) return send(400, { accepted: false, reason: 'idempotencyKey required' });
          if (seen.has(key)) { stats.duplicates++; return send(200, { ...seen.get(key), duplicate: true }); }
          if (faults.dropAck > 0) { faults.dropAck--; /* apply but never answer: the client must treat this as unconfirmed */ }
          let out;
          if (body.hand !== table.hand) out = { accepted: false, reason: 'Wrong hand', revision: table.revision };
          else if (body.revision !== undefined && body.revision !== table.revision) out = { accepted: false, reason: 'Stale revision ' + body.revision + ' (table is at ' + table.revision + ')', revision: table.revision };
          else if (body.actor !== undefined && body.actor !== table.actor) out = { accepted: false, reason: 'Not that player\'s turn', revision: table.revision };
          else {
            const type = body.action === 'allin' || body.action === 'bet' ? 'raise' : body.action;
            try { table.execute(table.request(type, body.amount || 0, 0), 0); actions++; stats.actions++; out = { accepted: true, revision: table.revision }; } catch (e) { out = { accepted: false, reason: e.message, revision: table.revision }; }
          }
          if (!out.accepted) stats.rejected++;
          seen.set(key, out); if (seen.size > 5000) seen.delete(seen.keys().next().value);
          if (faults.dropAckApplied) { faults.dropAckApplied--; return req.socket.destroy(); }
          return send(out.accepted ? 200 : 409, out);
        }
        return send(404, { ok: false, reason: 'Unknown route' });
      } catch (e) { return send(500, { ok: false, reason: e.message }); }
    });
  });
  return new Promise((resolve) => server.listen(options.port || 0, '127.0.0.1', () => resolve({ server, table, token, stats, faults, port: server.address().port, url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) })));
}
module.exports = { startQaServer };
if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  startQaServer({ port: +(args.port || 48800), seed: +(args.seed || 1), token: args.token }).then((s) => console.log('QA test client on ' + s.url + '  token ' + s.token));
}
