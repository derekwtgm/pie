// pfeq.bin (W[169*169] f64, T[169*169] f64, N[169*169] i32) -> half-matrix Uint16 base64 module
const fs = require('fs');
const path = require('path');
const web = path.resolve(__dirname, '../web');
const buf = fs.readFileSync(process.argv[2] || path.join(__dirname, 'pfeq.bin'));
const NC = 169;
const W = new Float64Array(buf.buffer, buf.byteOffset, NC * NC);
const T = new Float64Array(buf.buffer, buf.byteOffset + 8 * NC * NC, NC * NC);
const out = [];
for (let a = 0; a < NC; a++) for (let b = a; b < NC; b++) {
  out.push(Math.round(W[a * NC + b] * 65535), Math.round(T[a * NC + b] * 65535));
}
const u16 = Uint16Array.from(out);
const b64 = Buffer.from(u16.buffer).toString('base64');
fs.writeFileSync(path.join(web, 'lib_eqdata.js'),
  "(function (EM) {\n'use strict';\n// Exhaustive preflop all-in equities by hand class (half matrix, W and T interleaved, x/65535).\nEM.EQ_B64 = '" + b64 + "';\n})(globalThis.EM || (globalThis.EM = {}));\n");
console.log('entries', u16.length, 'b64 bytes', b64.length);
