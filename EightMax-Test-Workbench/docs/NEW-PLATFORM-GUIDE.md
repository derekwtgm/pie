# Adding a new authorised platform (process + worked example)

Use this only for a test environment **you own or are explicitly permitted to test, with play money**. Do not add a profile for a client you have not inspected. Do not claim compatibility until steps 1–8 are done and recorded.

## Process
1. **Authorisation.** Write down who approved testing, which environment, until when. For execution you will need an `eightmax-qa-authorization` record (`docs/QA-INTERFACE.md`). Observation-only (Study mode) needs no execution adapter.
2. **Pick an observation path.** Prefer an approved *structured state feed* (exact, no recognition error). Otherwise screenshots/window capture. List the capture methods the environment allows.
3. **Create the profile.** Dashboard → *Platform workspace → Calibration*, or copy `examples/profiles/new-platform-TEMPLATE.profile.json`. A new profile is `verification.status = "unverified"` and `execution.interface = "none"`.
4. **Calibrate the layout.** Load an authorised screenshot. Use *Suggest regions* (advisory only), then move each region (`x y w h` as fractions of the image) until the overlay matches: board ×5, hero ×2, pot, hand id, per-seat stack/bet/folded/button/active/all-in, action controls, call amount, minimum raise. Invalid edits (outside the image, overlapping numeral boxes) are refused.
5. **Teach the reader the client's glyphs.** Supply labelled screenshots (you type what each shows; every digit 0–9 and all 52 cards must appear — `learn()` reports what is missing). Unknown symbols are rejected, never guessed. Use the split rank/suit reader if the client's card faces differ from whole-card templates.
6. **Measure on held-out screenshots** (not used for learning) at every resolution/scale you will use: `CalibrationSession.evaluate(samples, {dataset})`. Record rejection rate and **false acceptances** (must be 0 before any execution). Keep these in a *separate* accuracy report per client; never reuse numbers from the synthetic renderer.
7. **Choose the execution interface.** `test-server-api` (preferred: idempotency key, acknowledgement) or `approved-ui-automation` (clicks only regions from your profile; needs a driver you supply, a wager-entry field and an authorisation). Run Study mode first, then Simulation-style dry runs against the test environment's own sandbox.
8. **Record evidence and verify.** Only then set `verification.status = "verified-by-operator"` with `evidence` entries (what was tested, when, by whom) and, optionally, `externalClient`. Save: the checksum makes later edits detectable; editing any region resets the status to `unverified`.

## Worked example: the application's own controlled test table (this is what ships)
```js
const PP = require('./src/platform-profile.js'), CAL = require('./src/calibration.js'), SIM = require('./src/sim-display.js');
const profile = PP.controlledProfile(2);                      // layout v2, execution: internal-simulation
const cs = new CAL.CalibrationSession(profile);
for (const f of labelledFrames) cs.addSample(f.image, f.truth); // truth = what the screenshot really shows
console.log(cs.learn());                                        // templates, what is missing
console.log(cs.evaluate(heldOutFrames, { dataset: 'my-held-out' })); // accepted / rejected / falseAcceptances per category
const bundle = cs.export();                                     // { profile: <checksummed JSON>, templates }  (status stays "unverified")
```
`tests/calibration.test.cjs` runs exactly this, including an *unseen layout* (every region shifted and scaled) and different resolutions.

## Writing an execution adapter
```js
class MyTestServerAdapter {
  constructor(authorization) { this.kind = 'approved-client'; this.id = 'qa:' + authorization.environment; }
  async submit(act) { /* act = {key, table, hand, actor, simRevision, type, amount}; use act.key as the idempotency key */
    return { accepted: true };                                   // or { accepted: false, reason }
  }
}
```
`XA.assertAdapter(adapter)` checks the contract; `TestExecutor.setMode('qa', {authorization})` then `attach(table, adapter)`. The executor, not the adapter, enforces freshness, legality, duplicates, pause and emergency stop. After submission the pipeline waits for the **next** observation and calls `confirmAction`; `ambiguous` suspends the table.

## What is still needed once a real site is chosen
Real screenshots + permission, per-client glyph calibration and held-out accuracy, a real execution interface and its acknowledgement semantics, betting-structure check against the site's rules (blinds/antes/min-raise/all-in rules), and a decision whether the site offers a state feed. None of it exists in 0.25.
