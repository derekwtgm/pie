# EightMax 5.13: mathematical validation of the satellite payoff models

Two things are called "satellite" in 5.13 and they have different standing.

| | What it is | Standing |
|---|---|---|
| Satellite with at most 16 players | the program's existing ICM (Malmuth-Harville, exact finishing-set recursion) with N equal prizes | nothing new: a payout table |
| Satellite with a larger field, `satfield-5.13-v1` | a new way to COMPUTE the same quantity - the Malmuth-Harville probability of finishing in the top N - for a field of any size | sections 1 to 3 prove the formula; section 4 bounds what is not exact; section 5 says what is tested |

Neither is a statement about real tournaments. Malmuth-Harville is a model: it says a player with a share s of the
chips wins with probability s, and applies the same rule again to the players who remain. Everything below is
"exact under that model". No number in this release is a percentage of GTO.

## 1. The model as a ranking with weights

Players 1..n hold stacks s_1..s_n > 0. Malmuth-Harville draws the finishing order from first place down: first
place is player i with probability s_i / S (S the sum of all stacks); given the players already placed, the next
place goes to each remaining player j with probability s_j divided by the sum of the remaining stacks. The
probability of a complete order (i_1, i_2, ..., i_n) is therefore

    P(i_1, ..., i_n) = prod_{k=1..n} s_{i_k} / (s_{i_k} + s_{i_{k+1}} + ... + s_{i_n}).          (1)

This is the Plackett-Luce ranking distribution with weights s.

## 2. Exponential clocks give the same distribution

**Claim.** Let T_1, ..., T_n be independent, T_j exponential with rate s_j. Ties have probability 0. The order of
the players by increasing T has distribution (1).

**Proof.** The minimum of independent exponentials with rates s_j is exponential with rate S, it is T_i with
probability s_i / S, and - this is the memoryless property - given that the minimum is T_i = t, the remaining
differences T_j - t (j != i) are again independent exponentials with rates s_j. So the first place is i_1 with
probability s_{i_1} / S, and conditionally on that, the remaining players are in the situation of the claim with
one player fewer. Induction on n gives (1). []

## 3. The probability of a seat as one integral

A satellite awards a seat to the first N places. By section 2, player i wins a seat exactly when fewer than N of
the other players have a smaller clock:

    {i in the top N} = { C_i(T_i) <= N - 1 },   C_i(t) = #{ j != i : T_j < t }.

T_i is independent of the other clocks and has density s_i exp(-s_i t). Conditioning on T_i = t:

    P(i in the top N) = Int_0^inf s_i exp(-s_i t) P( C_i(t) <= N - 1 ) dt.                          (2)

For fixed t the events {T_j < t} are independent with probabilities p_j(t) = 1 - exp(-s_j t), so C_i(t) is a sum of
independent indicators (a Poisson-binomial count). Its distribution is computed exactly by adding the players one
at a time: d'(c) = d(c) (1 - p_j) + d(c - 1) p_j. Only the probabilities of the counts 0 .. N-1 are needed, so the
table is cut off at N.

Multiplying every stack by the same constant does not change (1), so the program divides all stacks by the mean
stack of the field before using them as rates. []

**A check that follows from (1):** exactly N players finish in the top N, so the probabilities (2) of all players
add up to N. The program's values do (section 5).

**Players without chips.** A player who has lost all chips has finished behind every player who still has chips.
The model requires more players with chips at the other tables than there are seats, so no seat is left for him:
his value is 0. (With 16 players or fewer the ordinary ICM of the program ranks simultaneous losers by their stacks
at the start of the hand and may pay them; in a field larger than the number of seats plus the table that case
does not arise.)

## 4. What the program computes, and what is not exact

**(a) The field does not move.** In (2) the stacks of the players at other tables are the ones entered, for every
outcome of the hand. That is the same assumption the ordinary ICM of the program makes for "other players' stacks";
it is an assumption about the hand, not a numerical error.

**(b) Quadrature.** The integral is taken in y = t / (t + tau), tau = the time by which N field players are
expected to have finished, with 8-point Gauss-Legendre on M = min(256, max(64, 8 ceil(sqrt N))) equal panels and 20
further panels halving towards each end. The last panel (y within 2^-20 / M of 1) is dropped. What is dropped is at
most the probability that fewer than N of the K > N field players have a clock below t* = tau M 2^20, which is at
most (K choose K-N+1) exp(-(K-N+1) s_min t*) for the smallest field rate s_min: zero in double precision unless a
field stack is smaller than about 1e-5 of the mean. No bound for the quadrature error of the remaining panels is
proven; it is MEASURED (section 5): at most 2.2e-14 against exact rational arithmetic on 240 small fields, and at
most about 2e-10 against an independent integration on 42 fields of up to 5,000 players, where the independent
integration itself is only known to about 3e-9.

**(c) The exponential.** exp(x) for x <= 0 is computed as 2^k p(r) with k = round(x / ln 2), r = x - k ln 2 (ln 2
split in two constants) and p the Taylor polynomial of degree 13, |r| <= 0.347; the remainder of the series is
below 0.347^14 / 14! = 4e-18. Measured against the library exponential on 200,001 points of [-700, 0]: relative
difference at most 2.3e-16. It uses IEEE additions, multiplications, divisions and one exact scaling only, so a
platform that implements IEEE-754 double arithmetic computes the same bits; that is why Windows and Linux builds
write the same states (tested, not proven for every compiler).

**(d) What a user does not know.** (2) needs every stack of the field. Entering "K players with the average stack"
is a different field. How different is measured in VALIDATION-5.13.md, section 5: up to 35 points of seat
probability in 36 synthetic fields. This is the approximation that matters in practice, and it is not small.

## 5. Tested

| Check | Result |
|---|---|
| (2) by the program against exact rational Malmuth-Harville values (finishing-set recursion in Python fractions), 240 fields of at most 12 players | largest difference 2.1e-14 |
| the same against the program's own exact recursion (`icm.hpp`) in-process, 400 fields of 3 to 16 players | largest difference 7.2e-15 (`mwcli --selftest513`, M2) |
| against an independent integration (composite Simpson in the same variable, library exponential, step halved), 42 fields of 50 to 5,000 players | largest difference 2.0e-10; the reference's own two step sizes differ by up to 3.0e-09 |
| values of all players add up to N | relative error at most 2.0e-15 (same fields); 1.7e-15 in `--selftest513` M3 |
| 1,000,000 sampled finishing orders (exponential clocks), 5 fields | the program's value inside the 99.9% interval in every case |
| one bubble spot under the ordinary ICM with six equal prizes and under the field model | exact action values equal to 4.4e-16, exact NashConv to 5.6e-17 (`--selftest513`, K3) |
| JavaScript mirror against the native program | the same bits in 30 fields (`tests/v513.test.js`) |
| Windows program against the Linux program | the same bits and the same trained states (Wine and Windows Server 2025; the target PC is untested) |

A note on the third row: the first version of my independent integration used the variable u = exp(-t / tau). Its
own two step sizes differed by 2e-8, more than the 1e-8 the rule allowed the program, so it could not judge the
program. I replaced the reference's variable (not the program) and say so here; the rule itself was not changed.

## 6. Two closed forms used as fixtures

**Folding aces (`sat3-fold-aces`).** Three players, two seats. Button 2 BB (folds), small blind 30 BB moves all-in
with kings, big blind 25 BB holds aces. After a fold the stacks are 23.9 / 31.2 / 1.9 and the big blind's value is
v(23.9; 31.2, 1.9) = 0.94082. After a call he has 50.1 against 5 and 1.9 with probability w (aces win), 25.05
against 30.05 and 1.9 with probability z (tie), and nothing otherwise: w v(50.1; 5, 1.9) + z v(25.05; 30.05, 1.9) =
0.80920, with w and z from all 1,712,304 boards. Folding is worth 0.1316 more although the aces win 82% of the time.
The program's exact action values equal these to 1e-12 (fold) and 1e-9 (call); the equity was enumerated with the
JavaScript evaluator, the ICM values with a recursion written for the test.

**A mixed river spot (`known-sat-akq-river`).** Three players, two seats; the third has 12 BB and is not in the
hand. Pot 10, stacks 10 and 10; seat 1 holds aces (weight 1/4) or queens (weight 1), seat 2 kings. F = v(10; 20, 12)
= 0.54978 is the value of folding (and of queens that check and lose); B = v(20; 10, 12) = 0.81548 the value of a
bluff that works; a player who wins the all-in is one of two left for two seats (value 1), the loser has 0. The
kings are indifferent when 4q / (1 + 4q) = F, i.e. the queens bet with q = F / (4 (1 - F)) = 0.3053; the queens are
indifferent when the kings call with c = 1 - F / B = 0.3258. In the chip game the same ranges give q = 1/4, c = 1/2.
After 2,000,000 deals the program's kings call 0.3261 of the time and the value of folding is F to 1e-12. (With
aces and queens equally likely there is no mixing: 1/2 < F, so the kings fold even to a bettor who always bets.
That was my first version of the fixture; the program found the pure solution and I changed the weights.)
