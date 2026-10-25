import { describe, expect, it } from 'vitest';
import {
  LazyIdealPermutation128,
  LazyRandomFunction128,
  MemoizedAes128Oracle,
  type RandomBytesSource,
} from './oracles';

function bytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('test hex is malformed');
  return Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
}

function filled(value: number): Uint8Array {
  return new Uint8Array(16).fill(value);
}

function queuedSource(outputs: readonly Uint8Array[]): { source: RandomBytesSource; calls: () => number } {
  let index = 0;
  return {
    source: (length) => {
      expect(length).toBe(16);
      const output = outputs[index];
      if (output === undefined) throw new Error('test random queue exhausted');
      index += 1;
      return output;
    },
    calls: () => index,
  };
}

describe('128-bit proof oracles', () => {
  it('runs real AES-128 and agrees with the FIPS 197 known-answer vector', () => {
    const key = bytes('000102030405060708090a0b0c0d0e0f');
    const plaintext = bytes('00112233445566778899aabbccddeeff');
    const oracle = new MemoizedAes128Oracle(key);
    expect(oracle.query(plaintext)).toEqual(bytes('69c4e0d86a7b0430d8cdb78070b4c55a'));
    expect(oracle.distinctQueryCount).toBe(1);
  });

  it('memoizes AES repeats, clones responses, and owns a copy of the key', () => {
    const key = bytes('000102030405060708090a0b0c0d0e0f');
    const input = bytes('00112233445566778899aabbccddeeff');
    const oracle = new MemoizedAes128Oracle(key);
    key.fill(0xff);
    const first = oracle.query(input);
    const expected = first.slice();
    first.fill(0);
    expect(oracle.query(input)).toEqual(expected);
    expect(oracle.distinctQueryCount).toBe(1);
    expect(oracle.query(filled(1))).not.toEqual(expected);
    expect(oracle.distinctQueryCount).toBe(2);
  });

  it('lets a random function collide across distinct inputs but caches repeats', () => {
    const output = filled(0x44);
    const queue = queuedSource([output, output]);
    const oracle = new LazyRandomFunction128(queue.source);
    const first = oracle.query(filled(1));
    first.fill(0);
    expect(oracle.query(filled(1))).toEqual(output);
    expect(oracle.query(filled(2))).toEqual(output);
    expect(queue.calls()).toBe(2);
    expect(oracle.distinctQueryCount).toBe(2);
  });

  it('rejects collisions in a permutation and returns a fresh unused block', () => {
    const a = filled(0xaa);
    const b = filled(0xbb);
    const queue = queuedSource([a, a, b]);
    const oracle = new LazyIdealPermutation128(queue.source);
    expect(oracle.query(filled(1))).toEqual(a);
    expect(oracle.query(filled(1))).toEqual(a);
    expect(oracle.query(filled(2))).toEqual(b);
    expect(queue.calls()).toBe(3);
    expect(oracle.distinctQueryCount).toBe(2);
  });

  it('does not let a caller mutate a stored permutation response', () => {
    const queue = queuedSource([filled(0x22)]);
    const oracle = new LazyIdealPermutation128(queue.source);
    const response = oracle.query(filled(1));
    response[0] = 0xff;
    expect(oracle.query(filled(1))).toEqual(filled(0x22));
    expect(queue.calls()).toBe(1);
  });

  it('rejects partial blocks, partial keys, missing sources, and malformed RNG output', () => {
    expect(() => new MemoizedAes128Oracle(new Uint8Array(15))).toThrow('16 bytes');
    const aes = new MemoizedAes128Oracle(filled(0));
    expect(() => aes.query(new Uint8Array(15))).toThrow('16 bytes');
    expect(() => new LazyRandomFunction128(null as unknown as RandomBytesSource)).toThrow('required');
    expect(() => new LazyIdealPermutation128(null as unknown as RandomBytesSource)).toThrow('required');

    const badFunction = new LazyRandomFunction128(() => new Uint8Array(15));
    expect(() => badFunction.query(filled(1))).toThrow('Injected random source output');
    const badPermutation = new LazyIdealPermutation128(() => new Uint8Array(17));
    expect(() => badPermutation.query(filled(1))).toThrow('Injected random source output');
    expect(() => new LazyRandomFunction128(() => filled(0)).query(new Uint8Array(17))).toThrow('16 bytes');
    expect(() => new LazyIdealPermutation128(() => filled(0)).query(new Uint8Array(0))).toThrow('16 bytes');
  });
});
