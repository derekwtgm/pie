# Authorized QA interface (0.24)

Authorized QA Mode talks to **one explicitly configured test client that the operator owns**. It is not a way to operate a commercial poker
site. A play-money site is not permission: only the written permission of whoever runs the client counts.

## Authorization record (`eightmax-qa-authorization` v1)
`environment`, `approvedBy`, `testEnvironmentOnly:true`, `noRealMoney:true`, `operatorOwnsTestClient:true`, `expiresAt` (at most 8 hours ahead), `endpoint`
(loopback by default; any other host must be listed in `allowedHosts`). Missing or false attestations, an expired record or an unlisted host refuse QA mode.
The executor re-checks the record before every action and latches an emergency stop if it expires. The dashboard cannot configure QA mode.

## Protocol (`src/qa-client.js`, reference server `tools/qa-test-server.cjs`)
All requests carry `Authorization: Bearer <token>`; only `/v1/…` paths under the authorized origin are ever contacted.
| Request | Meaning |
| --- | --- |
| `GET /v1/health` | `{ok:true}` |
| `GET /v1/frame` | `{frameId, viewSeat, revision, hand, width, height, png}` — pixels of the acting seat's view plus the client's revision counter |
| `POST /v1/action` | `{idempotencyKey, table, hand, actor, revision, action, amount}` → `{accepted, revision, reason?, duplicate?}` — the same key never acts twice; wrong hand, wrong actor or a stale revision is refused (HTTP 409) |
| `POST /v1/new-hand` | refused while a hand is in progress |

## Behaviour verified by tests (`tests/full-hand.test.cjs`)
* complete hands over real HTTP: frames → recognition → reconstruction → EightMax decision → `POST /v1/action` → acknowledged by the next frame;
* **scripted fallbacks can never run in QA mode**; a missing strategy suspends the table;
* unauthorized token → 401; foreign origin → refused client-side; short token / expired authorization → refused at construction;
* idempotent replay, stale revision, wrong hand, dropped acknowledgement (connection closed after the action was applied → `unconfirmed`, table paused, retry
  with the same key returns the original outcome).
