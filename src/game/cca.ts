import { elgamalMalleateByGenerator } from '../adversaries/cca-elgamal';
import { rsaOaepBitFlip } from '../adversaries/cca-rsa-oaep';
import { estimateAdvantage } from './advantage';
import {
  createElGamalContext,
  messageToPoint,
} from '../schemes/elgamal';
import { getRsaMaterial } from '../schemes/rsa-textbook';
import {
  bytesEqual,
  randomBit,
  textEncoder,
  toArrayBuffer,
} from '../schemes/utils';

export interface CcaExperimentResult {
  readonly scheme: 'elgamal-cca' | 'rsa-oaep-cca';
  readonly wins: number;
  readonly losses: number;
  readonly errors: number;
  readonly trials: number;
  readonly advantage: number;
  readonly interval: readonly [number, number];
  readonly exactChallengeRejected: boolean;
  readonly trace: readonly string[];
}

class ExactChallengeError extends Error {
  constructor() {
    super('REFUSED: exact challenge ciphertext (the trivial win).');
  }
}

export async function runElGamalCca(trials: number): Promise<CcaExperimentResult> {
  const context = createElGamalContext();
  const messagePoints = [messageToPoint(textEncoder.encode('LEFT')), messageToPoint(textEncoder.encode('RIGHT'))] as const;
  const messages = [messagePoints[0].toBytes(), messagePoints[1].toBytes()] as const;
  let wins = 0;
  let exactChallengeRejected = false;
  let firstTrace: string[] = [];

  for (let index = 0; index < trials; index += 1) {
    const bit = randomBit();
    const challenge = context.encrypt(messagePoints[bit]);
    const oracle = { decrypt: async (candidate: Uint8Array): Promise<Uint8Array | null> => {
      if (bytesEqual(candidate, challenge.bytes)) throw new ExactChallengeError();
      return context.decrypt(candidate).toBytes();
    } };
    if (index === 0) {
      try {
        await oracle.decrypt(challenge.bytes);
      } catch (error) {
        exactChallengeRejected = error instanceof ExactChallengeError;
      }
    }
    const guess = await elgamalMalleateByGenerator.guess(
      { ciphertext: challenge.bytes, messages },
      oracle,
    );
    wins += Number(guess === bit);
    if (index === 0) {
      firstTrace = [
        `Challenge: (R, M${bit} + rY).`,
        'Exact challenge query: refused by byte comparison.',
        'Adversary queried (R, C2 + G); the oracle returned Mb + G.',
        `Subtract G, compare the labelled points, and guess ${guess}.`,
      ];
    }
  }
  const estimate = estimateAdvantage(wins, trials);
  return {
    scheme: 'elgamal-cca',
    wins,
    losses: trials - wins,
    errors: 0,
    trials,
    advantage: estimate.estimate,
    interval: [estimate.low, estimate.high],
    exactChallengeRejected,
    trace: firstTrace,
  };
}

export async function runRsaOaepCca(trials: number): Promise<CcaExperimentResult> {
  const { oaepPublic, oaepPrivate } = await getRsaMaterial();
  const messages = [textEncoder.encode('LEFT ENVELOPE'), textEncoder.encode('RIGHT ENVELOPE')] as const;
  let wins = 0;
  let exactChallengeRejected = false;
  let firstTrace: string[] = [];

  for (let index = 0; index < trials; index += 1) {
    const bit = randomBit();
    const body = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        oaepPublic,
        toArrayBuffer(messages[bit]),
      ),
    );
    const challenge = body;
    const oracle = { decrypt: async (candidate: Uint8Array): Promise<Uint8Array | null> => {
      if (bytesEqual(candidate, challenge)) throw new ExactChallengeError();
      try {
        return new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'RSA-OAEP' },
            oaepPrivate,
            toArrayBuffer(candidate),
          ),
        );
      } catch {
        return null;
      }
    } };
    if (index === 0) {
      try {
        await oracle.decrypt(challenge);
      } catch (error) {
        exactChallengeRejected = error instanceof ExactChallengeError;
      }
    }
    const guess = await rsaOaepBitFlip.guess({ ciphertext: challenge, messages }, oracle);
    wins += Number(guess === bit);
    if (index === 0) {
      firstTrace = [
        `Challenge: RSA-OAEP encryption of m${bit}.`,
        'Exact challenge query: refused by byte comparison.',
        'Adversary flipped one ciphertext bit and queried the oracle.',
        'OAEP decoding rejected uniformly; the modified ciphertext revealed nothing and the adversary guessed.',
      ];
    }
  }
  const estimate = estimateAdvantage(wins, trials);
  return {
    scheme: 'rsa-oaep-cca',
    wins,
    losses: trials - wins,
    errors: 0,
    trials,
    advantage: estimate.estimate,
    interval: [estimate.low, estimate.high],
    exactChallengeRejected,
    trace: firstTrace,
  };
}