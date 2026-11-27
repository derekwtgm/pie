# EightMax 5.16: what the measurement means, and what the Ranked grouping is

Build `39600509cc5a98e8`.

## 1. The game, the abstraction, and the measure

A study fixes ranges, stacks, a board and bet sizes. Call the game with exactly those rules, in which every player
sees their own two cards and the board, **G**. "Exact cards" trains in G itself: one row for every (betting state,
hand, board).

A **hand grouping** is a function from (seat, hand, public cards, the seat's earlier keys) to a key; hands with the
same key at the same betting state share a row, so they must play the same way. Training with a grouping solves
another game, **G'**, in which a player knows only the key. A strategy of G' is also a strategy of G (look up the
key, play the row).

The measure of this release is computed in **G**: for each seat, the value of the best strategy of G against the
other seats' trained strategies, minus the value of the seat's own trained strategy; summed over seats (NashConv).
The best response is found by full enumeration (`mwcli --gain`, method `exact`), not by training, so it carries no
sampling error.

* **Proven:** NashConv in G is zero exactly at a Nash equilibrium of G and is the sum of what each seat could gain by
  deviating alone. For two players with chip EV, half of it is the exploitability.
* **Consequence used here:** the same strategy space G is the yardstick for all groupings, so their numbers can be
  compared. A strategy that is an exact equilibrium of G' generally has a positive NashConv in G; that number is the
  cost of the grouping for that game. Training cannot lower it.
* **Not implied:** with three or more players a low NashConv does not bound what a seat loses when two others
  deviate together, and equilibria are not unique. And the measure says nothing about bet sizes or ranges that the
  study left out.
* **What is still approximate in the numbers:** the trained strategy is a finite run of a sampling trainer. Each
  number is (training residual) + (grouping cost), and only for Exact cards is the second term zero. Section 3 of
  CONVERGENCE-5.16.md therefore requires a grouping to be 3 times above Exact cards before calling its error large,
  and reports whether the number still falls.

## 2. Why the existing code already measures in G

`exactBestResponse` (native/action_ev.hpp) enumerates the responder's physical hands, the opponents' hand tuples and
every board card, and maximises at the responder's decisions with the physical hand and the exact board as its
information. Only the evaluated strategy is read through the keys. This was true before 5.16 (CONVERGENCE-5.10.md
excluded grouped games from its measure for that reason). 5.16 changes nothing in it.

One sentence in an earlier report is wrong and is corrected here: MATHEMATICAL-VALIDATION-5.8.md, line 12, says the
exact response is "exact for the abstract game (the study's ranges, bet sizes and hand groups)". It is exact for the
study's ranges and bet sizes with **physical** cards. The trained response of 5.8 (`mwcli --response`) is the one
that stays inside the grouping.

## 3. The Ranked key (`ranked-5.16-v1`)

For a seat p, a hand h of p's range, and public cards c of length L, in a study that starts with S public cards:

1. On the starting street, when the seat's range has at most 12 hands: the hand itself (as Compact and Detailed do).
2. Otherwise let D be the sorted list of the **distinct** hand values (the program's 7-, 6- or 5-card evaluation)
   of all hands of p's range that share no card with c. Let i be the position of h's value in D.
   `bucket = i` when D has at most 16 entries, else `floor(16 * i / |D|)`.
3. `card = 0` when L = S. Otherwise, for the newest public card x: `card = 1 + 2 * k + f`, where k = 0 if x pairs an
   earlier public card, else 1 if x is higher than every earlier public card, else 2 if x is a ten or higher, else
   3; and f = 1 if at least three public cards now have x's suit.
4. `flush` = 1 if L < 5 and four of the L + 2 cards share a suit. `straight` = 1 if L < 5, the hand is below a
   straight, and four ranks of a five-rank window are present (the two draws of Compact, unchanged).
5. `signal = ((bucket * 9 + card) * 2 + flush) * 2 + straight + 1`, between 1 and 576.
6. `key = previous key * 2048 + signal` (previous key 0 on the starting street).

Properties:

* **Perfect recall of the seat's own keys** (step 6), as for Compact and Detailed. So G' is a game of perfect recall
  and the trainer's guarantees for two-player zero-sum games apply to G' as they do for the other groupings.
* **A function of the spec and the cards alone.** D depends on the range and the cards, not on the training history
  or on the thread that computes it. This is why one state results for every thread count
  (`--selftest516` T2; the ThreadSanitizer run of VALIDATION-5.16.md).
* **Integer arithmetic only.** No floating point enters the key, so platforms cannot differ in it.
* **The signal is never 0.** A turn key (one signal) and a river key (two signals) therefore never coincide, which
  the representative tables of turn studies require.
* **Suits are interchangeable** except through the two flush bits and f; hole cards enter only through the hand
  value and the draws. Blockers are not in the key.
* **It depends on the range.** Two studies with different ranges for a seat have different groupings for that seat.
  The study identifier covers the ranges, so states cannot be mixed up.

## 4. What is proven, tested, and not established

| Statement | Status |
|---|---|
| The measure is NashConv in the game with exact cards, for every grouping | follows from the code path of section 2; unchanged since 5.10 |
| The JavaScript key and the native key are the same function | **tested**: identical tables on three configurations and three seeds; not proven |
| The key is what section 3 says | **tested** on three river games by recomputing it from the definition (`tests/v516.test.js`); the turn and flop parts are covered only through the JavaScript-native comparison |
| One state for every thread count | **tested** (1 to 4 threads on Linux, Wine and the runner; thread sanitizer clean); 8 and 24 threads await the target PC |
| Compact's error is large on small games | **measured**, rule R1, eight games |
| Ranked's error is smaller than Compact's | **measured** on eight games and two held-out games; **not established** for large ranges or preflop studies |
| 16 levels are enough | **not established**. In the measured games a range rarely has more than 16 distinct strengths on a board, so the cap is almost never active there |
| The class of the new card is the right summary of it | **not established**; the exact rank did better in exploration and cost too many rows |
