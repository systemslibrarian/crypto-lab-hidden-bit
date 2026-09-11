import { describe, expect, it } from 'vitest';
import { ecdsaHighSTwin } from '../adversaries/ecdsa-high-s';
import { beastIvPredictor } from '../adversaries/beast';
import { reencryptAndCompare } from '../adversaries/reencrypt';
import { runCpaExperiment } from '../game/challenger';
import { createAesSchemes } from './aes-modes';
import { signEcdsa, verifyEcdsaLowS, verifyEcdsaPlain } from './ecdsa';
import { createElGamalContext, messageToPoint } from './elgamal';
import { signEd25519, verifyEd25519 } from './ed25519';
import { createRsaOaepScheme } from './rsa-oaep';
import { signPss, verifyPss } from './rsa-pss';
import {
  createTextbookRsaScheme,
  getRsaMaterial,
  textbookDecrypt,
  textbookEncrypt,
} from './rsa-textbook';
import { bytesEqual, textEncoder } from './utils';

describe('real encryption schemes', () => {
  it('makes AES-ECB visibly deterministic', async () => {
    const scheme = (await createAesSchemes()).find(({ id }) => id === 'aes-ecb')!;
    const first = await scheme.challenge(scheme.messages[0]);
    const second = await scheme.challenge(scheme.messages[0]);
    expect(bytesEqual(first.bytes, second.bytes)).toBe(true);
    const result = await runCpaExperiment({ trials: 12, scheme, adversary: reencryptAndCompare });
    expect(result).toMatchObject({ wins: 12, losses: 0, errors: 0, trials: 12 });
  });

  it('uses a fresh AES-GCM nonce', async () => {
    const scheme = (await createAesSchemes()).find(({ id }) => id === 'aes-gcm')!;
    const first = await scheme.challenge(scheme.messages[0]);
    const second = await scheme.challenge(scheme.messages[0]);
    expect(bytesEqual(first.bytes, second.bytes)).toBe(false);
  });

  it('breaks chained AES-CBC with the IV predictor', async () => {
    const scheme = (await createAesSchemes()).find(({ id }) => id === 'aes-cbc-chained')!;
    const result = await runCpaExperiment({ trials: 20, scheme, adversary: beastIvPredictor });
    expect(result).toMatchObject({ wins: 20, losses: 0, errors: 0, trials: 20 });
  });

  it('makes textbook RSA deterministic and invertible', async () => {
    const [scheme, material] = await Promise.all([createTextbookRsaScheme(), getRsaMaterial()]);
    const first = await scheme.challenge(scheme.messages[0]);
    const second = await scheme.challenge(scheme.messages[0]);
    expect(bytesEqual(first.bytes, second.bytes)).toBe(true);
    expect(textbookDecrypt(textbookEncrypt(42n, material), material)).toBe(42n);
  }, 30_000);

  it('makes RSA-OAEP randomized', async () => {
    const scheme = await createRsaOaepScheme();
    const first = await scheme.challenge(scheme.messages[0]);
    const second = await scheme.challenge(scheme.messages[0]);
    expect(bytesEqual(first.bytes, second.bytes)).toBe(false);
  }, 30_000);

  it('round-trips hand-rolled ristretto255 ElGamal', () => {
    const context = createElGamalContext();
    const message = messageToPoint(textEncoder.encode('labelled message'));
    const first = context.encrypt(message);
    const second = context.encrypt(message);
    expect(context.decrypt(first.bytes).equals(message)).toBe(true);
    expect(bytesEqual(first.bytes, second.bytes)).toBe(false);
    expect(() => context.decrypt(first.bytes.slice(0, 63))).toThrow('exactly 64 bytes');
  });
});

describe('real signature schemes', () => {
  it('shows ECDSA high-S malleability only in the plain verifier', () => {
    const signed = signEcdsa(textEncoder.encode('message'));
    const candidate = ecdsaHighSTwin.mutate(signed.signature, signed.n);
    expect(verifyEcdsaPlain(signed.message, candidate.signature, signed.publicKey)).toBe(true);
    expect(verifyEcdsaLowS(signed.message, candidate.signature, signed.publicKey)).toBe(false);
    expect(candidate.malleatedS).toBeGreaterThan(signed.n / 2n);
  });

  it('accepts an Ed25519 signature and rejects a changed message', () => {
    const message = textEncoder.encode('message');
    const signed = signEd25519(message);
    expect(verifyEd25519(message, signed.signature, signed.publicKey)).toBe(true);
    expect(verifyEd25519(textEncoder.encode('changed'), signed.signature, signed.publicKey)).toBe(false);
  });

  it('accepts an RSA-PSS signature and rejects a changed message', async () => {
    const message = textEncoder.encode('message');
    const signature = await signPss(message);
    expect(await verifyPss(message, signature)).toBe(true);
    expect(await verifyPss(textEncoder.encode('changed'), signature)).toBe(false);
  }, 30_000);
});