/* EightMax Test Workbench 0.35.0: the DEALER of the controlled Windows test table (desktop/bin/EightMaxTestTable.exe).
 *
 * Runs in its own process (tools/test-table-035.cjs). It owns the game - an EightMax engine table - renders each frame with the
 * controlled-renderer pixels (src/sim-display.js) plus the status strip, tells the window which buttons are enabled, and
 * applies the actions the window reports. It also keeps the ORACLE: every mouse press/release, key, button press, accepted and
 * refused action, with the engine state after each. The oracle is read by the acceptance tools only AFTER actions, to grade
 * recognition and input; the Workbench's decision path never reads it.
 * The view rotates to the seat that must act (each seat's cards are visible only in its own view), so every state change on the
 * table is caused by one input from the Workbench - exactly what action confirmation expects.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./sim-display.js'), require('./image-codec.js'), require('./status-strip.js'));
  else root.WorkbenchFixtureDealer = factory(root.EightMax, root.WorkbenchSimDisplay, root.WorkbenchImageCodec, root.WorkbenchStatusStrip);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EM, SIM, IC, SS) {
  'use strict';
  const CONTROLS = Object.freeze({ fold: { x: 0.6, y: 0.93, w: 0.1, h: 0.05 }, check: { x: 0.72, y: 0.93, w: 0.1, h: 0.05 }, call: { x: 0.84, y: 0.93, w: 0.07, h: 0.05 }, raise: { x: 0.92, y: 0.93, w: 0.07, h: 0.05 }, allin: { x: 0.6, y: 0.87, w: 0.1, h: 0.05 } });
  const WAGER_FIELD = Object.freeze({ x: 0.42, y: 0.93, w: 0.15, h: 0.05 });
  const CONVENTIONS = Object.freeze(['raise-to', 'raise-by']);

  class TableDealer {
    /** o: table (1..10), seed, convention, handGapMs, maxHands, now(), send(msg) -> to the window, record(event) -> oracle sink */
    constructor(o) {
      this.id = o.table; this.t = new EM.Table(o.table, o.seed || o.table * 7919); this.convention = o.convention || 'raise-to'; if (!CONVENTIONS.includes(this.convention)) throw new Error('Unknown wager convention');
      this.gap = o.handGapMs === undefined ? 600 : o.handGapMs; this.turnDelay = o.turnDelayMs || 0; this.holdUntil = 0; this.holdTimer = null; this.maxHands = o.maxHands || Infinity; this.now = o.now || Date.now; this.send = o.send; this.record = o.record || (() => {});
      this.rev = 0; this.view = 0; this.w = 0; this.h = 0; this.timer = null; this.closed = false; this.hands = 0;
      this.counts = { mouseDown: 0, mouseUp: 0, downOutsideControls: 0, downOnDisabled: 0, doubleClicks: 0, rightClicks: 0, keys: 0, actions: 0, accepted: 0, staleClicks: 0, illegal: 0, wagerRejected: 0, byType: {} };
      this.accepted = [];
    }
    get playing() { return this.t.status === 'playing'; }
    get holding() { return this.turnDelay > 0 && this.now() < this.holdUntil; }
    legal() {
      const l = this.playing && !this.holding ? this.t.legal() : null; if (!l) return { fold: false, check: false, call: false, raise: false, allin: false };
      return { fold: l.toCall > 0, check: l.canCheck, call: l.toCall > 0, raise: l.canRaise, allin: l.canRaise || l.toCall > 0 };
    }
    /** The image the window shows (RGBA), at the window's current client size. */
    frame() {
      // While the other players "think" (turn delay) the table shows no action controls and the view stays put.
      if (this.playing && this.t.actor >= 0 && !this.holding) this.view = this.t.actor;
      const img = SIM.renderTable(this.t, this.w, { v2: true, heroSeat: this.view, hideControls: this.holding || this.t.actor !== this.view });
      if (img.height !== this.h) { /* the window keeps 1.6:1; a 1 px rounding difference is padded/cropped */ const out = { width: this.w, height: this.h, data: new Uint8ClampedArray(this.w * this.h * 4) }; for (let y = 0; y < this.h; y++) { const sy = Math.min(img.height - 1, y); out.data.set(img.data.subarray(sy * this.w * 4, (sy + 1) * this.w * 4), y * this.w * 4); } SS.draw(out, { table: this.id, viewSeat: this.view, playing: this.playing, revision: this.rev }); return out; }
      return SS.draw(img, { table: this.id, viewSeat: this.view, playing: this.playing, revision: this.rev });
    }
    push(extra = {}) {
      if (this.closed || !this.w) return; const img = this.frame(), png = IC.encodePng(img);
      this.send({ type: 'frame', rev: this.rev, w: img.width, h: img.height, png: Buffer.from(png).toString('base64'), legal: this.legal(), title: ' · hand ' + this.t.hand, ...extra });
    }
    snapshot() { const t = this.t; return { hand: t.hand, status: t.status, street: t.street, actor: t.actor, revision: t.revision, currentBet: t.currentBet, pot: t.pot(), stacks: t.players.map((p) => p.stack), bets: t.players.map((p) => p.bet), folded: t.players.map((p) => p.folded) }; }
    start() { if (this.t.status !== 'playing') { this.t.startHand(); this.hands++; this.rev++; this.record({ kind: 'hand-start', rev: this.rev, state: this.snapshot() }); } }
    /** Messages from the window. */
    onWindow(m) {
      switch (m.type) {
        case 'ready': this.w = m.client.w; this.h = m.client.h; this.record({ kind: 'ready', hwnd: m.hwnd, client: m.client, dpi: m.dpi }); this.start(); this.push(); return;
        case 'resize': if (m.w !== this.w || m.h !== this.h) { this.w = m.w; this.h = m.h; this.rev++; this.record({ kind: 'resize', w: m.w, h: m.h, rev: this.rev }); this.push(); } return;
        case 'moved': this.record({ kind: 'moved', x: m.x, y: m.y }); return;
        case 'minimized': this.record({ kind: 'minimized' }); return;
        case 'shown': return;
        case 'closed': case 'closed-by-user': this.closed = true; clearTimeout(this.timer); this.record({ kind: m.type }); return;
        case 'key': this.counts.keys++; this.record({ kind: 'key', vk: m.vk, control: m.control }); return;
        case 'mouse-down': case 'mouse-up': case 'double-click': case 'right-down': {
          const down = m.type === 'mouse-down'; if (down) this.counts.mouseDown++; else if (m.type === 'mouse-up') this.counts.mouseUp++; else if (m.type === 'double-click') this.counts.doubleClicks++; else this.counts.rightClicks++;
          const onControl = m.control in CONTROLS || m.control === 'wager'; if (down && !onControl) this.counts.downOutsideControls++; if (down && onControl && m.enabled === false) this.counts.downOnDisabled++;
          this.record({ kind: m.type, x: m.x, y: m.y, control: m.control, enabled: m.enabled, rev: m.rev }); return;
        }
        case 'action': return this.onAction(m);
      }
    }
    onAction(m) {
      this.counts.actions++; const t = this.t, ev = { kind: 'action', control: m.control, wager: m.wager, rev: m.rev, state: this.snapshot() };
      if (m.rev !== this.rev) { this.counts.staleClicks++; ev.result = 'stale-click'; this.record(ev); return; }   // pressed on an old frame: a duplicate or late click, ignored
      const l = this.legal(); if (!this.playing || !l[m.control]) { this.counts.illegal++; ev.result = 'not-available'; this.record(ev); return; }
      const lg = t.legal(); let type = m.control, amount = 0;
      if (m.control === 'raise') {
        const text = String(m.wager || '').trim();
        if (!/^\d{1,9}$/.test(text)) { this.counts.wagerRejected++; ev.result = 'wager-rejected'; ev.reason = 'not a whole number of chips'; this.record(ev); this.push({ status: 'Invalid wager' }); return; }
        const n = Number(text); amount = this.convention === 'raise-by' ? t.currentBet + n : n;
        if (!(amount > t.currentBet && amount <= lg.maxRaiseTo && (amount >= lg.minRaiseTo || amount === lg.maxRaiseTo))) { this.counts.wagerRejected++; ev.result = 'wager-rejected'; ev.reason = 'outside ' + lg.minRaiseTo + '..' + lg.maxRaiseTo; ev.amount = amount; this.record(ev); this.push({ status: 'Wager outside limits' }); return; }
      } else if (m.control === 'allin') { if (lg.canRaise) { type = 'raise'; amount = lg.maxRaiseTo; } else { type = 'call'; } }
      const actor = t.actor;
      try { t.execute(t.request(type, amount, this.now()), this.now()); } catch (e) { this.counts.illegal++; ev.result = 'engine-refused'; ev.reason = e.message; this.record(ev); return; }
      this.counts.accepted++; this.counts.byType[m.control] = (this.counts.byType[m.control] || 0) + 1; this.rev++;
      const rec = { hand: t.hand, seat: actor, control: m.control, type, amount: type === 'call' ? lg.callAmount : amount, rev: this.rev }; this.accepted.push(rec); if (this.accepted.length > 5000) this.accepted.shift();
      ev.result = 'accepted'; ev.applied = rec; ev.after = this.snapshot(); this.record(ev);
      if (this.turnDelay > 0 && t.status === 'playing') { this.holdUntil = this.now() + this.turnDelay; clearTimeout(this.holdTimer); this.holdTimer = setTimeout(() => { if (this.closed) return; this.rev++; this.push(); }, this.turnDelay + 5); }
      this.push({ clearWager: m.control === 'raise' });
      if (t.status === 'complete') { this.record({ kind: 'hand-complete', hand: t.hand, state: this.snapshot() }); if (this.hands < this.maxHands) this.timer = setTimeout(() => { if (this.closed) return; this.start(); this.push(); }, this.gap); }
    }
    summary() { return { table: this.id, hands: this.hands, rev: this.rev, convention: this.convention, counts: JSON.parse(JSON.stringify(this.counts)), accepted: this.accepted.slice(-200) }; }
  }
  return { CONTROLS, WAGER_FIELD, CONVENTIONS, TableDealer };
});
