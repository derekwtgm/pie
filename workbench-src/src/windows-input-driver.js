/* EightMax Test Workbench 0.35.0: client of the Windows INPUT DRIVER (desktop/bin/EightMaxInput.exe).
 *
 * Transports (same protocol, one JSON object per line, opened by an authenticated hello):
 *   spawnTransport  Node only: starts EightMaxInput.exe as a child process with a fresh random token (tools, CI, tests).
 *   hostTransport   browser or Node: the desktop host owns the driver process; requests go to /api/input/command with the
 *                   desktop session token. Only one process (the host) ever owns the physical cursor.
 * DriverSession adds request ids, timeouts, cancellation and event fan-out. WindowsUiDriver implements the
 * UiAutomationAdapter driver contract (activate(region, box, act), enterAmount(text, field, act)) on top of it: it refreshes
 * the window's client rectangle right before each action, converts the profile's normalised region to physical pixels, and
 * passes the expected rectangle so the driver refuses stale coordinates.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./input-geometry.js'), require('./input-motion.js'));
  else root.WorkbenchInputDriver = factory(root.WorkbenchInputGeometry, root.WorkbenchInputMotion);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G, M) {
  'use strict';
  const ok = (v, m) => { if (!v) throw new Error(m); };
  const COMMANDS = Object.freeze(['health', 'status', 'cancel', 'cancel-all', 'estop', 'reset-estop', 'arm', 'disarm', 'resume', 'manual-mode', 'release-all', 'monitor-start', 'monitor-stop',
    'cursor', 'monitors', 'list-windows', 'window-info', 'exe-identity', 'register-target', 'unregister-target', 'focus', 'move', 'move-click', 'click', 'double-click', 'mouse-down', 'mouse-up', 'key', 'type', 'clear-field', 'read-text', 'enter-text', 'uia-controls', 'wait',
    'virtual-user-move', 'virtual-hotkey', 'virtual-events']);
  class DriverError extends Error { constructor(code, message, reply) { super(message); this.code = code; this.reply = reply; } }

  /** Node: spawn the driver. options: exe, args[], env, spawn (child_process.spawn), randomHex(n) */
  function spawnTransport(o) {
    const cp = o.spawn || require('child_process').spawn, token = o.token || require('crypto').randomBytes(32).toString('hex');
    const args = [...(o.args || [])]; if (o.parentPid !== false) args.push('--parent-pid', String(o.parentPid || process.pid));
    const child = cp(o.exe, args, { env: { ...(o.env || process.env), EIGHTMAX_INPUT_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const listeners = new Set(), exitListeners = new Set(); let buf = '', err = '', exited = null;
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; let m; try { m = JSON.parse(line); } catch (e) { continue; } for (const f of listeners) f(m); } });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('exit', (code, sig) => { exited = { code, signal: sig, stderr: err }; for (const f of exitListeners) f(exited); });
    child.on('error', (e) => { exited = { code: -1, error: e.message, stderr: err }; for (const f of exitListeners) f(exited); });
    return { kind: 'spawn', token, pid: child.pid, child, write: (obj) => { ok(!exited, 'Input driver is not running'); child.stdin.write(JSON.stringify(obj) + '\n'); }, onMessage: (f) => listeners.add(f), onExit: (f) => exitListeners.add(f), get exited() { return exited; }, close: () => { try { child.stdin.end(); } catch (e) { /* closed */ } } };
  }

  /** Browser/Node through the desktop host. request(path, body) -> parsed JSON (the host forwards one command, returns the driver's reply). */
  function hostTransport(request) {
    const listeners = new Set(); let closed = false;
    return { kind: 'host', async call(msg) { ok(!closed, 'closed'); return request('/api/input/command', msg); }, onMessage: (f) => listeners.add(f), emit: (m) => { for (const f of listeners) f(m); }, onExit: () => {}, close: () => { closed = true; }, get exited() { return null; } };
  }

  class DriverSession {
    constructor(transport, o = {}) {
      this.t = transport; this.seq = 0; this.pending = new Map(); this.events = []; this.eventListeners = new Set(); this.defaultTimeout = o.timeoutMs || 30000; this.helloed = false; this.capabilities = null; this.lastCursor = null;
      if (transport.write) {
        transport.onMessage((m) => {
          if (m && m.event) { this.events.push(m); if (this.events.length > 200) this.events.shift(); for (const f of this.eventListeners) { try { f(m); } catch (e) { /* listener errors never break the session */ } } return; }
          const p = m && this.pending.get(m.id); if (p) { this.pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); }
        });
        transport.onExit((x) => { for (const [, p] of this.pending) { clearTimeout(p.timer); p.resolve({ ok: false, code: 'driver-exited', error: 'The input driver exited (' + JSON.stringify(x) + ')' }); } this.pending.clear(); });
      }
    }
    onEvent(f) { this.eventListeners.add(f); return () => this.eventListeners.delete(f); }
    /** Raw request: resolves with the driver's reply object (ok true/false); never throws on a refusal. */
    request(cmd, args = {}, timeoutMs) {
      ok(COMMANDS.includes(cmd) || cmd === 'hello', 'Unknown driver command ' + cmd);
      if (this.t.call) return this.t.call({ cmd, ...args, timeoutMs: timeoutMs || this.defaultTimeout }).then((r) => { if (r && r.events) for (const e of r.events) { this.events.push(e); for (const f of this.eventListeners) f(e); } return r; });
      const id = ++this.seq, ms = timeoutMs || this.defaultTimeout;
      return new Promise((resolve) => { const timer = setTimeout(() => { this.pending.delete(id); resolve({ id, ok: false, code: 'timeout', error: 'No reply from the input driver within ' + ms + ' ms' }); }, ms); this.pending.set(id, { resolve, timer }); try { this.t.write({ id, cmd, ...args }); } catch (e) { clearTimeout(timer); this.pending.delete(id); resolve({ id, ok: false, code: 'driver-exited', error: e.message }); } });
    }
    /** Same, but throws DriverError on a refusal. */
    async call(cmd, args = {}, timeoutMs) { const r = await this.request(cmd, args, timeoutMs); if (!r || r.ok !== true) throw new DriverError(r && r.code || 'error', r && r.error || 'Input driver refused ' + cmd, r); if (r.to) this.lastCursor = r.to; else if (r.clickedAt) this.lastCursor = r.clickedAt; return r; }
    /** Start an operation and return {id, done}; cancel(id) interrupts it. Spawn transport only (the host transport has its own /api/input/cancel). */
    start(cmd, args = {}, timeoutMs) { ok(this.t.write, 'start() needs a direct driver connection'); const id = this.seq + 1; const done = this.request(cmd, args, timeoutMs); return { id, done }; }
    async hello() { if (this.helloed) return this.capabilities; const r = await this.request('hello', { token: this.t.token }, 10000); if (!r.ok) throw new DriverError(r.code, r.error, r); this.helloed = true; this.capabilities = r.capabilities; this.platform = r.platform; this.version = r.driver; return r.capabilities; }
    async close() { try { await this.request('shutdown', {}, 3000); } catch (e) { /* already gone */ } this.t.close(); }
  }

  /** Map a TestExecutor action to the profile control that performs it. */
  function controlFor(type, controls) {
    if (type === 'fold' || type === 'check' || type === 'call') return type;
    if (type === 'allin' && controls && controls.allin) return 'allin';
    return 'raise';
  }

  /**
   * The driver behind UiAutomationAdapter for one registered simulator window.
   * options: session (DriverSession), hwnd, motion (profile), timing, focusPolicy, expectClient(): the client rectangle the
   *   CURRENT observation was captured with (actions are refused when the window changed since), onTrace(event)
   */
  class WindowsUiDriver {
    constructor(o) {
      ok(o && o.session && typeof o.hwnd === 'string', 'WindowsUiDriver needs a session and a window handle');
      this.s = o.session; this.hwnd = o.hwnd; this.motion = M.profile(o.motion || {}); this.timing = { ...M.DEFAULT_TIMING, ...(o.timing || {}) }; this.focusPolicy = o.focusPolicy || 'bring-to-front';
      this.expectClient = o.expectClient || null; this.trace = o.onTrace || (() => {}); this.mustFinishWithinMs = o.mustFinishWithinMs || null; this.dryRun = !!o.dryRun;
    }
    async window() { const r = await this.s.call('window-info', { hwnd: this.hwnd }, 5000); return r.window; }
    /** Fresh client rectangle; refused when it differs from the one the observation saw. */
    async _client() {
      const w = await this.window();
      if (w.minimized) throw new DriverError('window-minimized', 'The simulator window is minimised');
      const want = this.expectClient ? this.expectClient() : null;
      if (want && !(want.x === w.client.x && want.y === w.client.y && want.w === w.client.w && want.h === w.client.h)) throw new DriverError('layout-changed', 'The window moved or was resized after the screen was read');
      return w.client;
    }
    _common(client, target, deadlineMs) {
      return { hwnd: this.hwnd, expectClient: client, region: target.rect, to: target.point, motion: this.motion, focusPolicy: this.focusPolicy, preClickMs: this.timing.preClickMs, holdMs: this.timing.holdMs, ...(deadlineMs ? { mustFinishWithinMs: deadlineMs } : {}) };
    }
    /** Contract: one click on a normalised region. Resolves {ok, reason?, detail}. */
    async activate(regionName, box, act = {}) {
      try {
        const client = await this._client(), target = G.regionToScreen(box, client); if (!target.ok) return { ok: false, reason: target.reason };
        const args = this._common(client, target, act.mustFinishWithinMs || this.mustFinishWithinMs);
        if (this.dryRun) { const r = await this.s.call('move', args, 15000); this.trace({ kind: 'dry-run', region: regionName, target, move: r }); return { ok: true, dryRun: true, detail: r }; }
        const r = await this.s.call('move-click', args, 20000); this.trace({ kind: 'click', region: regionName, target, reply: r });
        if (this.timing.postClickSettleMs) await new Promise((res) => setTimeout(res, this.timing.postClickSettleMs));
        return { ok: true, detail: { plannedMs: r.plannedMs, actualMs: r.actualMs, steps: r.steps, finalError: r.finalError, clickedAt: r.clickedAt, hitClass: r.hitClass, point: target.point, rect: target.rect } };
      } catch (e) { this.trace({ kind: 'click-refused', region: regionName, code: e.code, error: e.message }); return { ok: false, reason: (e.code ? e.code + ': ' : '') + e.message, code: e.code }; }
    }
    /** Contract: type an exact amount into the calibrated wager field and read it back. Nothing is submitted. */
    async enterAmount(text, field, act = {}) {
      try {
        ok(/^\d{1,12}(\.\d{1,4})?$/.test(text), 'Wager text must be digits (optionally one decimal part)');
        const client = await this._client(), target = G.regionToScreen(field, client, { insetFraction: 0.2 }); if (!target.ok) return { ok: false, reason: target.reason };
        const r = await this.s.call('enter-text', { ...this._common(client, target), text, keyIntervalMs: this.timing.keyIntervalMs, keyHoldMs: this.timing.keyHoldMs, focusSettleMs: this.timing.focusSettleMs }, 30000);
        this.trace({ kind: 'wager', text, read: r.read, verified: r.verified, target });
        return r.verified === true && r.read === text ? { ok: true, read: r.read, detail: { field: r.field } } : { ok: false, reason: 'Field shows ' + JSON.stringify(r.read) + ' instead of ' + JSON.stringify(text) };
      } catch (e) { this.trace({ kind: 'wager-refused', code: e.code, error: e.message }); return { ok: false, reason: (e.code ? e.code + ': ' : '') + e.message, code: e.code }; }
    }
    /** Time a click on `box` will take from the last known cursor position (scheduler estimate). */
    estimateMs(box, client, from) {
      const t = G.regionToScreen(box, client); if (!t.ok) return Infinity; const start = from || this.s.lastCursor || { x: client.x, y: client.y };
      return M.durationMs(Math.hypot(t.point.x - start.x, t.point.y - start.y), this.motion) + this.timing.preClickMs + this.timing.holdMs + this.timing.postClickSettleMs + 40;
    }
    estimateTypingMs(text) { return (this.timing.keyIntervalMs + this.timing.keyHoldMs) * (text.length + 8) + this.timing.focusSettleMs + 400; }
  }

  return { COMMANDS, DriverError, spawnTransport, hostTransport, DriverSession, WindowsUiDriver, controlFor };
});
