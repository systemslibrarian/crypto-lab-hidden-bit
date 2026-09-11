import { describe, expect, it } from 'vitest';
import { estimateAdvantage } from './advantage';

describe('advantage estimate', () => {
  it('maps all wins to advantage one', () => {
    const result = estimateAdvantage(100, 100);
    expect(result.estimate).toBe(1);
    expect(result.high).toBe(1);
    expect(result.low).toBeGreaterThan(0.92);
    expect(result.lowerError).toBeGreaterThan(result.upperError);
    expect(result.conservativeRadius).toBe(result.lowerError);
  });

  it('maps half wins to zero', () => {
    const result = estimateAdvantage(50, 100);
    expect(result.estimate).toBe(0);
    expect(result.low).toBeLessThan(0);
    expect(result.high).toBeGreaterThan(0);
  });

  it('scales the Wilson interval from probability to advantage', () => {
    const result = estimateAdvantage(60, 100);
    expect(result.estimate).toBeCloseTo(0.2, 12);
    expect(result.low).toBeCloseTo(0.007, 2);
    expect(result.high).toBeCloseTo(0.3812, 4);
  });

  it.each([
    [-1, 10],
    [11, 10],
    [0, 0],
    [0.5, 1],
  ])('rejects invalid counts (%s, %s)', (wins, trials) => {
    expect(() => estimateAdvantage(wins, trials)).toThrow();
  });
});