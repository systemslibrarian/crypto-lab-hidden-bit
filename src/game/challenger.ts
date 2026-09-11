import { bytesEqual, randomBit, toHex } from '../schemes/utils';
import type { CpaAdversary, CpaScheme, ExperimentResult, TrialTrace } from './types';

export interface ExperimentOptions {
  readonly trials: number;
  readonly scheme: CpaScheme;
  readonly adversary: CpaAdversary;
  readonly signal?: AbortSignal;
  readonly onProgress?: (result: ExperimentResult) => void | Promise<void>;
}

export async function runCpaTrial(
  scheme: CpaScheme,
  adversary: CpaAdversary,
): Promise<TrialTrace> {
  const [messageZero, messageOne] = scheme.messages;
  if (messageZero.length !== messageOne.length) {
    throw new Error('IND-CPA challenge messages must have equal length.');
  }
  if (bytesEqual(messageZero, messageOne)) {
    throw new Error('IND-CPA challenge messages must be distinct.');
  }
  const bit = randomBit();
  const ciphertext = await scheme.challenge(scheme.messages[bit]);
  const guess = await adversary.guess(
    { ciphertext, messages: scheme.messages, schemeId: scheme.id },
    scheme.oracle,
  );
  return {
    bit,
    guess,
    won: bit === guess,
    scheme: scheme.id,
    adversary: adversary.id,
    ciphertext: toHex(ciphertext.bytes.slice(0, 18)),
    events: [
      'The challenger sampled b with crypto.getRandomValues.',
      `The oracle encrypted m${bit}; b never crossed the public interface.`,
      `The adversary returned ${guess}. The coin opened as ${bit}.`,
    ],
  };
}

export async function runCpaExperiment(options: ExperimentOptions): Promise<ExperimentResult> {
  if (!Number.isInteger(options.trials) || options.trials < 1 || options.trials > 5_000) {
    throw new Error('Trials must be an integer from 1 through 5,000.');
  }
  const result: ExperimentResult = { wins: 0, losses: 0, errors: 0, trials: 0, stopped: false };
  for (let index = 0; index < options.trials; index += 1) {
    if (options.signal?.aborted) return { ...result, stopped: true };
    let trace: TrialTrace;
    try {
      trace = await runCpaTrial(options.scheme, options.adversary);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Unknown oracle failure';
      return {
        ...result,
        errors: result.errors + 1,
        trials: result.trials + 1,
        stopped: true,
        error,
      };
    }
    Object.assign(result, {
      wins: result.wins + Number(trace.won),
      losses: result.losses + Number(!trace.won),
      trials: result.trials + 1,
      trace,
    });
    await options.onProgress?.({ ...result });
  }
  return result;
}

// [extension] point: a sandboxed strategy can implement CpaAdversary without receiving scheme state.