# EightMax 5.15: what the tournament payoff model computes, and what is and is not established

Build `87b9f6e38b735cfb`. The model is `tour-5.15-v1` (`source/native/tour515.hpp`, mirrored in `source/web/lib_tour515.js`).
It answers one question: **what are the stacks after a hand worth to each player, in prize units?** Through 5.14 the
answer was the Malmuth-Harville ICM value of the stacks. 5.15 adds two things to that answer, each only when a study
asks for it: bounties, and the simulation of the next hands.

Everything below is a model of a tournament. **Nothing in this file says how close the model is to a real
tournament**, and no percentage of GTO follows from any number in it.

## 1. Definitions

Players `1..N` (at most 16; at most 8 at the table). After the hand, player `i` has `x_i` chips; `X` is the sum of
all chips in play. Prizes `p_1 >= p_2 >= ...`. With bounties, a head `h_i >= 0` is on every player and `k` is the
share of a head paid at once when its player is busted (`k = 1`: knockout; `k = 0.5`: progressive knockout).

**ICM with the bust rule** (unchanged from 5.14). `ICM_i(x)` is the Malmuth-Harville value: the next place goes to a
player still in with probability proportional to the stacks. Players busted in the hand take the open places below
the survivors in the order of their stacks at the start of the hand; equal start stacks share.

**Bounties paid in a hand.** A player busted in the hand pays `k * h` to the winner of the last pot the player was in
(the pot with the fewest eligible players; split equally on a tie); `(1 - k) * h` is added to the winners' own heads.

**Value with no future hand:**

    V_0(x, h)_i  =  ICM_i(x)  +  (x_i / X) * H(x, h),      H = sum of the heads of the players still in

The second term is the **pool rule**. Section 3 says what it assumes.

**Value with `d` future hands:** `V_d(x, h)` is the value, to each player, of the next hand at this table played as
the push/fold game of section 2 (the button one seat on, the blinds and antes of the study, players elsewhere keeping
their stacks), in which an outcome with stacks `y` and heads `h'` is worth `(bounty cash paid in it) + V_{d-1}(y, h')`.
If fewer than two players are left at the table, or a player would be all-in from posting, or (without bounties) the
prizes left are all equal for everybody still in, `V_d = V_0`.

The value of an outcome of the studied hand is `(bounty cash paid in it) + V_d` of the stacks and heads after it.

## 2. The push/fold game of a future hand

It is the game of the push/fold calculator this program has had since version 2 (`lib_pushfold.js`), ported to C++
operation for operation. It is a **simplified** game, and its simplifications are part of the model:

* Seats act in order. A seat that everybody folded to moves all-in or folds. After an all-in every later seat calls
  or folds; **the first caller ends the action** (there are no overcalls: every showdown is heads-up).
* A strategy is a frequency for each of the 169 starting-hand classes at each decision. Preflop all-in equities
  come from the exhaustive class-against-class table (`lib_eqdata.js`, 16-bit values).
* Card removal is exact between the two hands of a showdown and between an acting hand and the one range it faces;
  it is ignored otherwise (a fold tells nothing about the cards left).
* The equilibrium is found by a discounted regret-matching iteration with a fixed rule for when to stop (a gain below
  `1e-7` of the prizes and bounties in play, or 150 iterations when one future hand is simulated, 100 otherwise).
  **It stops close to an equilibrium, not at one.** Section 4 reports how close.

A future hand is always this game, whatever the studied hand is (a postflop spot, a preflop tree with raises). Future
hands with raises or postflop play are **not** simulated. That is the usual meaning of "future-game simulation" in
tournament tools, and it is a limit.

**Cost.** One outcome of the studied hand needs at most `(n + 1.5 n (n - 1))^(d - 1)` solutions of a future hand at a
table of `n`. The program refuses a study above 2,000: at most 5 future hands heads-up, 4 at a table of three, 3 at
four or five, 2 at six to eight. Solutions are kept and shared (they are a function of stacks and heads alone).

## 3. The pool rule: what it assumes and where it is exact

Every head still out is paid to somebody in the end: the winner of the tournament collects the one on himself, and
every other head is paid when its player busts (in a progressive knockout half at once and half later, through the
head it was added to). So the bounties in play, `H`, are money that will be distributed among the players still in.
The pool rule gives player `i` the share `x_i / X` of it.

* **Exact** in the sense of this model when two players are left and the chance to win the match is the chip share:
  the winner collects both heads. (`--selftest515` M3 checks the closed forms.)
* **An approximation** with three or more players. It ignores who covers whom, and that a short stack's own head is
  nearly lost money to him. Section 5 compares it with two other models on small tables.
* **Not a measurement.** No data of real tournaments went into it.

The rule replaces the rule of the push/fold calculator of 5.14 and earlier, which counted for each player only the
bounty on himself, times the chip share. That rule does not distribute the bounties in play (it leaves most of them
out), and heads-up it gives the winner of the match less than he collects. Results of the calculator with bounties
therefore change in 5.15 (CONVERGENCE-5.15.md, section 4).

## 4. Is the code the model? (rule R1 of the plan, written before the checks)

| Check | Bound | Result |
|---|---|---|
| a. Native program against the JavaScript mirror, 182 values of 23 requests | 1e-9 | largest difference **2.1e-14** |
| b1. Independent implementation, no future hand: ICM + bounty cash + pool rule (16 outcomes) | 1e-9 | **7.1e-15** |
| b2. Independent implementation, one future hand: the worth of every outcome of that hand (20 hands) | 1e-9 | **1.4e-13** |
| b3. Independent implementation: the program's values of a future hand = the expected values of its strategies (34 hands, one to five future hands) | 1e-9 | **4.3e-14** |
| b4. The most a player gains by deviating in a future hand, recomputed independently | 1e-3 of prizes and bounties | **3.2e-06** |
| c. Values sum to prizes plus bounties (requests in which every player is a study seat: 13 outcomes) | 1e-9 | **2.8e-14** |
| d. Linux, Wine and the hosted Windows runner print the same bits (`--selftest515` M1, 83 values) | identical | Linux and Wine: identical, Windows Server 2025 (hosted runner): identical |

What the three implementations share and do not share:

* The JavaScript mirror and the native program share the **algorithm** (the native one is a port). Their agreement
  checks the port. It says nothing about whether the algorithm is right.
* `tools/independent_tour515.py` was written from the definitions above. It shares no code with either. It computes
  the ICM by recursion over finishing orders, derives the stacks of every outcome of a future hand from the posting
  rules, and evaluates the reported strategies by direct summation over the hand classes. It does **not** solve the
  game: it checks that what the program reports is consistent with the game and nearly an equilibrium of it. With two
  or more future hands it takes the worth of the outcomes of the first future hand from the program (they are
  themselves solutions) and checks that hand.
* All three read the **same equity table**. An error in that table would not be found by any of them. The table has
  been in the program since version 2; 5.15 did not compute it and did not check it again.

Reference vectors for anyone who wants to check from outside: `validation/5.15/model/requests.json` (the requests),
`mwcli --tour515 <request.json>` prints 17 significant digits and the bit patterns.

## 5. How much does the bounty rule matter? (rule R4; information)

Compared: the expected bounty money each player collects from now on, on seven small tables, under the pool rule,
under the rule of 5.14, and under two reference models that do distribute the bounties but assume different things
about who busts whom:

* **mh**: finishing orders by Malmuth-Harville; the player busted next is knocked out by one of the players who
  finish above him, chosen in proportion to their stacks.
* **duel**: two players still in are chosen at random and play until one has all the chips of both, the chance in
  proportion to the stacks.

| Table (stacks; bounties) | Share | pool | mh | duel | 5.14 rule | largest difference pool-mh / pool-duel / mh-duel |
|---|---|---|---|---|---|---|
| hu (12, 8; 10, 10) | 1 | 60.0 40.0 | 60.0 40.0 | 60.0 40.0 | 30.0 20.0 | 0.0 / 0.0 / 0.0 |
| hu (12, 8; 10, 10) | 0.5 | 60.0 40.0 | 60.0 40.0 | 60.0 40.0 | 30.0 20.0 | 0.0 / 0.0 / 0.0 |
| three-even (10, 10, 10; 10, 10, 10) | 1 | 33.3 33.3 33.3 | 33.3 33.3 33.3 | 33.3 33.3 33.3 | 11.1 11.1 11.1 | 0.0 / 0.0 / 0.0 |
| three-even (10, 10, 10; 10, 10, 10) | 0.5 | 33.3 33.3 33.3 | 33.3 33.3 33.3 | 33.3 33.3 33.3 | 11.1 11.1 11.1 | 0.0 / 0.0 / 0.0 |
| three-uneven (4, 12, 30; 10, 10, 10) | 1 | 8.7 26.1 65.2 | 7.1 25.6 67.2 | 9.9 28.9 61.2 | 2.9 8.7 21.7 | 2.0 / 4.0 / 6.0 |
| three-uneven (4, 12, 30; 10, 10, 10) | 0.5 | 8.7 26.1 65.2 | 7.9 25.9 66.2 | 9.3 27.5 63.2 | 2.9 8.7 21.7 | 1.0 / 2.0 / 3.0 |
| three-big-head-short (4, 12, 30; 30, 10, 5) | 1 | 8.7 26.1 65.2 | 7.8 24.6 67.7 | 9.5 31.8 58.7 | 5.8 5.8 7.2 | 2.4 / 6.5 / 8.9 |
| three-big-head-short (4, 12, 30; 30, 10, 5) | 0.5 | 8.7 26.1 65.2 | 8.2 25.3 66.4 | 9.1 29.0 62.0 | 5.8 5.8 7.2 | 1.2 / 3.3 / 4.5 |
| four (4, 20, 15, 11; 10, 10, 25, 5) | 1 | 8.0 40.0 30.0 22.0 | 5.9 42.7 30.4 21.0 | 9.0 37.7 30.0 23.3 | 1.6 8.0 15.0 2.2 | 2.7 / 2.3 / 5.0 |
| four (4, 20, 15, 11; 10, 10, 25, 5) | 0.5 | 8.0 40.0 30.0 22.0 | 6.8 41.4 30.2 21.5 | 8.5 38.8 30.0 22.7 | 1.6 8.0 15.0 2.2 | 1.4 / 1.2 / 2.6 |
| five (10, 25, 14, 8, 30; 10, 6, 14, 12, 8) | 1 | 11.5 28.7 16.1 9.2 34.5 | 9.7 30.5 15.1 7.3 37.5 | 13.2 27.4 17.4 10.7 31.3 | 2.3 3.4 4.5 2.2 5.5 | 3.0 / 3.2 / 6.2 |
| five (10, 25, 14, 8, 30; 10, 6, 14, 12, 8) | 0.5 | 11.5 28.7 16.1 9.2 34.5 | 10.4 29.8 15.5 8.1 36.3 | 12.4 28.0 16.8 10.0 32.8 | 2.3 3.4 4.5 2.2 5.5 | 1.8 / 1.7 / 3.4 |
| five-even (20, 20, 20, 20, 20; 10, 10, 10, 10, 10) | 1 | 20.0 20.0 20.0 20.0 20.0 | 20.0 20.0 20.0 20.0 20.0 | 20.0 20.0 20.0 20.0 20.0 | 4.0 4.0 4.0 4.0 4.0 | 0.0 / 0.0 / 0.0 |
| five-even (20, 20, 20, 20, 20; 10, 10, 10, 10, 10) | 0.5 | 20.0 20.0 20.0 20.0 20.0 | 20.0 20.0 20.0 20.0 20.0 | 20.0 20.0 20.0 20.0 20.0 | 4.0 4.0 4.0 4.0 4.0 | 0.0 / 0.0 / 0.0 |

All numbers in percent of the bounties in play. The first three columns of values each sum to 100; the 5.14 rule does not (it leaves the rest of the money out).

**Outcome by the rule written beforehand:** On every table the pool rule is within 10% of the bounties in play of both reference models. The two reference models agree with each other within 10% on every table. Largest differences: pool against mh 3.0, pool against duel 6.5, mh against duel 8.9; the rule of 5.14 is up to 58 away from the pool rule.

Read with care: the two reference models are models too. That the pool rule lies near them says that it is a
reasonable member of a family of simple models, not that the family is right.

## 6. What is proven, tested, untested

| Statement | Status |
|---|---|
| The values add up to prizes plus bounties | follows from the definitions (ICM distributes the prizes, the pool rule the heads, cash is paid from a head); tested (section 4 c) |
| Heads-up the model pays the winner of everything the first prize and both bounties | follows from the definitions; tested (`--selftest515` M3) |
| The native code computes the model of sections 1 and 2 | tested against an independent implementation on 50 outcomes; not proven |
| A future hand's solution is an equilibrium of the push/fold game | **no**: it is within 3.2e-06 of the unit of one on the tested hands; the stopping rule guarantees nothing tighter |
| The value of an outcome does not depend on threads, on the order in which future hands are solved, or on what was solved before | by construction (a solution is a function of its key; the key holds the exact stacks and heads); tested (`--selftest515` T2, ThreadSanitizer run) |
| Training under the model converges | tested on small exact games (CONVERGENCE-5.15.md, rule R2); the trainer is the trainer of 5.14 and has no guarantee for more than two seats |
| The pool rule is the right value of a bounty | **not established**; a model (section 3 and 5) |
| Push/fold future hands are the right model of the next hands | **not established**; a common simplification |
| More future hands are more accurate | **not established**; CONVERGENCE-5.15.md reports only how much the values move |
| Anything on the target PC | untested |
