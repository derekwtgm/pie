/* EightMax Test Workbench 0.24: client for an explicitly AUTHORIZED QA test interface.
 *
 * Speaks a small HTTP protocol (docs/QA-INTERFACE.md) to a test client that the operator owns and has authorized in an
 * eightmax-qa-authorization record: GET /v1/frame (pixels + view metadata), POST /v1/action (idempotent, revision-bound),
 * POST /v1/new-hand. It performs no screen scraping of third-party software, no input synthesis and no automation of any
 * commercial poker client; the only thing it can talk to is the endpoint named in the authorization (loopback by default).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./test-executor.js'), require('./screen-capture.js'), require('./image-codec.js'));
  else root.WorkbenchQa = factory(root.WorkbenchExecutor, root.WorkbenchCapture, root.WorkbenchImageCodec);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EX, CAP, IC) {
  'use strict';

  const ok = (x, m) => { if (!x) throw new Error(m); };

  /** Origin of the authorized endpoint; every request path is resolved against it and nothing else is ever contacted. */
  function originOf(auth) { const u = new URL(auth.endpoint); return u.origin; }

  class QaHttpClient {
    /** options: authorization (validated eightmax-qa-authorization), token (bearer), fetch, now, timeoutMs, decode */
    constructor(o) {
      const v = EX.validateAuthorization(o.authorization, (o.now || Date.now)());
      if (!v.valid) throw new Error('QA authorization refused: ' + v.issues.join('; '));
      ok(typeof o.token === 'string' && o.token.length >= 8, 'A bearer token of at least 8 characters is required'); ok(typeof (o.fetch || globalThis.fetch) === 'function', 'fetch is required');
      this.auth = o.authorization; this.origin = originOf(o.authorization); this.token = o.token; this.fetch = o.fetch || globalThis.fetch; this.timeoutMs = o.timeoutMs || 3000;
      this.decode = o.decode || ((b64) => IC.decodeAny(Buffer.from(b64, 'base64'))); this.now = o.now || Date.now; this.frameNo = 0;
      this.source = this._makeSource(); this.adapter = new EX.ApprovedClientAdapter(o.authorization, this.now(), (endpoint, payload) => this.transport(endpoint, payload));
      this.table = null; this.log = [];
    }
    async _call(method, path, body) {
      ok(path.startsWith('/v1/'), 'Only /v1/ paths are used'); const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        const res = await this.fetch(this.origin + path, { method, headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
        const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* non-JSON error body */ }
        return { status: res.status, json, text };
      } finally { clearTimeout(timer); }
    }
    _makeSource() {
      const self = this;
      return {
        kind: 'qa-http', target: { kind: 'window', hwnd: 0x51, pid: 1, title: 'authorized QA test client' }, method: 'qa-frame',
        async open() { try { const r = await self._call('GET', '/v1/health'); return r.status === 200 && r.json && r.json.ok ? { ok: true } : { ok: false, code: CAP.CODES.LOST, reason: 'QA endpoint health check failed (' + r.status + ')' }; } catch (e) { return { ok: false, code: CAP.CODES.LOST, reason: 'QA endpoint unreachable: ' + e.message }; } },
        async grab() {
          let r; try { r = await self._call('GET', '/v1/frame'); } catch (e) { return { ok: false, code: CAP.CODES.FAILED, reason: 'Frame request failed: ' + e.message }; }
          if (r.status !== 200 || !r.json || !r.json.png) return { ok: false, code: CAP.CODES.FAILED, reason: 'Frame request returned ' + r.status };
          let image; try { image = self.decode(r.json.png); } catch (e) { return { ok: false, code: CAP.CODES.INVALID, reason: 'Frame did not decode: ' + e.message }; }
          return { ok: true, image, meta: { method: 'qa-frame', dpiScale: 1, sourceFrameId: r.json.frameId, sourceTimeMs: undefined, viewSeat: r.json.viewSeat, clientRevision: r.json.revision, occludedFraction: 0, target: self.source.target } };
        },
        async close() { return { ok: true }; },
      };
    }
    /** ApprovedClientAdapter transport: refuses any endpoint other than the authorized one. */
    async transport(endpoint, payload) {
      if (new URL(endpoint).origin !== this.origin) return { accepted: false, reason: 'Endpoint is not the authorized origin' };
      if (!EX.validateAuthorization(this.auth, this.now()).valid) return { accepted: false, reason: 'Authorization expired' };
      let r; try { r = await this._call('POST', '/v1/action', payload); } catch (e) { return { accepted: false, reason: 'QA action request failed: ' + e.message, error: true }; }
      this.log.push({ key: payload.idempotencyKey, status: r.status });
      if (!r.json) return { accepted: false, reason: 'QA endpoint returned a non-JSON answer (' + r.status + ')' };
      return { accepted: r.status === 200 && r.json.accepted === true, reason: r.json.reason, simRevisionAfter: r.json.revision, duplicate: !!r.json.duplicate };
    }
    async newHand() { const r = await this._call('POST', '/v1/new-hand', {}); ok(r.status === 200 && r.json && r.json.ok, 'QA endpoint refused a new hand: ' + (r.json && r.json.reason || r.status)); }
  }

  return { QaHttpClient, originOf };
});
