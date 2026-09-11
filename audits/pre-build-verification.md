# Pre-build verification — 2026-09-11

These checks were completed before implementation, as required by `brief.md`.

## Concept overlap

- Searched the current `systemslibrarian/crypto-lab` catalog snapshot for `IND-CPA`, `IND-CCA`, `EUF-CMA`, `security game`, and `advantage`.
- Hits were incidental prose in audits and existing demos, not a live card whose central interaction is the generic classical hidden-bit experiment.
- No `crypto-lab-advantage-lens` card or in-flight catalog entry was present. The proposed lab therefore does not duplicate a live classical-security-game card, and no quantum/computational-advantage cross-link is currently needed.

## Catalog placement

- The live catalog index contains the `Foundations` section.
- The live catalog index uses the `ATTACKS` chip.
- Proposed placement remains `Foundations` with `ATTACKS`; shared catalog files were not edited from this repository.

## Port

- The workspace contained no sibling `crypto-lab-*` checkout with a `playwright.config.ts`, so no local committed port collision was found in the required 4600–4700 range.
- This repository reserves `4667` in `playwright.config.ts`. It does not use Vite's default `4173`.

## Primitive APIs

- `@noble/ciphers` 2.4.0 exports AES-ECB as `ecb(key, { disablePadding: true })`. It is used only for the mode WebCrypto omits and is checked against FIPS 197.
- `@noble/curves` 2.4.0 uses deterministic RFC 6979 ECDSA nonces by default, emits low-S signatures by default, and accepts `{ lowS: false }` for the deliberately plain verifier.
- `@noble/curves` exposes ristretto255 point arithmetic and RFC 9380 hash-to-curve; the lab uses those operations for inspectable ElGamal rather than substituting toy arithmetic.
- BIP-146 is `Closed`. It documents LOW_S and the historical Bitcoin relay-policy rule, but the README does not describe it as an activated consensus proposal.

## Result

The duplicate-demo stop condition was not triggered. The named libraries expose the required operations, the proposed placement exists, and port `4667` was available, so implementation proceeded.