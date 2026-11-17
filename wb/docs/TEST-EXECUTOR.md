# Test executor (0.22)

Modes: **study** (default; never acts), **simulation** (offline simulator only), **qa** (needs an `eightmax-qa-authorization` record: environment, approver,
`testEnvironmentOnly`, `noRealMoney`, `operatorOwnsTestClient`, expiry ≤ 8 h, endpoint on loopback or an individually allow-listed host; expiry latches the emergency stop).
The dashboard offers Study and Simulation only; QA is configured through the API with an authorization record and an approved test-client transport. No adapter for any
public or real-money client exists, and the code contains no process-memory, input-injection or evasion calls (checked by tests/release-consistency.test.cjs).

Every action: mode → emergency stop → table pause → adapter present → decision from the EightMax study (never fallback) → live state reconstructed and not paused → revision and state key match →
age ≤ 1.5 s → actor still to act → concrete action legal from the reconstructed legal actions → one action per (table, hand, revision) → submit with an idempotency key →
acknowledgement within the timeout, up to 2 retries → on no acknowledgement the table is paused and nothing further is automated until an operator resumes it.
The log (`exportLog`) is replayable on a fresh simulator (`replayLog`).
