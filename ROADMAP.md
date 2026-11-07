# EightMax upgrade status

Version 2.6 compiles the Windows host from source with matching version and
build ids, adds automatic exact/sampled mode selection (7- and 8-player
presets solve again), exact cross-checks of sampled training, itemized
short-stack antes and regenerated accuracy reports. Windows execution was
checked only under Wine. Real Windows hardware and physical GPUs are still
outstanding (run `Run self-tests.bat` or the workflow).

Next practical work after 2.6:
- Variance reduction for sampled multiway training (baselines or vectorized
  private-hand evaluation). Measured sampled error falls at about 1/sqrt(T),
  far slower than exact enumeration.
- Code-sign the Windows executable and add an icon resource.

Version 2.3 adds finer observable hand groups, an Exact cards option, configurable
strategy budgets, and multiway save/load/resume preserving regrets, averages and
training random state. Automatic traversal now samples betting branches for finer
hand groups when future streets remain. Windows CPU self-tests and a clean build
workflow are included; execution on Windows and physical GPUs is still outstanding.

Version 2.2 added regular-payout multiway ICM (up to 16 remaining players),
conditional linked preflop-to-river studies for up to six live seats, and
shove/call studies for up to eight seats with overcalls and side pots.
Eight-handed tables post 0.1 bb per dealt player; there is no big-blind ante.

## Next practical work

- Run the included Windows CPU and GPU tests on actual Windows hardware and
  record the results. Check real browser rendering and file downloads there.
- Measure abstraction and action-size sensitivity with larger training budgets
  and independent held-out response searches; finer groups alone are not evidence
  of lower exploitability.
- Improve card-information storage and configurable deviation searches to permit
  longer multiway runs within desktop memory limits.

## Longer-term scope

- Full eight-player linked preflop-through-river play and regenerated preflop
  charts using those continuation values. Current linked studies have at most
  six live seats, with other dealt seats assumed already folded.
- Large-field tournament evaluation beyond 16 remaining players, future-game
  simulation, and multiway knockout bounty modeling.

Multiplayer stability and tested response gains do not certify a full-game Nash
equilibrium. Enumeration gains apply only to the configured game tree. Exact
cards removes card grouping but still samples training deals and may sample actions.
