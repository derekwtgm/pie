// EightMax 4.8: shared study games for the 4.8 convergence, response-evaluation and
// benchmark tools. The first six are the 4.4-4.7 study games, unchanged (same keys, same
// options) so 4.8 results are comparable with the 4.7 study. The others are added in 4.8 for
// Priorities 1, 4 and 14 (four-player turn, five-player flop, a weighted six-player flop with two
// bet sizes, an eight-player final table with weighted ranges). Every game is small enough for an
// EXACT unilateral best response of every seat inside its abstraction (mwcli --gain method=exact).
//
//   node tools/games48.js list
//   node tools/games48.js spec <key> <out.json> [seed] [extra-json]
'use strict';
const path = require('node:path'), fs = require('node:fs');
const E = require('./loadlib'); for (const l of ['lib_runouts', 'lib_wide', 'lib_river']) require('../web/' + l);
const base = { privateMode: 'sampled', abstraction: 'exact', traversal: 'external', evaluationDeals: 128 };
// [key, description, options, checkpoints (sampled deals), two-player zero-sum]
const games = [
  ['hu-river', 'Heads-up river, chip EV', { board: 'Ks8d5h2c2s', common: 10, stacks: [20, 20], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd'], streets: { river: { bets: '50,a', raises: 'a', maxBets: 2 } } },
    [4000, 20000, 50000, 100000, 250000, 500000], true],
  ['hu-turn', 'Heads-up turn and river, chip EV', { board: 'Ks8d5h2c', common: 8, stacks: [12, 12], ranges: ['AhKh,KdQd,8s8h,JsTs', 'AsKd,5d5c,8h7h,JdTd'], streets: { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } } },
    [4000, 20000, 50000, 100000, 250000, 500000], true],
  ['river3-chip', 'Three-player river, unequal stacks, side pots, chip EV', { board: 'Ks8d5h2c2s', common: 6, stacks: [4, 12, 30], ranges: ['AhKh,KdQd,8s8h,JsTs,7s6s,AcQc', 'AsKd,KcJc,5d5c,8h7h,AdQd,JdTd', 'Kc9c,QsQc,7d7c,Ah5s,Td9d,JhJc'], streets: { river: { bets: '75,a', raises: 'a', maxBets: 2 } } },
    [4000, 20000, 50000, 100000, 250000, 500000], false],
  ['bubble4', 'Four-player bubble push/fold, weighted two-hand ranges, short stack (ICM: 3 paid)', { preflop: { mode: 'shove' }, dealt: 4, common: 0, board: '', stacks: [12, 7, 20, 4], ranges: ['AsAh,7c2d:0.5', 'KsKh:0.75,8c3d', 'QsQh,6d5d', 'JsJh:0.5,9s8s'], icm: { payouts: [50, 30, 20] }, batchDeals: 4, actionStreams: 'deal' },
    [4000, 20000, 50000, 100000, 250000], false],
  ['flop6', 'Six-player flop, unequal stacks (3 to 50 bb), all-in or fold, two hands a seat, side pots, chip EV', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 3], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d', 'KdTs,9c8c', 'QsQd,Ac7h', 'JhTc,6s5s', 'AdKc,2s2d', '8h8d,As2c'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } },
    [4000, 20000, 50000, 100000, 250000], false],
  ['final8', 'Eight-player final table push/fold, fixed hands (ICM: 8 paid)', { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh', 'KsKh', 'QsQh', 'JsJh', 'TsTh', '9s9h', '8s8h', '7s7h'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal' },
    [4000, 20000, 50000, 100000, 250000], false],
  // ---- added in 4.8 ----
  ['turn4', 'Four-player turn and river, unequal stacks, all-in or check/fold on the turn, half-pot river bet, two hands a seat, chip EV', { board: 'Qd9s4c3h', dealt: 6, common: 4, stacks: [10, 25, 6, 40], prior: Array(4).fill(2), folded: [1], ranges: ['AdQs,9h9c', 'KsQc,Ts8s', 'JdJc,As4s', 'QhJh,7d6d'], streets: { turn: { bets: 'a', raises: '', maxBets: 1 }, river: { bets: '50', raises: '', maxBets: 1 } } },
    [4000, 20000, 50000, 100000, 250000], false],
  ['flop5', 'Five-player flop, unequal stacks (4 to 40 bb), all-in or fold, two hands a seat, side pots, chip EV', { board: 'Jc8d3s', dealt: 8, common: 2, stacks: [18, 40, 9, 25, 4], prior: Array(5).fill(2.5), folded: [1, 1, 2.5], ranges: ['AcJh,8h8c', 'KcJd,Th9h', 'AsKs,3c3h', 'QdJs,7c6c', 'AhAd,5s4s'], streets: { flop: { bets: 'a', raises: '', maxBets: 1 } } },
    [4000, 20000, 50000, 100000, 250000], false],
  ['flop6w', 'Six-player flop, weighted three-hand ranges, two bet sizes (half pot, all-in), side pots, chip EV', { board: 'Td7c2h', dealt: 8, common: 1.5, stacks: [20, 35, 8, 50, 14, 6], prior: Array(6).fill(2.5), folded: [1, 2.5], ranges: ['AhTh,7s7d:0.5,KcQc:0.75', 'KdTs,9c8c,AcJc:0.5', 'QsQd,Ac7h:0.5,5h5d', 'JhTc,6s5s:0.75,Kh9h', 'AdKc:0.5,2s2d,Js9s', '8h8d,As2c:0.5,QhJd'], streets: { flop: { bets: '50,a', raises: '', maxBets: 1 } } },
    [4000, 20000, 50000, 100000, 250000], false],
  ['final8w', 'Eight-player final table push/fold, weighted two-hand ranges (ICM: 8 paid)', { preflop: { mode: 'shove' }, board: '', dealt: 8, common: 0, stacks: [30, 22, 15, 40, 9, 18, 25, 12], ranges: ['AsAh,9c8c:0.5', 'KsKh,7d6d:0.5', 'QsQh,Ad5d:0.5', 'JsJh,Kc9c:0.5', 'TsTh,Qd8d:0.5', '9s9h,Jc7c:0.5', '8s8h,Ac2c:0.5', '7s7h,Kd2d:0.5'], icm: { payouts: [30, 20, 14, 11, 9, 7, 5, 4] }, batchDeals: 4, actionStreams: 'deal' },
    [4000, 20000, 50000, 100000], false],
];
const byKey = Object.fromEntries(games.map(g => [g[0], g]));
function spec(key, seed = 1, extra = {}) {
  const g = byKey[key]; if (!g) throw new Error('unknown game ' + key);
  return E.MultiwayGame({ ...base, ...g[2], ...extra, privateSeed: seed }).nativeSpec();
}
module.exports = { games, byKey, spec, base };
if (require.main === module) {
  const [cmd, key, out, seed, extra] = process.argv.slice(2);
  if (cmd === 'list') for (const g of games) console.log(g[0].padEnd(12), g[1]);
  else if (cmd === 'spec') fs.writeFileSync(path.resolve(out), JSON.stringify(spec(key, +(seed || 1), extra ? JSON.parse(extra) : {})));
  else { console.error('usage: node tools/games48.js list | spec <key> <out.json> [seed] [extra-json]'); process.exit(2); }
}
