import { describe, expect, it } from 'vitest';
import { multiKeyBudget, runMultiKeyGame } from './multiKey';

describe('independent rare-signal multi-key teaching game', () => {
  it('separates exact event probability from the Qε union bound', () => {
    const budget = multiKeyBudget({ users: 3, queriesPerUser: 4, epsilon: 0.05 });
    expect(budget.totalQueries).toBe(12);
    expect(budget.exactAdvantage).toBeCloseTo(1 - 0.95 ** 12, 12);
    expect(budget.unionBound).toBeCloseTo(0.6, 12);
    expect(budget.exactAdvantage).toBeLessThanOrEqual(budget.unionBound);
    expect(multiKeyBudget({ users: 8, queriesPerUser: 8, epsilon: 1 }).unionBound).toBe(1);
  });

  it('reveals a shared challenge only on independently tagged opportunities', () => {
    const draws = [0.9, 0.01, 0.8, 0.02];
    const bits = [1, 0];
    const game = runMultiKeyGame({ users: 2, queriesPerUser: 2, epsilon: 0.05 },
      () => draws.shift()!, () => bits.shift()!);
    expect(game.revealedByUser).toEqual([1, 1]);
    expect(game.challengeBit).toBe(1);
    expect(game.guess).toBe(1);
    expect(game.won).toBe(true);
    expect(bits).toEqual([0]);
  });

  it('falls back to an independent guess when nothing is signaled', () => {
    const bits = [1, 0];
    const game = runMultiKeyGame({ users: 1, queriesPerUser: 2, epsilon: 0 },
      () => 0.5, () => bits.shift()!);
    expect(game.won).toBe(false);
    expect(game.revealedByUser).toEqual([0]);
  });

  it.each([
    { users: 0, queriesPerUser: 1, epsilon: 0.1 },
    { users: 9, queriesPerUser: 1, epsilon: 0.1 },
    { users: 1, queriesPerUser: 0, epsilon: 0.1 },
    { users: 1, queriesPerUser: 9, epsilon: 0.1 },
    { users: 1, queriesPerUser: 1, epsilon: -0.1 },
    { users: 1, queriesPerUser: 1, epsilon: Number.NaN },
  ])('rejects invalid or unbounded configuration $users/$queriesPerUser/$epsilon', config => {
    expect(() => multiKeyBudget(config)).toThrow();
  });
});
