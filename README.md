# Hidden Bit

## What It Is

Hidden Bit is a browser lab for the experiments behind IND-CPA, IND-CCA2, EUF-CMA, strong unforgeability, the PRP/PRF switching lemma, adjacent-hybrid proofs, and hard-core predicates. It runs real AES-128 ECB/CBC/CTR/GCM, RSA-2048 textbook/OAEP/PSS, ristretto255 ElGamal, secp256k1 ECDSA, and Ed25519 operations, then measures each named adversary with the definition

$$
\operatorname{Adv}(A)=2\frac{\text{wins}}{\text{trials}}-1.
$$

AES CBC/CTR/GCM and RSA OAEP/PSS use WebCrypto with SHA-256 where the RSA construction requires it. RSA keys are generated once as extractable JWK material, so the same $n$, $e$, and $d$ also drive the inspectable textbook-RSA arithmetic. ElGamal, ECDSA, Ed25519, and AES-ECB use the audited Noble packages; ristretto255's hash-to-group uses SHA-512. [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers) is used for ECB because WebCrypto deliberately does not expose that unauthenticated mode; the implementation is still checked against FIPS 197.

The switching game's ideal permutation and ideal function are faithfully lazy-sampled mathematical oracles. Its GGM tree uses real AES block evaluations and a deliberately insecure comparison generator; it is a construction lesson, not a sampled security game. A separate proof lesson walks five adjacent AES hybrids, contrasts an exposed input predicate with the Goldreich–Levin inner product, and runs a bounded Rackoff-style reconstruction whose candidates are independently rehashed. This is not production crypto: keys live only in browser memory, deliberately vulnerable choices are teaching fixtures, trial counts are finite, and the interface exposes values a production system would hide.

## Exhibits

1. **Hidden-bit IND-CPA game.** Pick RSA-OAEP, ristretto255 ElGamal, textbook RSA, or an AES mode; choose random guessing, re-encryption, or the chained-IV predictor; then run, stop, or step one real trial. The sealed coin, oracle transcript, trial tape, histogram, Wilson 95% interval, and complete ledger update together.
2. **Adaptive CCA2 oracle.** Submit a modified ElGamal or RSA-OAEP challenge. The oracle visibly refuses the exact challenge bytes. ElGamal's group-element malleation reaches advantage one; OAEP's decoder rejects the bit-flip tactic uniformly. The OAEP adversary then guesses, so a small run can show a positive 95% interval by chance; the page labels that result as a sample, not a break.
3. **Chosen-message signature oracle.** Produce multiplicative and blinding forgeries against textbook RSA, compare altered RSA-PSS and Ed25519 signatures, and compute ECDSA's $(r,n-s)$ twin. The same twin is checked by a plain verifier (`lowS: false`) and Noble's default low-S verifier, and each verifier's banner reports what that verifier actually returned — either can render the opposite outcome.
4. **PRP/PRF switching game and GGM tree.** Lazily sample an ideal $n$-bit permutation or function for selectable $8 \le n \le 20$. A collision-finding adversary is measured across growing $q$ and plotted against $q(q-1)/2^{n+1}$, with the expression also shown at $n=128$. Below the game, click paths in a three-level Goldreich–Goldwasser–Micali tree: $G(s)=\mathrm{AES}_s(0^{128})\parallel\mathrm{AES}_s(0^{127}1)$ produces two 128-bit child seeds; $G(s)=s\parallel s$ repeats every state and leaf bit. Selecting a path shows the full leaf state and its first bit; drawing a fresh seed updates both trees.
5. **Live reduction.** Wrap either public-oracle IND-CPA adversary inside a DDH distinguisher. The page measures both sides and checks the convention $\operatorname{Adv}(B)=\operatorname{Adv}(A)/2$ within a displayed combined sampling interval.
6. **Multi-key rare-signal toy.** Choose independent user instances, queries per user, and a per-query tagged reveal chance. A shared challenge bit becomes known if any signal appears; otherwise the adversary guesses. Run a sample game and compare the exact toy advantage $1-(1-\epsilon)^Q$ with the union ceiling $\min(1,Q\epsilon)$ for total opportunities $Q$. This is an abstract game, not AES, an IND-CPA experiment, or a claim that every real multi-user bound scales by $Q$. If a single-key bound already accounts for queries, do not count them again.
7. **Adjacent hybrids and a hard-core predicate.** Advance only from $H_i$ to $H_{i+1}$ while the ledger classifies exact rewrites, the symbolic AES-PRP assumption, and the switching bad event $q(q-1)/2^{129}$. Executable real-AES and lazy-oracle checks expose deterministic caching, clone safety, and forced-collision policy. Then inspect the conditional counterexample $F(x,r)=(f(x),r)$, where the input predicate $r_0$ is public, and run a bounded Goldreich–Levin reconstruction for $\langle x,r\rangle \bmod 2$. The decoder receives only the public image, access to an artificial biased-predictor oracle, and an independent preimage verifier; it never receives $x$.

8. **Target collisions and the order of play (S09).** One small keyed family, $H_s(x) = h(x \oplus s)$, is played as two state machines. Target-first, the adversary commits $x$ before the key exists and the machine refuses a second target, a target after the key, and a partner equal to $x$; key-first, the key is published before any input is chosen and choosing early is refused. The planted family ($h$ = identity except one colliding pair at $\{0x0F, 0xF0\}$) separates the orders by exhaustive count: the plant-shift strategy wins every key-first game and only 2 of 256 target-first games, whatever it commits. The nibble-fold family ($h(u) = u \& 0x0F$) is the negative control — fifteen partners everywhere, both orders fall. A signed (key, digest) pair panel explains why hash-then-sign with a committed message makes the forger face exactly the target-collision order, and every displayed chance is an exact count over the whole key space, with a bounded sampler bracketed by Wilson intervals.

The chained-IV CBC fixture is the lab's negative claim: random guessing and re-encryption can both flatten while all three KATs pass, yet the BEAST-style IV predictor still reaches advantage one. A near-zero measurement means those adversaries failed; it is not evidence of IND-CPA security.

## When to Use It

Use this lab to learn how game-based definitions constrain an oracle, how an advantage estimate is assembled, how a chosen-ciphertext or chosen-message attack crosses a definition boundary, what a reduction actually does with an adversary, and why a proof must account for every adjacent game change.

Do not use it to assess TLS, Signal, a deployed key-management system, or a protocol implementation. Do not treat a flat histogram, a small-domain reconstruction, or one successful random run as a proof. The lab covers neither proof assistants nor symbolic analysis, CCA1, NM-CPA, arbitrary visitor-authored adversaries, nor KEM definitions.

## Live Demo

[Open Hidden Bit on GitHub Pages](https://systemslibrarian.github.io/crypto-lab-hidden-bit/).

Everything runs locally in the browser. No key, message, trial result, or telemetry is sent to a backend.

## What Can Go Wrong

- **Deterministic encryption leaks equality.** Textbook RSA and AES-ECB let re-encryption identify the challenge exactly.
- **Predictable CBC IVs leak the first block.** Chaining the previous ciphertext tail into the next IV gives the BEAST-style adversary a chosen-plaintext equality test.
- **Malleable ciphertexts defeat the CCA game.** ElGamal permits a related ciphertext whose decryption reveals a related group element even though the exact challenge is refused.
- **Algebraic signatures invite forgeries.** Textbook RSA signatures preserve multiplication and blinding.
- **ECDSA has two valid $s$ values.** A plain verifier accepts $(r,n-s)$; canonical low-S verification removes that encoding malleability. [BIP-146](https://github.com/bitcoin/bips/blob/master/bip-0146.mediawiki) is a closed proposal that documents the rule and its relay-policy history, not a claim that this lab implements Bitcoin consensus.
- **Finite samples fluctuate.** Every advantage estimate carries a Wilson 95% interval; the switching chart uses a separately displayed conservative alarm tolerance.
- **Single-key claims need their own multi-key analysis.** The toy's $Q\epsilon$ ceiling is a union bound on its independent, publicly marked rare events. Real security definitions and reductions may have different resource accounting and tighter bounds. See Bellare, Boldyreva and Micali, [*Public-Key Encryption in a Multi-User Setting*](https://cseweb.ucsd.edu/~mihir/papers/musu.pdf), and Bose, Hoang and Tessaro, [*Revisiting AES-GCM-SIV: Multi-user Security, Faster Key Derivation, and Better Bounds*](https://eprint.iacr.org/2018/136).
- **Winning one order of play says nothing about the other.** Collision resistance hands the adversary the key before it picks anything; target collision resistance makes it commit the target first. The exhibit's planted family is broken in the first game and nearly intact in the second — 2 surviving keys of 256, for every committed target — and the gap is a property of the family, not of the strategy: the structure-blind scan separates the orders the same way. Nothing here extrapolates to real hashes; UOWHF security is an asymptotic family property (Naor–Yung 1989; Rompel 1990), and 8-bit exhaustive counts are teaching artifacts. See the exhibit's guard rails and the [UOWHF survey](https://doi.org/10.1007/978-3-030-71522-9_624).
- **A broken generator defeats the tree construction.** With $G(s)=s\parallel s$, all input paths have the same leaf state and bit. The AES-based generator is a length-doubling PRG candidate under the AES-128 PRP assumption; its one sample of distinct-looking branches is not a security proof.
- **Endpoint comparisons can hide an unjustified proof step.** The guided ledger permits only the canonical $H_0$-through-$H_5$ prefix and keeps the AES-PRP term symbolic. The displayed switching contribution counts distinct inputs and uses the 128-bit bound $q(q-1)/2^{129}$.
- **One-wayness does not hide every input predicate.** Conditional on $f$ being one-way, $(f(x),r)$ remains one-way as a function of $(x,r)$, but the input predicate $r_0$ is copied into its output. The eight-bit SHA-256 fixture is exhaustible, so it is not evidence that the fixture is one-way.
- **The reconstruction begins with a predictor premise.** The artificial predictor is stipulated for one fixed $x$, ignores $y$, and is wrong only at the all-zero $r$. Its bias is exhaustively audited; it is not learned, not a SHA-256 attack, and not evidence that a useful predictor exists. Goldreich–Levin concerns a one-way-function family indexed by a security parameter and a probabilistic polynomial-time predictor with non-negligible advantage, none of which an eight-bit run establishes.

### GGM sources and limits

- Goldreich, Goldwasser, and Micali, [_How to Construct Random Functions_](https://www.wisdom.weizmann.ac.il/~/oded/ggm.html), *Journal of the ACM* 33(4), 1986 (author's paper page and final text).
- Katz and Lindell, [_Introduction to Modern Cryptography_, revised third edition](https://www.routledge.com/Introduction-to-Modern-Cryptography-Revised-Third-Edition/Katz-Lindell/p/book/9781032496795), 2025, §8.5.

The formal construction consumes one input bit per tree level; for a 128-bit input it needs 128 levels, whereas this page displays only three. Truncating a secure pseudorandom function's 128-bit output to its first bit preserves the computational indistinguishability property. The example's root is displayed, so visitors can compute every leaf; it does not demonstrate secret-key security. The AES primitive and theorem assumption do not make the deliberately repeated-seed branch secure.

### Hybrid and hard-core sources and limits

- Oded Goldreich and Leonid Levin, [_A Hard-Core Predicate for all One-Way Functions_](https://www.wisdom.weizmann.ac.il/~/oded/gl.html), STOC 1989.
- Oded Goldreich, [_Modern Cryptography, Probabilistic Proofs and Pseudorandomness_](https://www.wisdom.weizmann.ac.il/~oded/PDF/mcppp-v2.pdf), Appendix C.2.
- Mihir Bellare and Phillip Rogaway, [_The Security of Triple Encryption and a Framework for Code-Based Game-Playing Proofs_](https://eprint.iacr.org/2004/331), and Victor Shoup, [_Sequences of Games_](https://eprint.iacr.org/2004/332).
- Mike Rosulek, [_The Joy of Cryptography_, adjacent hybrids and the three-hop maneuver](https://joyofcryptography.com/provsec/#sec.three-hop).

The browser fixes $n=8$, caps the sample family and reconstruction work, and uses fresh uniform WebCrypto bits. The bounded decoder enumerates every $\sigma$ guess, takes coordinate-wise majorities, deduplicates the list, and verifies candidates by recomputing the public image. It may honestly miss; the page makes at most one fresh retry and reports both attempts and total predictor queries. Those caps and the retry are teaching controls, not theorem parameters or a claim about asymptotic success.

## Real-World Usage

Modern encryption APIs randomize ciphertexts and authenticate them because deterministic equality and malleability are directly exploitable. RSA-OAEP and RSA-PSS encode those protections around RSA; AES-GCM combines confidentiality with authentication; canonical low-S policies remove one ECDSA encoding ambiguity. Production protocol claims still require a complete protocol model, assumptions, implementation review, key lifecycle, and side-channel analysis beyond this page.

## How to Run Locally

Requires Node.js 22.12 or newer.

```bash
npm ci
npm run dev
```

Vite prints the local development URL. The production preview used by Playwright runs on the repository-specific port `4667`.

## Related Demos

- [RSA Forge](https://systemslibrarian.github.io/crypto-lab-rsa-forge/) focuses on RSA failure modes.
- [ECDSA Forge](https://systemslibrarian.github.io/crypto-lab-ecdsa-forge/) focuses on signature misuse and recovery.
- [Protocol Checker](https://systemslibrarian.github.io/crypto-lab-protocol-checker/) covers protocol reasoning outside this lab's scope.
- [KEM Trap](https://systemslibrarian.github.io/crypto-lab-kem-trap/) covers ML-KEM security boundaries.

## Build & Verify

```bash
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:a11y
npm run test:mutations
```

The unit gate contains **117 tests** in 17 files. It includes **3 published known-answer cases**: FIPS 197 AES-128, RFC 6979 P-256 ECDSA, and RFC 8032 Ed25519. Coverage is measured over the cryptographic and game logic only — `src/game/`, `src/schemes/`, `src/adversaries/`, `src/prf/`, `src/proofs/`, `src/reduction/` and `src/kats.ts` — because that is the code whose correctness the claims rest on; the presentation layer (`src/ui/`, `src/main.ts`) is excluded from the measurement and is covered instead by the browser tests below. Over that scope the enforced baseline is 90% statements, 80% branches, 90% functions, and 90% lines; the latest local unit run measured 95.04%, 88.86%, 94.70%, and 97.19%, respectively.

The Playwright gate contains **42 browser tests** in 3 files: 13 truth and workflow claims (`e2e/claims.spec.ts`), including independent raw-RSA modular exponentiation, secp256k1 point arithmetic, AES-ECB, SHA-256 and proof-parameter recomputation; 27 marker-coverage and marker-branching tests (`e2e/verdicts.spec.ts`); and 2 WCAG state walks (`e2e/a11y.spec.ts`). It builds before serving, drives real controls at desktop and 380 px, requires zero WCAG 2.1 A/AA violations, inspects axe's incomplete bucket, and independently checks text contrast, control-boundary contrast, reduced motion, reflow, focus targets, scroll regions, and hidden states.

### Every rendered verdict and every rendered number is mutation-covered

A verdict is real only when it can be forced false and something goes red. This
lab shipped one that could not.

Exhibit 03's two ECDSA verifier banners — `PLAIN VERIFIER: ACCEPTED` and
`LOW-S VERIFIER: REJECTED` — were **string literals**. The cryptography behind
them was entirely real, and their outcomes were genuinely computed: `forgery.ts`
called both verifiers and wrote their real results into the transcript. The
banners just never read them. Forcing the plain verifier to enforce low-S made
it reject the `(r, n - s)` twin — collapsing the whole point of the exhibit —
and the page still rendered `PLAIN VERIFIER: ACCEPTED`, in alarm red, beside its
own computed `plainVerifier: rejected`, with all ten claims tests green. Both
banners now branch on the verifiers' real return values, and either can render
the opposite outcome.

Coverage is derived by **walking the rendered page**, never from a list of
exhibits, because a list is a self-report:

- every rendered verdict carries a `data-verdict` marker and every rendered
  measurement carries a `data-claim` marker. Both families are judged on the
  same terms, because a number painted with no mutation behind it is exactly as
  unchecked as a verdict painted with none — and it is the easier mistake to
  make, since a number does not look like a claim;
- `npm run test:verdicts` fails on a marker of either family with no mutation in
  `mutations/registry.json`, and fails on verdict words, verdict styling **or a
  measurement** rendered outside a marker — with a test that injects a raw
  unmarked banner and a raw unmarked stat the way a careless builder would, so
  the check is known to be able to fail;
- a marker's text and its state are ONE claim. `expectVerdict` asserts the
  words, the `data-tone`/`data-state` value, and — by flipping the attribute in
  place and re-reading the computed painting — that the state is one the
  stylesheet actually paints. A recorded kill that does not go through that
  helper (or `readClaim`, for a measurement) fails the build: before this, the
  rule asked only that the spec *mentioned* the marker id, and a mention is not
  an assertion;
- **that rule is enforced at runtime, not by reading spec source.** Requiring
  the call as *text* was the same defect one level down, and it was defeated
  three ways across this fleet's verdict-gated labs: comment the call out and
  the text survives inside the comment; keep the call and feed it values read
  off the page in the same test; leave an unrelated call elsewhere in the file.
  So each helper now writes the `(test title, marker id)` pair it actually
  **executes** to a run-scoped sink under `test-results/`, cleared at the start
  of every run, and `e2e/global-teardown.ts` reads them back after the last test
  and fails the run when a recorded mutation's pair never appeared. Where the
  record pins `asserts`, the `(text, state)` the test passed must be the pair
  pinned at that POSITION — which is what refuses an expectation read off the
  page under test. Position rather than membership, because a killing test that
  walks two branches hands the helper two pairs, and under a mutation that
  merely *swaps* those branches a page-derived argument hands back the same two
  pairs in the opposite order: a set comparison sees nothing wrong and the
  escape survives. **The stated limit:** a `data-claim` oracle recomputes its
  expectation from the run — a Wilson interval, an exact collision probability —
  so there is no honest literal to pin for one, and a tautological *measurement*
  oracle is caught by the mutation sweep reporting a survivor rather than by the
  coverage rule;
- **a measured row is bound to its own run, not only to itself.** The switching
  table's oracle used to check each row's internal consistency — measured
  advantage against the Wilson estimate of that row's own wins and trials — which
  a row copied from another q satisfies by construction, because it is the same
  row. Replicating one measurement across the whole curve, with only `q` and the
  bound corrected, left the suite green while the page rendered identical rows
  under *"N q values, M trials each"*. Each row is now also compared with the
  birthday collision probability at ITS q, within that row's own rendered
  tolerance, and both of the caption's numbers are read back out of the caption
  and checked against the table. That mutation is recorded as
  `curve-replicates-one-measurement`;
- the walk that all of those rules enumerate over, `driveEveryState`, visits
  **every option of every control that changes what renders** — each control on
  its own, not the cross-product. Seven CPA schemes, three adversaries, five
  signature tactics, both CCA2 schemes, both reduction adversaries, both ends of
  n, the step and stop buttons, every refusal and every retirement, every
  adjacent hybrid prefix, executable oracle checks and a fresh reconstruction. A state the
  walk never reaches is outside the set the coverage rules judge, however
  carefully those rules are written;
- `npm run test:mutations` applies **35 recorded mutations across the 34
  markers** — `switch-rows` carries two, because a doubled bound and a
  replicated row are different defects — and requires a **kill** for each: the
  unmutated baseline passing in the same run, and the failure being that
  marker's own assertion rather than a build error, a blank page, a timeout, or
  the whole suite going red.

Every run sets `CI=1`, which turns off Playwright's `reuseExistingServer`, so no
stale server on this lab's pinned port `4667` can answer for an unmutated
checkout and turn a real kill into a survivor.

In CI, `verdict-coverage` is its own job and both `deploy` and the Dependabot
auto-merge take `needs:` on it, so the gate sits between every trigger — a direct
push to `main` included — and the Pages deployment.

## Performance

The default 200-trial games are intended to complete interactively on a current desktop browser. RSA-2048 key generation happens once per page session and is shared by textbook RSA, OAEP, and PSS. The 5,000-trial cap prevents accidental unbounded work. The hard-core lesson separately caps dimensions, subset XORs and reconstruction votes, then reports any retry work. Runtime still varies by browser, CPU, selected primitive, and query count.

## Primary Sources

- Shafi Goldwasser and Silvio Micali, [“Probabilistic Encryption”](https://doi.org/10.1016/0022-0000(84)90070-9), JCSS 28(2), 1984.
- Charles Rackoff and Daniel Simon, [“Non-Interactive Zero-Knowledge Proof of Knowledge and Chosen Ciphertext Attack”](https://doi.org/10.1007/3-540-46766-1_1), CRYPTO 1991.
- Mihir Bellare, Anand Desai, David Pointcheval, and Phillip Rogaway, [“Relations Among Notions of Security for Public-Key Encryption Schemes”](https://www.iacr.org/archive/crypto1998/14620526/14620526.pdf), CRYPTO 1998.
- Shafi Goldwasser, Silvio Micali, and Ronald Rivest, [“A Digital Signature Scheme Secure Against Adaptive Chosen-Message Attacks”](https://doi.org/10.1137/0217017), SIAM Journal on Computing 17(2), 1988.
- Mihir Bellare and Phillip Rogaway, [“The Security of Triple Encryption and a Framework for Code-Based Game-Playing Proofs”](https://eprint.iacr.org/2004/331), EUROCRYPT 2006.
- Victor Shoup, [“Sequences of Games: A Tool for Taming Complexity in Security Proofs”](https://eprint.iacr.org/2004/332), 2004.
- Oded Goldreich and Leonid Levin, [“A Hard-Core Predicate for all One-Way Functions”](https://www.wisdom.weizmann.ac.il/~/oded/gl.html), STOC 1989.
- [FIPS 197: Advanced Encryption Standard](https://csrc.nist.gov/pubs/fips/197/final), [RFC 6979](https://www.rfc-editor.org/rfc/rfc6979), and [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032).

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
