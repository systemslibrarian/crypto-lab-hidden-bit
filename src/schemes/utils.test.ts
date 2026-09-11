import { describe, expect, it } from 'vitest';
import {
  bigIntToBytes,
  bytesEqual,
  bytesToBigInt,
  fromHex,
  modInverse,
  modPow,
  randomBit,
  toHex,
  xorBytes,
} from './utils';

describe('scheme utilities', () => {
  it('round-trips bytes and big integers', () => {
    const value = 0x010203040506n;
    expect(bytesToBigInt(bigIntToBytes(value))).toBe(value);
    expect(toHex(bigIntToBytes(value, 8))).toBe('0000010203040506');
  });

  it('round-trips hexadecimal input', () => {
    expect(toHex(fromHex('00 aa FF'))).toBe('00aaff');
  });

  it('rejects malformed hexadecimal input', () => {
    expect(() => fromHex('abc')).toThrow();
    expect(() => fromHex('zz')).toThrow();
  });

  it('compares bytes without an early exit', () => {
    expect(bytesEqual(fromHex('0011'), fromHex('0011'))).toBe(true);
    expect(bytesEqual(fromHex('0011'), fromHex('0012'))).toBe(false);
    expect(bytesEqual(fromHex('00'), fromHex('0000'))).toBe(false);
  });

  it('XORs equal-length byte strings', () => {
    expect(toHex(xorBytes(fromHex('0ff0'), fromHex('aa55')))).toBe('a5a5');
    expect(() => xorBytes(fromHex('00'), fromHex('0000'))).toThrow();
  });

  it('computes modular powers and inverses', () => {
    expect(modPow(4n, 13n, 497n)).toBe(445n);
    expect((17n * modInverse(17n, 3120n)) % 3120n).toBe(1n);
    expect(() => modInverse(2n, 4n)).toThrow();
  });

  it('samples only bits', () => {
    expect(new Set(Array.from({ length: 64 }, randomBit))).toEqual(new Set([0, 1]));
  });
});