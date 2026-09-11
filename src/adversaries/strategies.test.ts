import { ristretto255 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import type { CcaChallengeView } from '../game/types';
import { modPow } from '../schemes/utils';
import { beastIvPredictor } from './beast';
import { elgamalMalleateByGenerator } from './cca-elgamal';
import { rsaOaepBitFlip } from './cca-rsa-oaep';
import { ecdsaHighSTwin } from './ecdsa-high-s';
import { collisionFinder } from './prp-collision';
import { randomGuess } from './random';
import { reencryptAndCompare } from './reencrypt';
import { rsaBlindingForgery } from './rsa-blinding';
import { rsaMultiplicativeForgery } from './rsa-multiplicative';
import { flipFirstSignatureBit } from './signature-bitflip';

describe('public-oracle adversary strategies', () => {
  it('random guessing returns only a bit', async () => {
    const guess = await randomGuess.guess(
      { ciphertext: { bytes: new Uint8Array() }, messages: [new Uint8Array(), new Uint8Array()], schemeId: 'test' },
      { encrypt: async () => ({ bytes: new Uint8Array() }) },
    );
    expect([0, 1]).toContain(guess);
  });

  it('re-encryption distinguishes equal bytes and rejects unequal bytes', async () => {
    const messages = [new Uint8Array([1]), new Uint8Array([2])] as const;
    const equal = await reencryptAndCompare.guess(
      { ciphertext: { bytes: new Uint8Array([9]) }, messages, schemeId: 'test' },
      { encrypt: async () => ({ bytes: new Uint8Array([9]) }) },
    );
    const unequal = await reencryptAndCompare.guess(
      { ciphertext: { bytes: new Uint8Array([9]) }, messages, schemeId: 'test' },
      { encrypt: async () => ({ bytes: new Uint8Array([8]) }) },
    );
    expect([equal, unequal]).toEqual([0, 1]);
  });

  it('refuses the CBC predictor outside its required oracle shape', async () => {
    await expect(beastIvPredictor.guess(
      { ciphertext: { bytes: new Uint8Array() }, messages: [new Uint8Array(16), new Uint8Array(16)], schemeId: 'aes-gcm' },
      { encrypt: async () => ({ bytes: new Uint8Array() }) },
    )).rejects.toThrow('requires chained AES-CBC');
  });

  it('ElGamal CCA strategy uses only point bytes and the decryption oracle', async () => {
    const messageZero = ristretto255.Point.BASE.multiply(7n);
    const messageOne = ristretto255.Point.BASE.multiply(9n);
    const challenge = new Uint8Array(64);
    challenge.set(ristretto255.Point.BASE.toBytes(), 0);
    challenge.set(messageOne.add(ristretto255.Point.BASE).toBytes(), 32);
    const view: CcaChallengeView = {
      ciphertext: challenge,
      messages: [messageZero.toBytes(), messageOne.toBytes()],
    };
    expect(await elgamalMalleateByGenerator.guess(view, {
      decrypt: async () => messageZero.add(ristretto255.Point.BASE).toBytes(),
    })).toBe(0);
    await expect(elgamalMalleateByGenerator.guess(view, { decrypt: async () => null }))
      .rejects.toThrow('rejected a valid modified ciphertext');
    await expect(elgamalMalleateByGenerator.guess({ ...view, ciphertext: new Uint8Array(63) }, { decrypt: async () => null }))
      .rejects.toThrow('64-byte');
  });

  it('RSA-OAEP bit flip classifies plaintext answers and falls back on rejection', async () => {
    const messages = [new Uint8Array([1]), new Uint8Array([2])] as const;
    const view = { ciphertext: new Uint8Array([3, 4]), messages };
    expect(await rsaOaepBitFlip.guess(view, { decrypt: async () => messages[0] })).toBe(0);
    expect(await rsaOaepBitFlip.guess(view, { decrypt: async () => messages[1] })).toBe(1);
    expect([0, 1]).toContain(await rsaOaepBitFlip.guess(view, { decrypt: async () => null }));
  });

  it('constructs textbook RSA multiplication and blinding candidates through an oracle', async () => {
    const publicKey = { n: 3233n, e: 17n };
    const oracle = { sign: async (message: bigint) => modPow(message, 2753n, publicKey.n) };
    const multiplicative = await rsaMultiplicativeForgery.forge(publicKey, oracle);
    const blinded = await rsaBlindingForgery.forge(publicKey, oracle);
    expect(modPow(multiplicative.signature, publicKey.e, publicKey.n)).toBe(multiplicative.message);
    expect(modPow(blinded.signature, publicKey.e, publicKey.n)).toBe(blinded.message);
    expect(multiplicative.queried).not.toContain(multiplicative.message);
    expect(blinded.queried).not.toContain(blinded.message);
  });

  it('creates a compact ECDSA high-S twin from public values', () => {
    const signature = new Uint8Array(64);
    signature[31] = 3;
    signature[63] = 2;
    const candidate = ecdsaHighSTwin.mutate(signature, 13n);
    expect(candidate).toMatchObject({ r: 3n, s: 2n, malleatedS: 11n });
    expect(candidate.signature[63]).toBe(11);
    expect(() => ecdsaHighSTwin.mutate(new Uint8Array(63), 13n)).toThrow('64-byte');
  });

  it('flips one signature bit and refuses an empty signature', () => {
    expect(flipFirstSignatureBit.mutate(new Uint8Array([0]))).toEqual(new Uint8Array([1]));
    expect(() => flipFirstSignatureBit.mutate(new Uint8Array())).toThrow('empty signature');
  });

  it('collision finder distinguishes repeated and unique outputs', () => {
    expect(collisionFinder.guess(3, { query: (input) => input })).toBe(0);
    expect(collisionFinder.guess(3, { query: (input) => input % 2 })).toBe(1);
  });
});