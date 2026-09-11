import { describe, expect, it } from 'vitest';
import { runDdhReduction } from './ddh';

describe('ElGamal IND-CPA to DDH wrapper', () => {
  it.each(['random', 'reencrypt'] as const)('runs B around the %s adversary', async (adversary) => {
    const result = await runDdhReduction(40, adversary);
    expect(result.aWins).toBeGreaterThanOrEqual(0);
    expect(result.aWins).toBeLessThanOrEqual(40);
    expect(result.expectedB).toBe(result.aAdvantage / 2);
    expect(result.bAdvantage).toBeGreaterThanOrEqual(0);
    expect(result.bAdvantage).toBeLessThanOrEqual(1);
    expect(result.trace).toHaveLength(4);
  });

  it('refuses an odd trial count so DDH and random samples stay balanced', async () => {
    await expect(runDdhReduction(21, 'random')).rejects.toThrow();
  });
});