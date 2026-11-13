#!/bin/sh
# Build the postflop WebAssembly cores (SIMD and scalar fallback) and embed them in src/lib_wasm.js.
set -e
cd "$(dirname "$0")/../wasm"
CC=${CC:-clang}
FLAGS="--target=wasm32 -O3 -ffast-math -mbulk-memory -nostdlib -ffreestanding -Wl,--no-entry -Wl,--export=__heap_base -Wl,-z,stack-size=1048576 -Wl,--max-memory=4294967296"
$CC $FLAGS -msimd128 -o pf_core_simd.wasm pf_core.c
$CC $FLAGS -o pf_core_scalar.wasm pf_core.c
node -e "
const fs = require('fs');
const a = fs.readFileSync('pf_core_simd.wasm').toString('base64'), b = fs.readFileSync('pf_core_scalar.wasm').toString('base64');
fs.writeFileSync('../web/lib_wasm.js', '(function (EM) {\n\'use strict\';\n// Postflop CFR core compiled from wasm/pf_core.c (SIMD build and scalar fallback).\nEM.PF_WASM_B64 = \'' + a + '\';\nEM.PF_WASM_SCALAR_B64 = \'' + b + '\';\n})(globalThis.EM || (globalThis.EM = {}));\n');
console.log('lib_wasm.js:', a.length + b.length, 'chars');
"
