(function (EM) {
'use strict';
// EightMax 3.8: native-backed strategy explorer (rendering and aggregation).
//
// The desktop host answers POST /api/mw/node with ONE node of the open native
// study (see source/native/explorer.hpp). This module turns that bounded
// response into a 13x13 matrix, combo lists and aggregate frequencies. It never
// requests or holds the whole solver state, and it never invents values:
//   - "average" and "current" strategies are shown as the host labels them;
//   - hands without a stored row are shown as "no stored strategy";
//   - board-blocked combos are shown as impossible;
//   - EVs are never read from the stored state (it does not contain them).
//     3.9: action EVs are shown only after the user requests them from
//     POST /api/mw/ev (computed natively from the game model and a named
//     continuation policy, see native/action_ev.hpp), with their method
//     (exact / sampled), sample counts, standard errors and 95% intervals.
//     A matrix cell shows the reach-weighted mean of the combos whose EV was
//     actually computed; classes without computed combos stay empty.
const ACTION_COLORS = ['var(--fold)', 'var(--call)', 'var(--a-bet1)', 'var(--a-bet2)', 'var(--a-bet3)', 'var(--a-bet4)', 'var(--a-allin)', 'var(--jam)'];
function actionColor(action, index) {
  if (action.name === 'Fold') return 'var(--fold)';
  if (action.name === 'Check' || action.name === 'Call') return 'var(--call)';
  if (action.name === 'All-in') return 'var(--a-allin)';
  return ACTION_COLORS[2 + Math.min(4, Math.max(0, index - 1))];
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function amount(x) { return Number.isFinite(x) ? (Math.round(x * 100) / 100).toString() : '–'; }
function actionLabel(a) { return a.name + (['Bet to', 'Raise to', 'Call', 'All-in'].includes(a.name) && a.to > 0 ? ' ' + amount(a.to) : ''); }
// Matrix cells: per 169 hand class, reach-weighted strategy of the combos that
// have the chosen strategy kind, plus counts of blocked and unstored combos.
function explorerMatrix(response, kind) {
  const hands = response && response.hands; if (!hands) return null;
  const k = response.actions.length;
  const cells = Array.from({ length: 169 }, (_, c) => ({ cls: c, name: EM.CLASS_NAMES[c], combos: [], mix: null, mass: 0, weight: 0, blocked: 0, missing: 0, stored: 0 }));
  for (const item of hands.items) {
    const cell = cells[EM.classOf(item.cards[0], item.cards[1])]; cell.combos.push(item);
    if (item.blocked) { cell.blocked++; continue; }
    cell.weight += item.reach;
    const p = hands.actingSeat ? item[kind] : null;
    if (!p) { cell.missing++; continue; }
    cell.stored++;
    if (!cell.mix) cell.mix = new Array(k).fill(0);
    for (let a = 0; a < k; a++) cell.mix[a] += item.reach * p[a];
    cell.mass += item.reach;
  }
  for (const cell of cells) if (cell.mix && cell.mass > 0) cell.mix = cell.mix.map(x => x / cell.mass); else cell.mix = null;
  const maxWeight = Math.max(1e-300, ...cells.map(c => c.weight));
  for (const cell of cells) cell.intensity = cell.weight / maxWeight;
  return cells;
}
// 3.9: per-class EV values for the matrix. mode: 'ev' (EV of action a), 'diff'
// (EV of a minus the mixed-strategy EV), 'stderr' (standard error of the EV of
// a; 0 for exact values). Combos are weighted by their explorer reach.
function explorerEvMatrix(response, ev, action, mode) {
  const hands = response && response.hands; if (!hands || !ev) return null;
  const byIndex = new Map((ev.hands || []).map(h => [h.i, h]));
  const cells = Array.from({ length: 169 }, (_, c) => ({ cls: c, value: null, mass: 0, computed: 0, combos: 0 }));
  for (const item of hands.items) {
    if (item.blocked) continue;
    const cell = cells[EM.classOf(item.cards[0], item.cards[1])]; cell.combos++;
    const h = byIndex.get(item.i); if (!h || !h.available) continue;
    const v = mode === 'diff' ? h.diff[action] : mode === 'stderr' ? (h.stdErr ? h.stdErr[action] : 0) : h.ev[action];
    if (!Number.isFinite(v)) continue;
    const w = item.reach > 0 ? item.reach : 0; cell.computed++;
    if (w > 0) { cell.value = (cell.value || 0) + w * v; cell.mass += w; }
    else if (cell.mass === 0) cell.value = cell.computed === 1 ? v : (cell.value * (cell.computed - 1) + v) / cell.computed;
  }
  for (const c of cells) if (c.mass > 0) c.value /= c.mass;
  return cells;
}
function evNumber(x) { return Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(1) : x.toFixed(Math.abs(x) >= 10 ? 2 : 3)) : '–'; }
function evCell(h, a) {
  if (!h.stdErr) return evNumber(h.ev[a]);
  return evNumber(h.ev[a]) + ' <span class="note">± ' + evNumber(1.96 * h.stdErr[a]) + '</span>';
}
// 4.0: short plain-language labels for the per-action statistical classification.
// A difference that is not statistically supported is "uncertain", never "equal".
const CLASS_LABEL = { highest: 'highest EV', highestEstimate: 'highest estimate', exactTie: 'exact tie with highest', withinMargin: 'exact; within margin', lower: 'exact; lower',
  differenceSupported: 'lower (supported)', differenceUncertain: 'difference uncertain', practicallyEquivalent: 'equivalent within margin', insufficientSamples: 'too few samples' };
function classLabel(x, a) {
  if (x.classification && x.classification[a]) return CLASS_LABEL[x.classification[a]] || x.classification[a];
  return x.best === a ? 'highest' : x.method === 'exact' ? 'lower' : 'not classified (older result)';
}
function classTitle(x, a) {
  if (x.interpretation && x.interpretation[a]) return x.interpretation[a];
  return x.best === a ? 'highest EV' : 'lower than the highest EV; this older result has no statistical classification and makes no equivalence claim';
}
// 4.0: strategy-coverage and fallback warning (always shown when reported).
function coverageHtml(ev) {
  const c = ev.coverage; if (!c) return '';
  const pct = x => (100 * (x || 0)).toFixed(1) + '%';
  let h = '<p class="note">Strategy coverage: ' + pct(c.rowCoverage) + ' of ' + (c.policyLookups || 0).toLocaleString() + ' policy lookups found a stored strategy (' + (c.distinctFallbackInformationSets || 0).toLocaleString() + ' distinct untrained information sets' + (c.distinctCountCapped ? ', count capped' : '') + '). ' +
    'Probability-weighted fallback: up to ' + pct(c.maxActionFallbackShare) + ' of an action\'s outcomes and ' + pct(c.maxOpponentReachFallbackShare) + ' of an opponent range' + (c.samplesEvaluated ? '; ' + pct(c.sampleFallbackShare) + ' of samples touched a fallback' : '') + '. Fallback policy: ' + esc(c.fallbackDescription || c.fallbackPolicy) + '.</p>';
  if (c.warning) h = '<p class="bad" role="alert">⚠ ' + esc(c.warning) + '</p>' + h;
  return h;
}
// EV table for the evaluated combos (only those in `filter`, if given).
function evTable(ev, names, filter) {
  if (!ev) return '';
  const unit = ev.utility.unit, rows = (ev.hands || []).filter(h => !filter || filter.has(h.i));
  const exec = ev.execution ? ' · ' + (ev.threads || 1) + ' thread' + ((ev.threads || 1) > 1 ? 's' : '') + ', device ' + ev.execution.device + (ev.execution.gpuBoards ? ' (' + ev.execution.gpuBoards.toLocaleString() + ' boards on the GPU)' : '') : '';
  let h = '<div class="ex-ev"><h4>Action EVs (' + esc(ev.utility.model === 'icm' ? 'ICM tournament equity, ' + unit : 'chip EV, ' + unit) + ')</h4>' +
    '<p class="note">' + esc((ev.method === 'exact' ? 'Exact enumeration' : 'Monte Carlo estimate, ' + (ev.samplesRequested || 0).toLocaleString() + ' samples per hand requested, seed ' + ev.seed + ', later actions ' + ev.futureActions + '; ± is a normal 95% interval') +
    ' · continuation policy: ' + ev.policy + (ev.status === 'partial' || ev.stoppedEarly ? ' · PARTIAL: stopped early at the time limit (estimates from the completed samples only)' : '') + (ev.note ? ' · ' + ev.note : '') + exec + (ev.elapsedMs != null ? ' · ' + (ev.elapsedMs / 1000).toFixed(2) + ' s' : '')) + '</p>';
  h += coverageHtml(ev);
  h += '<div class="rv-scroll"><table class="rv-table"><thead><tr><th>Combo</th>' + ev.actions.map(a => '<th>' + esc(actionLabel(a)) + '</th>').join('') + '<th>Mixed strategy</th><th>Method</th></tr></thead><tbody>';
  const card = h0 => h0.cards ? esc(EM.cardStr(h0.cards[1]) + EM.cardStr(h0.cards[0])) : 'range';
  const row = x => {
    if (!x.available) return '<tr><th>' + card(x) + '</th><td colspan="' + (ev.actions.length + 2) + '"><span class="note">EV unavailable: ' + esc(x.reason || 'not computed') + '</span></td></tr>';
    return '<tr><th>' + card(x) + '</th>' + ev.actions.map((_, a) => '<td' + (x.best === a ? ' class="best"' : '') + ' title="' + esc(classTitle(x, a) + (x.vsBestCi95 && a !== x.best ? '; difference from the highest: ' + evNumber(x.vsBest[a]) + ' (95% interval ' + evNumber(x.vsBestCi95[a][0]) + ' to ' + evNumber(x.vsBestCi95[a][1]) + ')' : '') + (x.fallbackShare[a] > 0 ? '; ' + (100 * x.fallbackShare[a]).toFixed(1) + '% of this value used the fallback policy where no strategy is stored' : '')) + '">' + evCell(x, a) +
      (x.strategy ? '<br><span class="note">' + (100 * x.strategy[a]).toFixed(1) + '% · Δ ' + evNumber(x.diff[a]) + '</span>' : '') + '<br><span class="note ex-cls">' + esc(classLabel(x, a)) + '</span>' + (x.fallbackShare[a] > 0 ? '*' : '') + '</td>').join('') +
      '<td>' + evNumber(x.mixed) + (x.mixedStdErr != null ? ' <span class="note">± ' + evNumber(1.96 * x.mixedStdErr) + '</span>' : '') + '</td><td>' + esc(x.method) + (x.samples ? ' (' + x.samples.toLocaleString() + ')' : '') + '</td></tr>';
  };
  h += rows.map(row).join('') + (ev.range && !filter ? row({ ...ev.range, cards: null }) : '') + '</tbody></table></div>';
  h += '<p class="note">Δ = action EV minus the EV of the stored mixed strategy. Labels compare each action with the highest estimate using paired differences: "lower (supported)" means the 95% interval of the difference excludes zero; "difference uncertain" means the data cannot tell the actions apart — this is NOT evidence that they are equal, and mixed-strategy actions need not have equal estimated EVs. "Equivalent within margin" appears only when you set an equivalence margin and two one-sided tests support it' +
    (ev.statistics && ev.statistics.equivalenceMargin != null ? ' (margin ' + evNumber(ev.statistics.equivalenceMargin) + ' ' + esc(unit) + ')' : '') + '. * part of the value passes through states without a stored strategy (fallback share in the tooltip). ' + esc(ev.utility.convention) + '</p>';
  if (ev.fallbackSensitivity) h += '<p class="note">Fallback sensitivity (not a confidence interval): ' + ev.fallbackSensitivity.policies.map(p => esc(p.fallback) + (p.error ? ' — ' + esc(p.error) : '')).join(', ') + (ev.fallbackSensitivity.bestActionChanges ? ' — <b>the highest-EV action changes with the fallback assumption</b>' : ' — the highest-EV action does not change') + '.</p>';
  h += '</div>';
  return h;
}
// 4.0: evaluation options (all sent to the host, which validates them).
function evOptions(ui, s) {
  const o = ui.evOptions || {}, sel = (id, cur, opts) => '<select id="' + id + '">' + opts.map(([v, l]) => '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
  return ' <label>Method ' + sel('ex-ev-method', o.method || 'auto', [['auto', 'Automatic'], ['exact', 'Exact'], ['sampled', 'Sampled']]) + '</label>' +
    ' <label>Utility ' + sel('ex-ev-utility', o.utility || 'study', s && s.tournament ? [['study', 'ICM (study)'], ['chip', 'Chip EV']] : [['study', 'Chip EV (study)']]) + '</label>' +
    ' <label>Time limit (s) <input id="ex-ev-time" type="number" min="0.1" max="3600" step="0.1" value="' + (o.timeLimitS || 60) + '"></label>' +
    ' <label>Visit budget <input id="ex-ev-visits" type="number" min="1000" max="2000000000" step="1000" value="' + (o.maxVisits || 20000000) + '"></label>' +
    ' <label>Processing ' + sel('ex-ev-device', o.device || 'auto', [['auto', 'Automatic'], ['cpu', 'CPU only'], ['gpu', 'GPU preferred'], ['hybrid', 'Hybrid CPU/GPU']]) + '</label>' +
    ' <label>Equivalence margin <input id="ex-ev-margin" type="number" min="0" step="any" placeholder="none" value="' + (o.margin > 0 ? o.margin : '') + '"></label>' +
    ' <label>Untrained states ' + sel('ex-ev-fallback', o.fallback || 'uniform', [['uniform', 'Uniform fallback'], ['foldCheck', 'Fold/check fallback'], ['callCheck', 'Call/check fallback'], ['refuse', 'Refuse']]) + '</label>';
}
// 4.0: status of the background evaluation job (no completion percentage is shown: the work is not known in advance).
function evJobHtml(j, label) {
  const p = j.progress || {};
  const parts = ['Job ' + esc(j.jobId || '') + ': ' + esc(j.status || 'submitting'), label ? esc(label) : ''];
  if (p.elapsedMs != null) parts.push((p.elapsedMs / 1000).toFixed(1) + ' s');
  if (p.samples) parts.push(p.samples.toLocaleString() + ' samples');
  if (p.boardsScored) parts.push(p.boardsScored.toLocaleString() + ' runout boards scored' + (p.gpuBoards ? ' (' + p.gpuBoards.toLocaleString() + ' on the GPU)' : ''));
  if (p.stage && j.status === 'running') parts.push('stage: ' + esc(p.stage));
  if (p.peakEvaluationMiB != null) parts.push('evaluation memory ' + p.peakEvaluationMiB.toFixed(1) + ' MiB');
  if (j.cancelRequested) parts.push('cancellation requested');
  if (j.overdue) parts.push('past its time limit; waiting for the worker to stop');
  const active = j.status === 'running' || j.status === 'pending' || !j.status;
  return '<p class="note" role="status">' + parts.filter(Boolean).join(' · ') + (active ? ' <button type="button" class="btn sm ghost" data-ex-ev="cancel">Cancel</button>' : '') + '</p>';
}
function seatName(names, seat) { return names && names[seat] ? names[seat] : 'Seat ' + (seat + 1); }
function boardHtml(cards) { return cards.length ? cards.map(c => '<span class="ex-card">' + esc(EM.cardStr(c)) + '</span>').join('') : '<span class="note">none</span>'; }
function mixBar(mix, actions) {
  if (!mix) return '<div class="ex-bar ex-empty"></div>';
  return '<div class="ex-bar">' + mix.map((p, a) => p > 0 ? '<i style="width:' + (100 * p).toFixed(2) + '%;background:' + actionColor(actions[a], a) + '"></i>' : '').join('') + '</div>';
}
function freqList(mix, actions) {
  if (!mix) return '<span class="note">no stored strategy</span>';
  return actions.map((a, i) => '<span class="ex-freq"><b style="color:' + actionColor(a, i) + '">■</b> ' + esc(actionLabel(a)) + ' ' + (100 * mix[i]).toFixed(1) + '%</span>').join(' ');
}
// ui: {kind, names, selectedCell, pending, error, boardInput, ev, evBusy, evError, evSamples, evPolicy, matrixMode, evAction}
function renderExplorer(response, ui) {
  const names = ui.names;
  if (ui.error && !response) return '<div class="card ex"><h3>Strategy explorer</h3><p class="bad">' + esc(ui.error) + '</p></div>';
  if (!response) return '<div class="card ex"><h3>Strategy explorer</h3><p class="note">Loading…</p></div>';
  const r = response, n = r.node, s = r.study;
  let h = '<div class="card ex"><h3>Strategy explorer</h3>';
  h += '<p class="note">' + esc(s.players + '-player ' + s.startStreet + ' study · ' + s.abstraction + ' · ' + s.weighting + ' weighting' + (s.regretMatching === 'plus' ? ', CFR+' : '') + (s.tournament ? ' · ICM' : ' · chip EV') +
    ' · ' + s.updates.toLocaleString() + ' updates · ' + s.sampledDeals.toLocaleString() + ' sampled deals · ' + s.rows.toLocaleString() + ' rows · ' + s.states.toLocaleString() + ' betting states') + '</p>';
  if (ui.error) h += '<p class="bad" role="alert">' + esc(ui.error) + '</p>';
  // history / breadcrumbs
  h += '<div class="ex-path"><button type="button" class="btn sm" data-ex-go="0">Root</button>';
  let decisions = 0;
  r.history.forEach((step, i) => {
    if (step.chance) h += ' <span class="ex-step">' + esc(step.street) + ' ' + step.cards.map(c => esc(EM.cardStr(c))).join('') + '</span>';
    else { decisions++; h += ' <button type="button" class="btn sm ghost" data-ex-go="' + decisions + '" title="Return to the decision after this action">' + esc(seatName(names, step.seat) + ': ' + actionLabel({ name: step.action, to: step.to })) + '</button>'; }
  });
  h += '</div><div class="ex-controls"><button type="button" class="btn sm" data-ex-back ' + (decisions || r.history.length ? '' : 'disabled') + '>Previous decision</button> ' +
    '<label>Strategy <select id="ex-kind"><option value="average"' + (ui.kind === 'average' ? ' selected' : '') + '>Average (solver output)</option><option value="current"' + (ui.kind === 'current' ? ' selected' : '') + '>Current regret matching</option></select></label> ' +
    '<label>Range of <select id="ex-seat">' + Array.from({ length: s.players }, (_, p) => '<option value="' + p + '"' + (r.hands && r.hands.seat === p ? ' selected' : '') + '>' + esc(seatName(names, p)) + (p === n.actor ? ' (to act)' : '') + '</option>').join('') + '</select></label></div>';
  // node summary
  const live = n.live.map((x, p) => x ? (n.allIn[p] ? seatName(names, p) + ' (all-in)' : seatName(names, p)) : null).filter(Boolean);
  h += '<table class="rv-table ex-node"><tbody>' +
    '<tr><th>Street</th><td>' + esc(n.street) + (n.kind !== 'decision' ? ' · ' + esc(n.kind) : '') + '</td><th>Board</th><td>' + boardHtml(n.board) + '</td></tr>' +
    '<tr><th>To act</th><td>' + (n.actor >= 0 ? esc(seatName(names, n.actor)) : '–') + '</td><th>Pot</th><td>' + amount(n.pot) + ' BB' + (n.facing ? ' · facing ' + amount(n.price) : '') + '</td></tr>' +
    '<tr><th>Active players</th><td>' + esc(live.join(', ')) + '</td><th>Effective stack</th><td>' + (n.effectiveStack == null ? '–' : amount(n.effectiveStack) + ' BB') + '</td></tr>' +
    '<tr><th>Stacks behind</th><td colspan="3">' + n.behind.map((b, p) => esc(seatName(names, p)) + ' ' + amount(b) + (n.live[p] ? '' : ' (folded)')).join(' · ') + '</td></tr>' +
    '<tr><th>Information set</th><td colspan="3">' + (n.stateId >= 0 ? 'betting state #' + n.stateId + (n.visited ? '' : ' (not visited)') : (n.kind === 'terminal' ? 'terminal' : 'not visited in training: no stored strategy')) + '</td></tr></tbody></table>';
  if (n.kind === 'terminal') {
    h += '<p>Hand over. Pots: ' + (n.pots || []).map(p => amount(p.amount) + ' BB to ' + p.eligible.map(e => esc(seatName(names, e))).join('/')).join(' · ') + '</p>';
    return h + '</div>';
  }
  if (n.kind === 'chance' || n.needsCards) {
    const used = new Set(n.board);
    h += '<p>Select the ' + (n.needsCards === 3 ? 'flop' : n.board.length === 3 ? 'turn' : 'river') + ' card' + (n.needsCards > 1 ? 's' : '') + ' to continue (' + n.needsCards + ').</p><div class="ex-deck">';
    for (let c = 51; c >= 0; c--) h += '<button type="button" class="btn sm ghost ex-card' + ((ui.boardInput || []).includes(c) ? ' on' : '') + '" data-ex-card="' + c + '"' + (used.has(c) ? ' disabled' : '') + '>' + esc(EM.cardStr(c)) + '</button>';
    return h + '</div></div>';
  }
  // actions
  h += '<div class="ex-actions">' + r.actions.map(a => '<button type="button" class="btn sm" data-ex-action="' + a.slot + '" title="' + (a.childVisited === false ? 'Branch exists in the abstraction but was not visited in training' : '') + '">' + esc(actionLabel(a)) + (a.childVisited === false ? ' (unvisited)' : '') + '</button>').join(' ') + '</div>';
  const agg = r.aggregate;
  h += '<p><b>Range-weighted ' + esc(ui.kind) + ' strategy of ' + esc(seatName(names, n.actor)) + ':</b> ' + freqList(agg && agg[ui.kind], r.actions) + '</p>';
  if (agg) h += '<p class="note">Coverage: ' + agg.coverage.withRows + ' of ' + (agg.coverage.hands - agg.coverage.blocked) + ' possible combos have stored rows; ' + agg.coverage.blocked + ' blocked by the board. ' +
    'Aggregates weight each combo by its range weight × its own average-strategy probability of reaching this node.</p>';
  if (!ui.ev) h += '<p class="note">' + esc(r.ev.reason) + '</p>';
  if (!r.hands) return h + '</div>';
  if (!r.hands.actingSeat) h += '<p class="note">Showing the reach distribution of ' + esc(seatName(names, r.hands.seat)) + ', who is not acting here; strategies are shown for the acting seat only.</p>';
  const ev = ui.ev && (!ui.ev.node || (ui.ev.node.stateId === n.stateId && ui.ev.node.board.length === n.board.length)) && r.hands.actingSeat ? ui.ev : null;
  h += '<div class="ex-controls"><button type="button" class="btn sm" data-ex-ev="class"' + (ui.selectedCell == null ? ' disabled title="Select a hand class first"' : '') + '>Calculate EVs of the selected class</button> ' +
    '<button type="button" class="btn sm" data-ex-ev="all">Calculate EVs of every hand (sampled, bounded)</button> ' +
    '<label>Samples <input id="ex-ev-samples" type="number" min="16" max="2000000" step="1" value="' + (ui.evSamples || 4000) + '"></label> ' +
    '<label>Policy <select id="ex-ev-policy"><option value="average"' + (ui.evPolicy !== 'current' ? ' selected' : '') + '>Average</option><option value="current"' + (ui.evPolicy === 'current' ? ' selected' : '') + '>Current</option></select></label>' + evOptions(ui, s) + '</div>';
  if (ui.evJob) h += evJobHtml(ui.evJob, ui.evBusy);
  else if (ui.evBusy) h += '<p class="note" role="status">' + esc(ui.evBusy) + ' <button type="button" class="btn sm ghost" data-ex-ev="cancel">Cancel</button></p>';
  if (ui.evError) h += '<p class="bad" role="alert">' + esc(ui.evError) + '</p>';
  const mode = ev ? (ui.matrixMode || 'strategy') : 'strategy', evAction = Math.min(Math.max(0, ui.evAction || 0), r.actions.length - 1);
  if (ev) h += '<div class="ex-controls"><label>Matrix shows <select id="ex-matrix"><option value="strategy"' + (mode === 'strategy' ? ' selected' : '') + '>Strategy frequencies</option><option value="ev"' + (mode === 'ev' ? ' selected' : '') + '>EV of an action</option><option value="diff"' + (mode === 'diff' ? ' selected' : '') + '>EV minus mixed-strategy EV</option><option value="stderr"' + (mode === 'stderr' ? ' selected' : '') + '>EV standard error</option></select></label> ' +
    '<label>Action <select id="ex-ev-action">' + r.actions.map((a, i) => '<option value="' + i + '"' + (i === evAction ? ' selected' : '') + '>' + esc(actionLabel(a)) + '</option>').join('') + '</select></label></div>';
  const evCells = ev && mode !== 'strategy' ? explorerEvMatrix(r, ev, evAction, mode) : null;
  let evScale = 1e-300; if (evCells) for (const c of evCells) if (c.value != null) evScale = Math.max(evScale, Math.abs(c.value));
  const cells = explorerMatrix(r, ui.kind);
  h += '<div class="ex-matrix" role="grid" aria-label="Starting-hand matrix">';
  for (let row = 0; row < 13; row++) for (let col = 0; col < 13; col++) {
    const c = cells[row * 13 + col];
    const impossible = c.combos.length && c.blocked === c.combos.length;
    h += '<button type="button" class="ex-cell' + (ui.selectedCell === c.cls ? ' on' : '') + (impossible ? ' blocked' : '') + (!c.combos.length ? ' absent' : '') + '" data-ex-cell="' + c.cls + '" style="opacity:' + (impossible || !c.combos.length ? 0.35 : (0.35 + 0.65 * c.intensity).toFixed(3)) + '" title="' + esc(c.name + ': ' + c.combos.length + ' combos in range, ' + c.blocked + ' blocked, ' + c.missing + ' without stored strategy') + '">' +
      (evCells ? evBar(evCells[c.cls], evScale, mode) : r.hands.actingSeat ? mixBar(c.mix, r.actions) : '') + '<span>' + esc(c.name) + '</span></button>';
  }
  h += '</div>';
  if (ui.selectedCell != null) {
    const c = cells[ui.selectedCell];
    h += '<h4>' + esc(c.name) + ' — ' + c.combos.length + ' combos</h4><div class="rv-scroll"><table class="rv-table"><thead><tr><th>Combo</th><th>Weight</th><th>Reach</th><th>Strategy</th></tr></thead><tbody>' +
      c.combos.map(x => '<tr><th>' + esc(EM.cardStr(x.cards[1]) + EM.cardStr(x.cards[0])) + '</th><td>' + amount(x.weight) + '</td><td>' + (x.blocked ? 'blocked' : x.reach.toPrecision(4) + (x.reachUsesUniform ? '*' : '')) + '</td><td style="text-align:left">' +
        (x.blocked ? '<span class="note">impossible: blocked by the board</span>' : r.hands.actingSeat ? freqList(x[ui.kind], r.actions) : '–') + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="note">* reach uses a uniform probability where an earlier decision of this seat has no stored average strategy.</p>';
    if (ev) h += evTable(ev, names, new Set(c.combos.map(x => x.i)));
  }
  if (ev && ui.selectedCell == null) h += evTable(ev, names, null);
  if (evCells) h += '<p class="note">Matrix: ' + esc(mode === 'ev' ? 'EV of ' : mode === 'diff' ? 'EV minus mixed-strategy EV of ' : 'standard error of the EV of ') + esc(actionLabel(r.actions[evAction])) + ' (' + esc(ev.utility.unit) + '), reach-weighted over the combos whose EV was computed; empty cells have no computed EV.</p>';
  return h + '</div>';
}
function evBar(cell, scale, mode) {
  if (!cell || cell.value == null) return '<div class="ex-bar ex-empty" title="no computed EV"></div>';
  const x = cell.value / scale, pos = mode === 'stderr' ? 'var(--a-bet2)' : x >= 0 ? 'var(--call)' : 'var(--fold)';
  return '<div class="ex-bar" title="' + evNumber(cell.value) + ' (' + cell.computed + ' of ' + cell.combos + ' combos computed)"><i style="width:' + Math.min(100, 100 * Math.abs(x)).toFixed(1) + '%;background:' + pos + '"></i></div><span class="ex-ev-val">' + evNumber(cell.value) + '</span>';
}
Object.assign(EM, { explorerMatrix, explorerEvMatrix, renderExplorer, explorerActionLabel: actionLabel });
})(globalThis.EM || (globalThis.EM = {}));
