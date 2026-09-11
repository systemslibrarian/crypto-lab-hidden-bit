import { describe, expect, it } from 'vitest';
import type { CpaAdversary, CpaScheme } from './types';
import { runCpaExperiment } from './challenger';

const messages = [new Uint8Array([0]), new Uint8Array([1])] as const;
const transparentScheme: CpaScheme = {
  id: 'test',
  label: 'Test',
  family: 'symmetric',
  broken: true,
  detail: 'Test scheme',
  messages,
  async challenge(message) {
    return { bytes: message.slice() };
  },
  oracle: { async encrypt(message) { return { bytes: message.slice() }; } },
};
const readingAdversary: CpaAdversary = {
  id: 'reader',
  label: 'Reader',
  async guess({ ciphertext }) {
    return ciphertext.bytes[0] as 0 | 1;
  },
};

describe('generic hidden-bit challenger', () => {
  it('accounts for every completed trial', async () => {
    const result = await runCpaExperiment({ trials: 25, scheme: transparentScheme, adversary: readingAdversary });
    expect(result).toMatchObject({ wins: 25, losses: 0, errors: 0, trials: 25, stopped: false });
    expect(result.wins + result.losses + result.errors).toBe(result.trials);
  });

  it('fails closed on an oracle exception', async () => {
    const broken = {
      ...transparentScheme,
      async challenge() { throw new Error('oracle unavailable'); },
    };
    const result = await runCpaExperiment({ trials: 10, scheme: broken, adversary: readingAdversary });
    expect(result).toMatchObject({ wins: 0, losses: 0, errors: 1, trials: 1, stopped: true, error: 'oracle unavailable' });
  });

  it('honors cancellation before another trial starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runCpaExperiment({
      trials: 10,
      scheme: transparentScheme,
      adversary: readingAdversary,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ trials: 0, stopped: true });
  });

  it('refuses equal or unequal-length challenge messages before sampling', async () => {
    const equal = { ...transparentScheme, messages: [new Uint8Array([1]), new Uint8Array([1])] as const };
    const unequal = { ...transparentScheme, messages: [new Uint8Array([1]), new Uint8Array([1, 2])] as const };
    await expect(runCpaExperiment({ trials: 1, scheme: equal, adversary: readingAdversary }))
      .resolves.toMatchObject({ errors: 1, trials: 1, error: 'IND-CPA challenge messages must be distinct.' });
    await expect(runCpaExperiment({ trials: 1, scheme: unequal, adversary: readingAdversary }))
      .resolves.toMatchObject({ errors: 1, trials: 1, error: 'IND-CPA challenge messages must have equal length.' });
  });

  it('does not turn a progress-rendering exception into a phantom crypto trial', async () => {
    let snapshot: { wins: number; errors: number; trials: number } | undefined;
    await expect(runCpaExperiment({
      trials: 2,
      scheme: transparentScheme,
      adversary: readingAdversary,
      onProgress(progress) {
        snapshot = { wins: progress.wins, errors: progress.errors, trials: progress.trials };
        throw new Error('render failed');
      },
    })).rejects.toThrow('render failed');
    expect(snapshot).toEqual({ wins: 1, errors: 0, trials: 1 });
  });
});