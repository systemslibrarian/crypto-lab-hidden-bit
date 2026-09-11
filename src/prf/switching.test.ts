import { describe, expect, it } from 'vitest';
import {
  exactFunctionCollisionProbability,
  LazyRandomFunction,
  LazyRandomPermutation,
  MAX_SWITCHING_WORK,
  runSwitchingPoint,
  scaledBound128,
  switchingBound,
} from './switching';

describe('lazy PRP/PRF switching experiment', () => {
  it('keeps repeated oracle answers stable', () => {
    const randomFunction = new LazyRandomFunction(8);
    const permutation = new LazyRandomPermutation(8);
    expect(randomFunction.query(7)).toBe(randomFunction.query(7));
    expect(permutation.query(7)).toBe(permutation.query(7));
  });

  it('never repeats permutation outputs', () => {
    const permutation = new LazyRandomPermutation(8);
    const outputs = Array.from({ length: 256 }, (_, input) => permutation.query(input));
    expect(new Set(outputs).size).toBe(256);
  });

  it('computes the switching bound independently of the exact probability', () => {
    const exact = exactFunctionCollisionProbability(8, 20);
    const bound = switchingBound(8, 20);
    expect(exact).toBeGreaterThan(0);
    expect(exact).toBeLessThanOrEqual(bound);
    expect(bound).toBeCloseTo((20 * 19) / 512, 12);
  });

  it('runs real hidden-bit trials with complete accounting', () => {
    const result = runSwitchingPoint(8, 20, 200);
    expect(result.wins).toBeGreaterThanOrEqual(0);
    expect(result.wins).toBeLessThanOrEqual(200);
    expect(result.bound).toBeCloseTo((20 * 19) / 512, 12);
  });

  it('scales the formula symbolically to n = 128', () => {
    expect(scaledBound128(20)).toBe('380 / 2^129');
  });

  it('rejects q beyond the domain', () => {
    expect(() => switchingBound(8, 257)).toThrow();
    expect(() => runSwitchingPoint(7, 10, 20)).toThrow();
    expect(() => new LazyRandomFunction(8).query(256)).toThrow();
    expect(() => new LazyRandomPermutation(8).query(-1)).toThrow();
    expect(() => switchingBound(20, 4_097)).toThrow('4,096');
    expect(() => runSwitchingPoint(20, 4_096, Math.floor(MAX_SWITCHING_WORK / 4_096) + 1)).toThrow('work cap');
  });
});