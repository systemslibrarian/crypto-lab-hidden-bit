import { describe, expect, it } from 'vitest';
import { runForgery } from './forgery';

describe('chosen-message signature experiments', () => {
  it.each(['rsa-multiplicative', 'rsa-blinding'] as const)('%s forges textbook RSA', async (scheme) => {
    const result = await runForgery(scheme);
    expect(result.accepted).toBe(true);
    expect(result.alarm).toBe(true);
  }, 30_000);

  it('shows ECDSA EUF-CMA versus SUF-CMA precisely', async () => {
    const result = await runForgery('ecdsa-malleation');
    expect(result.values.plainVerifier).toBe('accepted');
    expect(result.values.lowSVerifier).toBe('rejected');
    expect(BigInt(result.values.malleatedS!)).toBe(BigInt(result.values.n!) - BigInt(result.values.s!));
  });

  it.each(['rsa-pss', 'ed25519'] as const)('%s rejects an altered signature', async (scheme) => {
    const result = await runForgery(scheme);
    expect(result.accepted).toBe(false);
    expect(result.alarm).toBe(false);
  }, 30_000);
});