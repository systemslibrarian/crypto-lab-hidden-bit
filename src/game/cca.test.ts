import { describe, expect, it } from 'vitest';
import { runElGamalCca, runRsaOaepCca } from './cca';

describe('IND-CCA2 experiments', () => {
  it('refuses the exact challenge and exposes ElGamal malleability', async () => {
    const result = await runElGamalCca(20);
    expect(result.exactChallengeRejected).toBe(true);
    expect(result).toMatchObject({ wins: 20, losses: 0, errors: 0, trials: 20, advantage: 1 });
  });

  it('refuses the exact challenge and rejects a modified RSA-OAEP ciphertext', async () => {
    const result = await runRsaOaepCca(20);
    expect(result.exactChallengeRejected).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.wins + result.losses).toBe(result.trials);
    expect(result.trace.join(' ')).toContain('OAEP decoding rejected uniformly');
  }, 30_000);
});