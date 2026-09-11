import { ristretto255 } from '@noble/curves/ed25519.js';
import { randomGuess } from '../adversaries/random';
import { reencryptAndCompare } from '../adversaries/reencrypt';
import { estimateAdvantage } from '../game/advantage';
import type { CpaAdversary, EncryptionOracle } from '../game/types';
import {
  createElGamalContext,
  messageToPoint,
  randomRistrettoScalar,
  serializeElGamal,
} from '../schemes/elgamal';
import { randomBit, textEncoder } from '../schemes/utils';

export type ReductionAdversary = 'random' | 'reencrypt';

export interface ReductionResult {
  readonly trials: number;
  readonly adversary: ReductionAdversary;
  readonly aWins: number;
  readonly aAdvantage: number;
  readonly bAdvantage: number;
  readonly relationTolerance: number;
  readonly expectedB: number;
  readonly relationHolds: boolean;
  readonly trace: readonly string[];
}

const MESSAGE_BYTES = [textEncoder.encode('LEFT!'), textEncoder.encode('RIGHT')] as const;
const MESSAGES = [messageToPoint(MESSAGE_BYTES[0]), messageToPoint(MESSAGE_BYTES[1])] as const;

function absoluteInterval(low: number, high: number): readonly [number, number] {
  const intervalLow = low <= 0 && high >= 0 ? 0 : Math.min(Math.abs(low), Math.abs(high));
  return [intervalLow, Math.max(Math.abs(low), Math.abs(high))];
}

async function guess(
  strategy: ReductionAdversary,
  challenge: Uint8Array,
  oracle: EncryptionOracle,
): Promise<0 | 1> {
  const adversary: CpaAdversary = strategy === 'random' ? randomGuess : reencryptAndCompare;
  return adversary.guess(
    { ciphertext: { bytes: challenge }, messages: MESSAGE_BYTES, schemeId: 'elgamal' },
    oracle,
  );
}

export async function runDdhReduction(trials: number, adversary: ReductionAdversary): Promise<ReductionResult> {
  if (!Number.isInteger(trials) || trials < 20 || trials > 5_000 || trials % 2 !== 0) {
    throw new Error('Reduction trials must be an even integer from 20 through 5,000.');
  }
  const context = createElGamalContext();
  let aWins = 0;
  for (let index = 0; index < trials; index += 1) {
    const bit = randomBit();
    const challenge = context.encrypt(MESSAGES[bit]);
    const aGuess = await guess(adversary, challenge.bytes, {
      encrypt: async (message) => context.encrypt(messageToPoint(message)),
    });
    aWins += Number(aGuess === bit);
  }
  const aEstimate = estimateAdvantage(aWins, trials);
  const aAdvantage = Math.abs(aEstimate.estimate);

  const half = trials / 2;
  let outputsDhOnDh = 0;
  let outputsDhOnRandom = 0;
  for (let tupleKind = 0; tupleKind < 2; tupleKind += 1) {
    for (let index = 0; index < half; index += 1) {
      const exponentA = randomRistrettoScalar();
      const exponentB = randomRistrettoScalar();
      const publicPoint = ristretto255.Point.BASE.multiply(exponentB);
      const tuplePoint = tupleKind === 1
        ? ristretto255.Point.BASE.multiply((exponentA * exponentB) % ristretto255.Point.Fn.ORDER)
        : ristretto255.Point.BASE.multiply(randomRistrettoScalar());
      const challengeBit = randomBit();
      const c1 = ristretto255.Point.BASE.multiply(exponentA);
      const c2 = MESSAGES[challengeBit].add(tuplePoint);
      const challenge = serializeElGamal(c1, c2);
      const oracle: EncryptionOracle = { encrypt: async (message) => {
        const ephemeral = randomRistrettoScalar();
        const first = ristretto255.Point.BASE.multiply(ephemeral);
        const second = messageToPoint(message).add(publicPoint.multiply(ephemeral));
        return { bytes: serializeElGamal(first, second) };
      } };
      const aGuess = await guess(adversary, challenge, oracle);
      const bOutputsDh = aGuess === challengeBit;
      if (tupleKind === 1) outputsDhOnDh += Number(bOutputsDh);
      else outputsDhOnRandom += Number(bOutputsDh);
    }
  }
  const dhRate = outputsDhOnDh / half;
  const randomRate = outputsDhOnRandom / half;
  const bAdvantage = Math.abs(dhRate - randomRate);
  const dhEstimate = estimateAdvantage(outputsDhOnDh, half);
  const randomEstimate = estimateAdvantage(outputsDhOnRandom, half);
  const differenceLow = (dhEstimate.low - randomEstimate.high) / 2;
  const differenceHigh = (dhEstimate.high - randomEstimate.low) / 2;
  const [bLow, bHigh] = absoluteInterval(differenceLow, differenceHigh);
  const bRadius = Math.max(bAdvantage - bLow, bHigh - bAdvantage);
  const [aLow, aHigh] = absoluteInterval(aEstimate.low, aEstimate.high);
  const aRadius = Math.max(aAdvantage - aLow, aHigh - aAdvantage);
  const relationTolerance = bRadius + aRadius / 2;
  const expectedB = aAdvantage / 2;
  return {
    trials,
    adversary,
    aWins,
    aAdvantage,
    bAdvantage,
    relationTolerance,
    expectedB,
    relationHolds: Math.abs(bAdvantage - expectedB) <= relationTolerance,
    trace: [
      'B receives (G, aG, bG, T) and chooses the challenge message bit.',
      'B gives A the ElGamal-shaped ciphertext (aG, Mb + T).',
      'If A guesses the message, B answers DDH; otherwise B answers random.',
      'Under this convention, Adv(B) = Adv(A) / 2 in the underlying probabilities.',
    ],
  };
}

// [extension] point: add a second reduction, such as PRF security implying MAC security.