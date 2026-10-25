import { describe, expect, it } from 'vitest';
import {
  assertBitVector,
  bitVectorKey,
  evaluateExposedFunction,
  exposedFirstBit,
  innerProductMod2,
  type BitVector,
} from './hardcore';

function bits(value: string): BitVector {
  return Uint8Array.from(value, (bit) => Number(bit));
}

describe('hard-core predicate primitives', () => {
  it('computes F(x,r)=(f(x),r) and makes the exposed r0 predicate explicit', () => {
    const x = bits('1011');
    const r = bits('1100');
    const output = evaluateExposedFunction((input) => bitVectorKey(input), x, r);
    expect(output).toEqual({ image: '1011', r: bits('1100') });
    expect(exposedFirstBit(output)).toBe(1);
  });

  it('clones x before f and clones public r in the returned pair', () => {
    const x = bits('1011');
    const r = bits('0101');
    const output = evaluateExposedFunction((input) => {
      const before = bitVectorKey(input);
      input.fill(0);
      return before;
    }, x, r);
    r.fill(1);
    expect(x).toEqual(bits('1011'));
    expect(output.image).toBe('1011');
    expect(output.r).toEqual(bits('0101'));
  });

  it('computes the inner product from x and r, never from f(x)', () => {
    expect(innerProductMod2(bits('1011'), bits('1101'))).toBe(0);
    expect(innerProductMod2(bits('1011'), bits('1111'))).toBe(1);
    expect(innerProductMod2(bits('0001'), bits('0001'))).toBe(1);
    // Uniform r includes the all-zero vector; it is not an invalid special case.
    expect(innerProductMod2(bits('1011'), bits('0000'))).toBe(0);
  });

  it('rejects malformed, mismatched, and empty bit vectors', () => {
    expect(() => assertBitVector(Uint8Array.of(0, 2))).toThrow('0 or 1');
    expect(() => bitVectorKey(Uint8Array.of(255))).toThrow('0 or 1');
    expect(() => evaluateExposedFunction((value) => value, bits('1'), bits('10'))).toThrow('exactly 1');
    expect(() => evaluateExposedFunction((value) => value, new Uint8Array(), new Uint8Array())).toThrow('at least one');
    expect(() => exposedFirstBit({ image: 'x', r: new Uint8Array() })).toThrow('no first bit');
    expect(() => innerProductMod2(bits('1'), bits('10'))).toThrow('exactly 1');
    expect(() => innerProductMod2(new Uint8Array(), new Uint8Array())).toThrow('at least one');
    expect(() => evaluateExposedFunction(null as never, bits('1'), bits('1'))).toThrow('callable');
  });
});
