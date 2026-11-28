# EightMax Windows 5.18

Build `23205cbc12cae290`. Successor of 5.17 (`6efe7970626b6460`). This is **Phase 8** of the ten-phase plan: bet sizes
outside the tree. Map a size the tree does not have onto the sizes it has, and measure how much results move when a
size is added.

**The short version.**

* **A size outside the tree can now be mapped onto it**, by one rule in three variants, from the command line and in
  the strategy explorer. The program shows which solved size (or which two, with weights) a real bet is taken as.
* **A solved strategy can now be scored against a size it was not solved for.** `mwcli --translate` writes it as a
  strategy of the game with the size added; the exact best response of 5.17 then says what it loses there. This is
  what made the measurement possible.
* **What the measurement says: mapping is not a substitute for solving with the size.** A strategy solved without a size loses 3.2 to 16.2 percent of the pot a player to it when the size lies outside the tree's sizes (ten cases, three games, exact numbers, against the best use of that size). More training of the same tree does not remove it.
* **Between two tree sizes, blending the two neighbours is far better than choosing one.** With the size between two tree sizes: 1.7 to 4.4 percent when one neighbour is chosen, 0.28 to 0.31 when both are blended (two cases, one game; a second game added afterwards: on its two between-sizes blend costs 0.49 and 0.05% of the pot a player, harmonic 4.81 and 4.10, nearest 6.14 and 2.26). That is
  why `blend` is the default.
* **Solving with the size, for the same time, is better than mapping.** Lower exploitability in all five seeds on 23 of 36 comparisons against the threshold rules and on 22 against blend; against blend, mapping was ahead on 0. Thirteen of the 36 were left out because the two runs did not get the same time within 15 percent. One exception, in the game added afterwards: for an added raise size between two tree sizes, the blended strategy was less exploitable than the directly solved one in all five seeds.
* **When a size is added, the first decision changes; the value of the game does not move measurably.**
  The first decision changes on 10 of 12 added sizes (up to 23 points an action); the exact brackets of the game value overlap in 60 of 60 cases.

No trainer changed, no grouping changed, no evaluator changed, no default of a study changed. Every study trains to
the states of 5.17.

First thing to do on your PC: **WINDOWS-TESTS-5.18.md**. Reports: FINAL-REPORT-5.18.md, CONVERGENCE-5.18.md (the
comparisons), MATHEMATICAL-VALIDATION-5.18.md, VALIDATION-5.18.md, BUILD-5.18.md.

## What is new

### 1. The rule

A bet or raise is taken as a fraction of the pot (a raise: of the pot after the call). A fraction x between two
tree sizes A < B is mapped by one of:

| Rule | Mapped to |
|---|---|
| `nearest` | the closer of A and B |
| `harmonic` | A if f >= 1/2, else B, with f = (B - x)(1 + A) / ((B - A)(1 + x)) |
| `blend` (default) | A with weight f and B with weight 1 - f |

Below the smallest tree size a bet is taken as the smallest, above the largest as the largest. Fold, call and check
are never mapped. The rule is `map-5.18-v1`; f is the pseudo-harmonic mapping of Ganzfried and Sandholm (2013).

### 2. A line of real actions: `mwcli --offtree`

    mwcli.exe --offtree <spec.json> <request.json>
    {"mapping":"blend","actions":["check", {"pot":0.66}, 12, "call"]}

An action is `"fold"`, `"call"`, `"check"`, `"next"` (the next street), a number (a bet or raise **to** that many
chips on this street), or `{"pot":f}`. The answer gives, step by step, the tree action or actions each real action
was taken as, and at the end the tree paths with their weights. Those paths are what `mwcli --node` and the
explorer take, so the solved strategy at the end of a real line can be read.

Two things to know. After a mapped bet the tree's pot is not the real pot; both are reported. And if a bet is mapped
onto the tree's all-in, the tree's hand is over while the real one continues; the answer then says how much of the
line has no tree node (`weightWithoutATreeNode`).

### 3. The strategy explorer

In the desktop program (Multiway, a study opened on the desktop, "Explore strategy") there is a field under the
action buttons: **"A size the tree does not have: bet to ..."**. Type the amount, choose the rule, "Map onto the
tree". The tree sizes it is taken as appear as buttons with their weights; a click follows that action. The field
maps one bet at the node shown, with the tree's pot.

### 4. A strategy in another tree: `mwcli --translate`

    mwcli.exe --translate <spec A> <state A> <spec B> <out state> [nearest|harmonic|blend] [memoryMiB]

A is a trained study, B the same game with other bet sizes (same seats, stacks, pot, board, ranges and hand
grouping). The output is a state of B that holds A's strategy: every decision of B is answered with what A does at
the decision the rule leads to. Any number of seats; any street. Then

    mwcli.exe --gain <spec B> <out state> {"method":"exact-hu"}

gives the exact exploitability of A's strategy in B: against an opponent who may use B's sizes. The program reports
how many actions of B had no exact counterpart in A, and how many branches of B have no source at all.

## Checkpoints

* **Trained states: unchanged.** Same bytes as 5.17, header included.
* **A translated state** is an EMMW4 file like a trained one, with three more header fields and a study identifier
  of its own:

      "studyId":"t518-<16 hex>","translated":"map-5.18-v1","mapping":"blend","translatedFrom":"<study of A>"

  * 5.18 loads it for evaluation (`--gain`, `--ev`, `--node`) and **refuses to train from it**, with the reason:
    it holds a strategy and no regrets.
  * The programs of **5.10 to 5.17 refuse it** ("State belongs to a different study"), for evaluation and for
    training. Tested with the programs of 5.17, 5.16, 5.15, 5.14, 5.13, 5.12, 5.11, 5.10.
  * The JavaScript engine of the page refuses it with the reason.
  * A header whose rule or source was altered no longer fits its identifier and is refused.
* **Old checkpoints** load and continue as before; nothing about them changed.

## What did not change

* **Training.** 225 configurations and 224 fixture cases, 0 differences to the same bytes; the self-tests of 5.7 to 5.17 pass with their recorded tables
  untouched.
* **The evaluation methods** (`exact`, `exact-hu`, `restricted`, `sampled`): same code, same numbers; the recorded
  bits of 5.17 are reproduced.
* **The fixtures, the libraries, CUDA, OpenCL.**

## Limits

* **The cost of a missing size was measured for two seats, postflop, chip values, one size added at a time.** For
  three or more seats, preflop studies and tournament payoffs the tools run and nothing was measured, because no
  exact best response exists at that size.
* **`blend` is an interpolation.** It is not the strategy that draws one of the two sizes once and then follows it;
  that one was not built (MATHEMATICAL-VALIDATION-5.18.md, section 2).
* **Outside the tree's range of sizes there is one rule, not three.** A bet below the smallest size is taken as the
  smallest; it is never taken as a check.
* **The explorer field maps one bet at one node.** It does not carry the real pot along a line; `mwcli --offtree`
  does.
* **Nothing is re-solved.** 5.18 does not add a size to a solved study and continue training; it tells you what the
  missing size costs and what the solved strategy says about the nearest sizes.

## Files

`EightMax-Windows-5.18.zip` (about 95 MiB). The second archive of 5.12, `EightMax-5.12-evidence-2.3-to-5.8.zip`, is
unchanged and not delivered again. Linux programs of this build, for reference: `linux-bin/` beside the ZIP.

`mwcli.exe --selftest518 validation\5.18\windows\offtree <folder> all` is the self-test of this release;
`validate_windows518.ps1` is the 5.17 script with one section added.
