# EightMax 5.17: what is computed, and why the CPU and the GPU must agree to the bit

Build `6efe7970626b6460`. Algorithm identifier `brhu-5.17-v1`. Source: `native/brhu_kernel.h` (the items),
`native/brhu517.hpp` (the streets before the river, the tables, the order of the final sums),
`native/brhu_ocl.hpp` (the device).

## 1. The quantity

Two seats, a study that starts on the flop, turn or river, chip utility. Fix the stored strategy sigma (the average
strategy, or the current one). For a seat s with opponent o:

* **policy value** V_s(sigma): the expected chips of s when both follow sigma;
* **best-response value** B_s(sigma): the largest expected chips s can get with any strategy of its own that
  depends only on what s knows (its two cards, the board, the betting), while o follows sigma;
* **gain** B_s - V_s, and **NashConv** = gain_0 + gain_1. With two seats and chips this is twice the exploitability.

The expectation is over the two hands (range weights, without the hands that share a card with each other or with
the board) and over the cards still to come, each equally likely among the cards neither hand nor the board holds.
The responder sees real cards: a hand grouping only decides which stored row a hand reads its strategy from. This is
the quantity method `exact` has computed since 4.0 and that Phase 6 used as its measure.

## 2. The algorithm

**Per hand, unnormalised.** For a node n, a board b and the opponent's reach r (for every opponent hand: its range
weight times the probability that the opponent took the actions leading to n with that hand), define for every own
hand h

    u(n, b, r)[h] = sum over opponent hands g that share no card with h or b of r[g] * (value of the subtree for h against g)

once for the best response and once for the policy. Then:

* at a decision of the opponent with action probabilities p_a(g): u = sum over a of u(child_a, b, r * p_a);
* at a decision of the responder: best response: the maximum over a, taken separately for every h (h is what the
  responder knows, together with n and b); policy: sum over a of p_a(h) * u(child_a);
* at a card: u = (sum over the cards x not on the board of u(child, b + x, r without the hands that hold x)[h], for
  the h that do not hold x) / (52 - cards on the board - 4). The divisor is the number of cards neither hand nor
  the board holds; it is the same for every pair of hands, which is why it can be taken out of the sum;
* at a fold: u[h] = (utility) * mass(h), mass(h) = the reach of the opponent hands that share no card with h;
* at a showdown: u[h] = win(h) * U_win + tie(h) * U_tie + lose(h) * U_lose, where win(h) is the reach of the
  compatible opponent hands that h beats, and so on.

The root values are sum over h of w_h * u(root)[h], divided by Z = sum over compatible pairs of w_h * w_g. That the
maximum may be taken per hand inside the sum over opponent hands is the statement that (h, n, b) is the responder's
information set and that its choice there does not affect what it gets elsewhere (perfect recall).

**Terminals in one pass.** mass(h) = T - C[first card of h] - C[second card of h] + r[the same two cards], with T
the total reach and C[c] the reach of the hands that hold c: an opponent hand shares a card with h exactly when it
holds one of h's two cards, and only the identical hand holds both and is subtracted twice. win(h) is computed the
same way over the opponent hands sorted by strength, taking the running total and the running per-card totals at
the point where the opponent's strength reaches that of h; lose(h) by the same sweep from the top;
tie(h) = mass(h) - win(h) - lose(h). This replaces a sum over all opponent hands for every own hand by one sweep.

**The split into items.** Everything below a river card (or, for a river study, below the root) on one complete
board is one item: a small tree without chance. The streets above are walked on the host. For a flop study there
are 49 * 48 complete boards and (river subtrees reached) * 49 * 48 items.

## 3. Agreement with method `exact`

Method `exact` computes the same expectation hand by hand: for every own hand it walks the whole tree and sums over
the opponent's hands at each terminal. The two differ only in the order in which the same products are added, so
they must agree to rounding. They do: On 66 evaluations where both finish, every value agrees within the bound of 1e-9 relative; the largest difference seen is 2.9e-14 (CONVERGENCE-5.17.md, section 2). An independent program
(`tools/independent_br48.py` of 4.8: its own tree, hand evaluator and pot settlement, every card enumerated, no code
shared with the engine) agrees with exact-hu as well: 5 of 5 games agree within 1e-9.

Where method `exact` does not finish (both whole-range flops, and a whole-range turn with two bet sizes and a
raise), no second computation of the same number exists. What supports the result there: the same code paths agree
on every game where a comparison exists, including a flop with about 80 hands a seat and turns with 1128; and the
checks of section 5. **It is not proven by comparison at that size**, and this is said wherever such a number is
reported.

## 4. Why the CPU and the GPU must give the same bits

An item is worked by one thread from its first statement to its last, on the CPU and on the GPU, and it writes only
to its own scratch and its own output. So the question is only whether one thread running `brhu_item` computes the
same doubles in both places. It does, provided three things hold:

1. **The same statements.** The CPU path is `brhu_kernel.h` compiled into the program. The GPU path is the text of
   the same file handed to the OpenCL compiler of the driver. A regression test compares the embedded text with the
   file.
2. **The same operations.** The item uses +, -, *, / and comparisons on IEEE-754 doubles, with round-to-nearest,
   and no library function. Each of these has exactly one correct result in IEEE 754, so two conforming
   implementations agree. Sums run in the index order written in the file; the kernel never asks for a parallel
   reduction.
3. **No fusing.** A compiler may replace a*b+c by one fused operation that rounds once instead of twice, which
   changes the last bit. On the CPU the build forbids it (`-ffp-contract=off`, and the x86-64 baseline has no fused
   instruction). On the device the kernel asks for it to be off (`#pragma OPENCL FP_CONTRACT OFF`, no relaxing
   compiler option) and, because a pragma is a request, every product that feeds a sum has its bits XOR-ed with a
   zero that is read from a buffer at run time: the compiler cannot know it is zero, so it has no product left to
   fuse.

What the host adds afterwards (the items of a group in the order of their river cards, the division, the streets
above) is the same code for both paths.

**This is an argument, not a proof about a driver.** Point 2 assumes the device's arithmetic conforms to IEEE 754
for doubles, including results near zero. So the program does not rely on it:

* **the probe**: before a device is used, it computes 20,480 values (products whose exact value is not a
  double, a product followed by a sum, sums with cancellation, differences, quotients, subnormal results) and each
  must have the bits the CPU computes; otherwise the device is refused;
* **the repetition**: every 16th item and the first of every batch (every item with `"brDevice":"both"`) is worked
  again on the CPU; both values of every hand and the two counters must have the same bits; one difference and the
  request fails without reporting a value.

Both guards were shown to be able to fail: the unprotected kernel is refused by the probe on the test device, which fuses; one altered bit of a device result fails the request.

## 5. One result for every way of running it

The values of a seat are a function of the items' outputs added in a fixed order. Which thread works an item, how
many items share a batch, and which device works it do not enter. Measured: 624 of 624 runs (2, 3 and 4 threads; `brDevice` gpu and both; device batches of 48, 64 and 4096) have the bits of one CPU thread.

## 6. What follows from the definitions, what was tested, what was not

* **Follows from the definitions:** the recursion of section 2 computes the quantity of section 1; mass, win, lose
  and tie as written count each compatible opponent hand once; the result does not depend on thread count or
  batching.
* **Tested:** agreement with method `exact` and with the independent program wherever those finish; the bits
  across threads, batches and the OpenCL device available (a CPU implementation); the same bits from the Windows
  executable under Wine and on a hosted Windows runner (CPU path); the two guards.
* **Not established:** the values of games on which method `exact` does not finish, other than by the points of
  section 3.
* **Untested:** an NVIDIA GPU. Whether its OpenCL compiler and its arithmetic meet points 2 and 3 is exactly what
  the probe and the repetition check on the target PC.
