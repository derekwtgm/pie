(function (EM) {
'use strict';
const EPS = 1e-8;
EM.MTT_ANTE = Object.freeze({anteType:'classic', ante:0.1});
EM.tableAntes = function(dealt) {
  if (!Number.isInteger(dealt) || dealt < 2 || dealt > 8)
    throw new Error('Choose 2 to 8 players dealt in.');
  return dealt / 10;
};
// Ante structures: 'classic' (each dealt player posts the ante, default 0.1 bb),
// 'bba' (only the big blind posts one ante, default 1 bb) or 'none'.
EM.anteModel = function(cfg) {
  const type = cfg && cfg.anteType || 'classic';
  if (!['classic','bba','none'].includes(type)) throw new Error('Choose classic, big blind or no ante');
  const amount = type === 'none' ? 0 : cfg.ante == null || cfg.ante === '' ? (type === 'bba' ? 1 : 0.1) : Number(cfg.ante);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10) throw new Error('Enter an ante from 0 to 10 bb');
  return { type, amount,
    total: dealt => type === 'classic' ? dealt * amount : type === 'bba' ? amount : 0,
    seat: isBB => type === 'classic' ? amount : type === 'bba' && isBB ? amount : 0,
    label: dealt => type === 'none' ? 'no ante' : type === 'bba' ? 'big blind ante ' + amount + ' bb'
      : amount + ' bb × ' + dealt + ' dealt = ' + (+(dealt * amount).toFixed(3)) + ' bb in antes' };
};

// Amounts already in the middle that every live seat can win (antes, for example)
// are separate from live wagers, which can be limited by an all-in.
function potLayers(committed, live, common = 0) {
  const seats = Array.from(committed, (_, i) => i);
  const active = seats.filter(i => live[i]);
  if (!active.length) throw new Error('A pot needs at least one eligible player');
  const pots = [];
  function add(amount, eligible) {
    if (amount <= EPS) return;
    const previous = pots[pots.length - 1];
    if (previous && previous.eligible.length === eligible.length &&
        previous.eligible.every((s, i) => s === eligible[i])) previous.amount += amount;
    else pots.push({ amount, eligible });
  }
  add(common, active);
  let last = 0;
  for (const level of [...new Set(committed)].sort((a, b) => a - b)) {
    if (level <= last + EPS) continue;
    const paid = seats.filter(i => committed[i] >= level - EPS);
    const eligible = paid.filter(i => live[i]);
    // One contributor's uncalled excess goes back. Fully dead chips in an
    // otherwise empty layer go to the live players with the largest contribution.
    let winners = eligible;
    if (paid.length === 1) winners = paid;
    else if (!eligible.length) {
      const top = Math.max(...active.map(i => committed[i]));
      winners = active.filter(i => committed[i] >= top - EPS);
    }
    add((level - last) * paid.length, winners);
    last = level;
  }
  return pots;
}

function awardPots(pots, scores, behind) {
  const chips = Float64Array.from(behind);
  for (const pot of pots) {
    let best = -Infinity, count = 0;
    for (const seat of pot.eligible) {
      if (scores[seat] > best) { best = scores[seat]; count = 1; }
      else if (scores[seat] === best) count++;
    }
    const share = pot.amount / count;
    for (const seat of pot.eligible) if (scores[seat] === best) chips[seat] += share;
  }
  return chips;
}

function raiseIsOpen(lastFaced, price, fullRaise) {
  return lastFaced < 0 || price - lastFaced >= fullRaise - EPS;
}
function postflopOrder(seat, n) {
  if (n === 2) return seat === 1 ? 0 : 1;
  return seat >= n - 2 ? seat - (n - 2) : seat + 2;
}
Object.assign(EM, { potLayers, awardPots, raiseIsOpen, postflopOrder });
})(globalThis.EM || (globalThis.EM = {}));
