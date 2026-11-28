# EightMax 5.18: bet sizes outside the tree, what is defined and what follows

Build `23205cbc12cae290`. Identifier `map-5.18-v1`. Source: `native/map518.hpp` (the rule), `native/translate518.hpp`
(the translation and the line lookup), `web/lib_offtree.js` (the mirror of the rule).

## 1. The rule

A bet or raise is measured as a fraction of the pot. For a bet: amount / pot. For a raise: (amount above the call)
/ (pot after the call). That is how the tree's own sizes are defined, so a tree size of "66%" has the fraction 0.66
at every node where it is not cut by the stack.

Let the tree's sizes at a node be A1 < A2 < ... and let x be a size it does not have.

* x below A1 is mapped to A1; x above the largest to the largest; x within 1e-9 of a tree size is that size.
* Between neighbours A < x < B, with f = (B - x)(1 + A) / ((B - A)(1 + x)):
  * **nearest**: A if x - A <= B - x, else B.
  * **harmonic**: A if f >= 1/2, else B.
  * **blend**: A with weight f, B with weight 1 - f.

f is the pseudo-harmonic mapping of Ganzfried and Sandholm (2013). f = 1 at x = A, f = 0 at x = B, f falls in
between, and f = 1/2 at x* = (A + B + 2AB) / (A + B + 2). Because x* is below the midpoint (A + B) / 2 whenever
A < B, nearest and harmonic give different answers exactly for x between x* and the midpoint. The self-test checks
these four statements and a table of 192 recorded rows bit for bit; the JavaScript mirror is compared with the same
table.

**What the rule does not do.** A bet below the smallest size is never taken as a check, and a raise is never taken
as a call unless the tree has no raise at all at that node. An all-in is a size like any other: a bet that is not
all-in can be mapped onto the tree's all-in, and then the tree's hand is over while the real one goes on (section 3).

## 2. What a translated strategy is

Let A be a trained study and B the same game with other bet sizes. `mwcli --translate` defines a strategy of B from
the average strategy of A by walking both trees together. A node of B carries a list of nodes of A with weights.

* **Moving.** An action of B moves every listed node of A: fold to fold, call or check to call or check, a bet or
  raise of fraction x to the node(s) the rule gives. Under nearest and harmonic the list has one node. Under blend
  it can have two after one mapped bet, four after two, and so on; equal nodes are merged.
* **Answering.** At a node of B where seat p acts, with listed nodes m1, m2, ... of weights w1, w2, ... where p acts
  as well, the probability of action b for a hand h is

      sum_i w_i * sum_{a realised as b} sigma_A(a | m_i, h)  /  sum_i w_i     (over the i for which A has a row for h)

  An action a of A is realised as: fold as fold, call or check as call or check, a bet or raise as the size of B
  that the rule gives for a's fraction (always one size; blend uses the harmonic threshold for this direction).
* **Row keys.** The row of a hand has the same key in A and in B: no hand grouping of the program looks at the
  betting: a key is a function of the cards, the board and the seat's range (`native/es_groups.hpp`). The keys are
  copied byte for byte.

**Blend is an interpolation, not a randomisation.** The usual meaning of a randomised mapping is: draw A or B once,
with probabilities f and 1 - f, and from then on play A's strategy for the drawn size. That strategy remembers its
draw. Written as a behaviour strategy of B it needs, at every later decision, the probability of each draw *given
what this hand did since*, and that depends on the hand's cards on earlier streets, not only on its key now. A
table with one row per (node, key) cannot hold it. `blend` here uses the fixed weights f and 1 - f at every later
decision instead. The two agree at the first decision after the mapped bet and differ afterwards. **Nothing in this
release measures the draw-once strategy.**

## 3. What follows, and what does not

Let sigma be A's strategy and tau its translation into B, where B has every size of A and one more.

**(a) Where B's history uses only sizes of A, tau plays sigma.** Along such a history every action has an exact
counterpart, the list holds one node with weight 1, and the realisation is the identity. For those nodes the
translator copies A's sums unchanged. Consequence: translating a study into itself gives every evaluator the same
doubles. *Tested:* the bits of the source, for each rule, in the self-test (12 of 12) and in every unit of the
measurement.

**(b) No seat's best response is worth less in B than in A.** A best responder in B may confine itself to A's
sizes; by (a) it then meets sigma, and tau itself never chooses the added size, so the value of the profile is the
same. Hence value_B(tau) = value_A(sigma) for every seat, and gain_B >= gain_A for every seat, for any number of
seats and any rule.

**(b) needs one condition that the first version of the plan missed.** Where A has no row for a hand, an evaluator
uses its fallback, by default the uniform strategy over the node's actions. B's node has one more action, so the
uniform fallback is a different strategy in B and plays the added size. Then (a) fails at those hands and (b) with
it, by about 1e-8 of the pot in the cases seen. With a fallback that is the same strategy in both trees
("callCheck") the statement holds, and that is how it is checked (plan, amendment 1). *Tested:* a strategy in its own tree has the bits of the source in 135 of 135 cases; with a size added and the same fallback in both trees, no seat gains less and every policy value is the same in 540 of 540.

**(c) What the cost measures.** NashConv_B(tau) - NashConv_A(sigma) is what the seats can gain together, beyond
what they could already gain, because the added size exists and tau answers it through the rule. It is an exact
number for two seats (method exact-hu). It is not the loss against an opponent who uses the size in a balanced way;
it is the loss against the best use of it.

**(d) Nothing says the cost is small.** No theorem bounds it. A strategy solved without a size has no reason to
defend well against it, and the measurement finds that it does not (CONVERGENCE-5.18.md).

**(e) What does not follow.**
* That blend is the best interpolation, or that the weights f are the best weights. They are one published choice.
* Anything for a size below the smallest or above the largest: there the three rules are the same rule.
* Anything about three or more seats beyond (a) and (b): the cost there was not measured (no exact best response
  over whole ranges for three seats).

## 4. Where the source has nothing to say

* **The source's hand is over.** If a bet of B is mapped onto an all-in of A and called, A's tree ends; B's goes on
  to the next street. B gets no rows there. The same happens when A's tree ends for any other reason before B's.
* **The source cannot raise.** If B allows a raise where A does not, the raise is taken as a call.
* **The source never visited the node.** No rows.

In all three cases an evaluator uses its fallback and counts the lookups; `mwcli --translate` reports how many
branches of B have no source node, and `mwcli --offtree` reports the weight of a line for which the tree has no
node (`weightWithoutATreeNode`).

## 5. The file

A translated state is an EMMW4 state of B. Its rows hold zeros for the regrets and the translated probabilities
(or, at the nodes of (a), A's sums) as average-strategy sums. Its header names the algorithm, the rule and A's study
identifier, and its own study identifier is a hash of B's identifier, the rule, A's identifier and `map-5.18-v1`.

* An earlier program compares the identifier with the spec's and refuses the file. *Tested* with the programs of
  5.10 to 5.17.
* 5.18 recomputes the identifier from the header fields and the spec; a file whose fields were altered no longer
  fits. *Tested.*
* 5.18 refuses to train from the file, because zeros are not regrets. *Tested.*
* The file is a function of A's state, the two specs and the rule: no clock, no thread count, rows in key order.
  *Tested:* the SHA-256 recorded on Linux, on Linux, under Wine and on the hosted Windows runner.
