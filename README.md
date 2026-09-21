# Hidden Bit

## What It Is

Hidden Bit is a browser lab for the experiments behind IND-CPA, IND-CCA2, EUF-CMA, strong unforgeability, and the PRP/PRF switching lemma. It runs real AES-128 ECB/CBC/CTR/GCM, RSA-2048 textbook/OAEP/PSS, ristretto255 ElGamal, secp256k1 ECDSA, and Ed25519 operations, then measures each named adversary with the definition

$$
\operatorname{Adv}(A)=2\frac{\text{wins}}{\text{trials}}-1.
$$

AES CBC/CTR/GCM and RSA OAEP/PSS use WebCrypto with SHA-256 where the RSA construction requires it. RSA keys are generated once as extractable JWK material, so the same $n$, $e$, and $d$ also drive the inspectable textbook-RSA arithmetic. ElGamal, ECDSA, Ed25519, and AES-ECB use the audited Noble packages; ristretto255's hash-to-group uses SHA-512. [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers) is used for ECB because WebCrypto deliberately does not expose that unauthenticated mode; the implementation is still checked against FIPS 197.

The ideal permutation and ideal function are faithfully lazy-sampled mathematical oracles. Nothing else is simulated. This is not production crypto: keys live only in browser memory, deliberately vulnerable choices are teaching fixtures, trial counts are finite, and the interface exposes values a production system would hide.

## Exhibits

1. **Hidden-bit IND-CPA game.** Pick RSA-OAEP, ristretto255 ElGamal, textbook RSA, or an AES mode; choose random guessing, re-encryption, or the chained-IV predictor; then run, stop, or step one real trial. The sealed coin, oracle transcript, trial tape, histogram, Wilson 95% interval, and complete ledger update together.
2. **Adaptive CCA2 oracle.** Submit a modified ElGamal or RSA-OAEP challenge. The oracle visibly refuses the exact challenge bytes. ElGamal's group-element malleation reaches advantage one; OAEP's decoder rejects the bit-flip tactic uniformly.
3. **Chosen-message signature oracle.** Produce multiplicative and blinding forgeries against textbook RSA, compare altered RSA-PSS and Ed25519 signatures, and compute ECDSA's $(r,n-s)$ twin. The same twin is checked by a plain verifier (`lowS: false`) and Noble's default low-S verifier.
4. **PRP/PRF switching game.** Lazily sample an ideal $n$-bit permutation or function for selectable $8 \le n \le 20$. A collision-finding adversary is measured across growing $q$ and plotted against $q(q-1)/2^{n+1}$, with the expression also shown at $n=128$.
5. **Live reduction.** Wrap either public-oracle IND-CPA adversary inside a DDH distinguisher. The page measures both sides and checks the convention $\operatorname{Adv}(B)=\operatorname{Adv}(A)/2$ within a displayed combined sampling interval.

The chained-IV CBC fixture is the lab's negative claim: random guessing and re-encryption can both flatten while all three KATs pass, yet the BEAST-style IV predictor still reaches advantage one. A near-zero measurement means those adversaries failed; it is not evidence of IND-CPA security.

## When to Use It

Use this lab to learn how game-based definitions constrain an oracle, how an advantage estimate is assembled, how a chosen-ciphertext or chosen-message attack crosses a definition boundary, and what a reduction actually does with an adversary.

Do not use it to assess TLS, Signal, a deployed key-management system, or a protocol implementation. Do not treat a flat histogram as a proof. The lab covers neither proof assistants nor symbolic analysis, CCA1, NM-CPA, arbitrary visitor-authored adversaries, nor KEM definitions.

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
```

The unit gate contains **77 tests** in 11 files. It includes **3 published known-answer cases**: FIPS 197 AES-128, RFC 6979 P-256 ECDSA, and RFC 8032 Ed25519. Coverage is measured over the cryptographic and game logic only — `src/game/`, `src/schemes/`, `src/adversaries/`, `src/prf/`, `src/reduction/` and `src/kats.ts` — because that is the code whose correctness the claims rest on; the presentation layer (`src/ui/`, `src/main.ts`) is excluded from the measurement and is covered instead by the 12 browser tests below. Over that scope the enforced baseline is 90% statements, 80% branches, 90% functions, and 90% lines; the final measured result is 93.62%, 83.4%, 93.13%, and 96.66%, respectively.

The Playwright gate contains **12 browser tests**: 10 truth and workflow claims, including independent raw-RSA modular exponentiation and secp256k1 point arithmetic, plus 2 WCAG state walks. It builds before serving, drives real controls at desktop and 380 px, requires zero WCAG 2.1 A/AA violations, inspects axe's incomplete bucket, and independently checks text contrast, control-boundary contrast, reduced motion, reflow, focus targets, scroll regions, and hidden states.

## Performance

The default 200-trial games are intended to complete interactively on a current desktop browser. RSA-2048 key generation happens once per page session and is shared by textbook RSA, OAEP, and PSS. The 5,000-trial cap prevents accidental unbounded work; runtime still varies by browser, CPU, selected primitive, and query count.

## Primary Sources

- Shafi Goldwasser and Silvio Micali, [“Probabilistic Encryption”](https://doi.org/10.1016/0022-0000(84)90070-9), JCSS 28(2), 1984.
- Charles Rackoff and Daniel Simon, [“Non-Interactive Zero-Knowledge Proof of Knowledge and Chosen Ciphertext Attack”](https://doi.org/10.1007/3-540-46766-1_1), CRYPTO 1991.
- Mihir Bellare, Anand Desai, David Pointcheval, and Phillip Rogaway, [“Relations Among Notions of Security for Public-Key Encryption Schemes”](https://www.iacr.org/archive/crypto1998/14620526/14620526.pdf), CRYPTO 1998.
- Shafi Goldwasser, Silvio Micali, and Ronald Rivest, [“A Digital Signature Scheme Secure Against Adaptive Chosen-Message Attacks”](https://doi.org/10.1137/0217017), SIAM Journal on Computing 17(2), 1988.
- Mihir Bellare and Phillip Rogaway, [“The Security of Triple Encryption and a Framework for Code-Based Game-Playing Proofs”](https://eprint.iacr.org/2004/331), EUROCRYPT 2006.
- Victor Shoup, [“Sequences of Games: A Tool for Taming Complexity in Security Proofs”](https://eprint.iacr.org/2004/332), 2004.
- [FIPS 197: Advanced Encryption Standard](https://csrc.nist.gov/pubs/fips/197/final), [RFC 6979](https://www.rfc-editor.org/rfc/rfc6979), and [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032).

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*