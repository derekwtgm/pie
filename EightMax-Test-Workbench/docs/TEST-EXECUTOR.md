# Test executor (0.22)

Modes: **study** (default; never acts), **simulation** (offline simulator only), **qa** (needs an `eightmax-qa-authorization` record: environment, approver,
`testEnvironmentOnly`, `noRealMoney`, `operatorOwnsTestClient`, expiry ≤ 8 h, endpoint on loopback or an individually allow-listed host; expiry latches the emergency stop).
The dashboard offers Study and Simulation only; QA is configured through the API with an authorization record and an approved test-client transport. No adapter for any
public or real-money client exists, and the code contains no process-memory, input-injection or evasion calls (checked by tests/release-consistency.test.cjs).

Every action: mode → emergency stop → table pause → adapter present → decision from the EightMax study (never fallback) → live state reconstructed and not paused → revision and state key match →
age ≤ 1.5 s → actor still to act → concrete action legal from the reconstructed legal actions → one action per (table, hand, revision) → submit with an idempotency key →
acknowledgement within the timeout, up to 2 retries → on no acknowledgement the table is paused and nothing further is automated until an operator resumes it.
The log (`exportLog`) is replayable on a fresh simulator (`replayLog`).

## 0.24
* `concretize` keeps `bet` and `raise` apart: an opening postflop wager must be a `bet`, a wager facing a bet must be a `raise`; the confirmed result carries `abstractType` for the log.
* Scripted decisions (`source:'scripted-fallback'`) execute only in Simulation Mode, only with `allowScripted:true`, only if labelled `SCRIPTED…`; they are counted in `counts.scripted`, never in `counts.executed`, and are refused in QA mode.
* `options.verify(ack)` — acknowledgement from an independent reading of the NEW state; a failed or throwing verification pauses the table and returns `unconfirmed` (`counts.unconfirmed`, log `ack-failed`).
* `latencyStats()` (p50 / p95 / max of submit-to-accepted time); `ApprovedClientAdapter` sends `{idempotencyKey, table, hand, actor, revision, action, amount}`.
* Tested in `tests/executor-024.test.cjs` and, with real frames and HTTP, in `tests/full-hand.test.cjs`.

## 0.25 additions
Adapters, acknowledgment and diagnostics are specified in docs/PLATFORM-ARCHITECTURE.md and `src/execution-adapters.js`. The executor's safeguards are unchanged: mode, table pause, global emergency stop, state revision, hand/actor, legality and wager size, stack, decision freshness, input fingerprint (`stateKey`), authorisation, duplicate prevention, acknowledgement from the next state, latency statistics. `confirmAction` classifies the next state as confirmed / rejected / ambiguous; ambiguous suspends the table.
