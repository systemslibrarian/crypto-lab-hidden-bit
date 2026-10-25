import {
  assertBitVector,
  bitVectorKey,
  type Bit,
  type BitVector,
} from './hardcore';

type Awaitable<Value> = Value | Promise<Value>;

export const MAX_GL_DIMENSION = 256 as const;
export const MAX_GL_SUBSETS = 4_095 as const;
export const MAX_GL_RECONSTRUCTION_VOTES = 20_000_000 as const;

export interface GoldreichLevinPlan {
  readonly n: number;
  /** Predictor excess: success probability is at least 1/2 + epsilon. */
  readonly epsilon: number;
  readonly ell: number;
  readonly subsetCount: number;
  readonly sigmaGuesses: number;
  readonly predictorQueries: number;
  readonly reconstructionVotes: number;
}

export interface GoldreichLevinInput<Image> {
  readonly y: Image;
  readonly n: number;
  /** Predictor excess over one half, not normalized advantage. */
  readonly epsilon: number;
  readonly predictor: (y: Image, r: BitVector) => Awaitable<Bit>;
  readonly verifyPreimage: (candidate: BitVector, y: Image) => Awaitable<boolean>;
  /** Must return fresh, uniform bits; injection makes the bounded run testable. */
  readonly sampleUniform: (length: number) => BitVector;
}

export interface GoldreichLevinResult extends GoldreichLevinPlan {
  readonly status: 'recovered' | 'no-verified-candidate';
  readonly samples: readonly BitVector[];
  readonly uniqueCandidates: readonly BitVector[];
  readonly verifiedCandidates: readonly BitVector[];
}

/**
 * Parameters for Goldreich's Rackoff-style, pairwise-independent reconstruction.
 * The explicit caps keep this browser lesson bounded; they are not theorem limits.
 */
export function planGoldreichLevin(n: number, epsilon: number): GoldreichLevinPlan {
  if (!Number.isInteger(n) || n < 1 || n > MAX_GL_DIMENSION) {
    throw new Error(`n must be an integer from 1 through ${MAX_GL_DIMENSION}.`);
  }
  if (!Number.isFinite(epsilon) || epsilon <= 0 || epsilon > 0.5) {
    throw new Error('epsilon must satisfy 0 < epsilon <= 1/2.');
  }

  const ell = Math.ceil(Math.log2((n / (epsilon * epsilon)) + 1));
  const sigmaGuesses = 2 ** ell;
  const subsetCount = sigmaGuesses - 1;
  if (!Number.isSafeInteger(subsetCount) || subsetCount > MAX_GL_SUBSETS) {
    throw new Error(`This bounded lesson permits at most ${MAX_GL_SUBSETS} nonempty subset XORs.`);
  }
  const predictorQueries = n * subsetCount;
  const reconstructionVotes = sigmaGuesses * predictorQueries;
  if (!Number.isSafeInteger(reconstructionVotes) || reconstructionVotes > MAX_GL_RECONSTRUCTION_VOTES) {
    throw new Error(`This bounded lesson permits at most ${MAX_GL_RECONSTRUCTION_VOTES} reconstruction votes.`);
  }
  return Object.freeze({ n, epsilon, ell, subsetCount, sigmaGuesses, predictorQueries, reconstructionVotes });
}

function xorForSubset(samples: readonly BitVector[], subsetMask: number, n: number): BitVector {
  const result = new Uint8Array(n);
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    if ((subsetMask & (2 ** sampleIndex)) === 0) continue;
    const sample = samples[sampleIndex]!;
    for (let bitIndex = 0; bitIndex < n; bitIndex += 1) {
      result[bitIndex] = result[bitIndex]! ^ sample[bitIndex]!;
    }
  }
  return result;
}

function maskParity(mask: number): Bit {
  let value = mask;
  let parity: Bit = 0;
  while (value > 0) {
    parity = (parity ^ (value % 2)) as Bit;
    value = Math.floor(value / 2);
  }
  return parity;
}

/**
 * Run the bounded reconstruction lemma.  This routine never receives x: its
 * only information about the hidden preimage is predictor access plus the
 * independent `verifyPreimage(candidate, y)` check.
 */
export async function reconstructGoldreichLevin<Image>(
  input: GoldreichLevinInput<Image>,
): Promise<GoldreichLevinResult> {
  const plan = planGoldreichLevin(input.n, input.epsilon);
  if (typeof input.predictor !== 'function') throw new Error('A predictor is required.');
  if (typeof input.verifyPreimage !== 'function') throw new Error('A preimage verifier is required.');
  if (typeof input.sampleUniform !== 'function') throw new Error('A uniform bit-vector source is required.');

  const samples: BitVector[] = [];
  for (let index = 0; index < plan.ell; index += 1) {
    const sample = input.sampleUniform(plan.n);
    assertBitVector(sample, plan.n, 'Uniform sample');
    samples.push(sample.slice());
  }

  const subsetXors: BitVector[] = [];
  for (let subsetMask = 1; subsetMask <= plan.subsetCount; subsetMask += 1) {
    subsetXors.push(xorForSubset(samples, subsetMask, plan.n));
  }

  const predictions: Bit[][] = Array.from({ length: plan.n }, () => []);
  let predictorQueries = 0;
  for (let bitIndex = 0; bitIndex < plan.n; bitIndex += 1) {
    for (const subset of subsetXors) {
      const query = subset.slice();
      query[bitIndex] = query[bitIndex]! ^ 1;
      const prediction = await input.predictor(input.y, query.slice());
      if (prediction !== 0 && prediction !== 1) throw new Error('Predictor output must be the bit 0 or 1.');
      predictions[bitIndex]!.push(prediction);
      predictorQueries += 1;
    }
  }
  if (predictorQueries !== plan.predictorQueries) {
    throw new Error('Internal predictor-query accounting mismatch.');
  }

  const unique = new Map<string, BitVector>();
  for (let sigmaMask = 0; sigmaMask < plan.sigmaGuesses; sigmaMask += 1) {
    const candidate = new Uint8Array(plan.n);
    for (let bitIndex = 0; bitIndex < plan.n; bitIndex += 1) {
      let oneVotes = 0;
      for (let subsetMask = 1; subsetMask <= plan.subsetCount; subsetMask += 1) {
        const rho = maskParity(sigmaMask & subsetMask);
        oneVotes += predictions[bitIndex]![subsetMask - 1]! ^ rho;
      }
      candidate[bitIndex] = Number(oneVotes * 2 > plan.subsetCount);
    }
    const key = bitVectorKey(candidate);
    if (!unique.has(key)) unique.set(key, candidate);
  }

  const uniqueCandidates = [...unique.values()];
  const verifiedCandidates: BitVector[] = [];
  for (const candidate of uniqueCandidates) {
    const verified = await input.verifyPreimage(candidate.slice(), input.y);
    if (typeof verified !== 'boolean') throw new Error('Preimage verifier must return a boolean.');
    if (verified) verifiedCandidates.push(candidate.slice());
  }

  return Object.freeze({
    ...plan,
    predictorQueries,
    status: verifiedCandidates.length > 0 ? 'recovered' : 'no-verified-candidate',
    samples: Object.freeze(samples.map((sample) => sample.slice())),
    uniqueCandidates: Object.freeze(uniqueCandidates.map((candidate) => candidate.slice())),
    verifiedCandidates: Object.freeze(verifiedCandidates.map((candidate) => candidate.slice())),
  });
}
