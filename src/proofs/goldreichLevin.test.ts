import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_GL_RECONSTRUCTION_VOTES,
  MAX_GL_SUBSETS,
  type GoldreichLevinInput,
  planGoldreichLevin,
  reconstructGoldreichLevin,
} from './goldreichLevin';
import { bitVectorKey, innerProductMod2, type Bit, type BitVector } from './hardcore';

function bits(value: string): BitVector {
  return Uint8Array.from(value, (bit) => Number(bit));
}

function vectorFromInteger(value: number, n: number): BitVector {
  return Uint8Array.from({ length: n }, (_unused, index) => (value >>> (n - index - 1)) & 1);
}

function seededUniformSource(initialState: number): (length: number) => BitVector {
  let state = initialState >>> 0;
  return (length) => Uint8Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 31;
  });
}

/**
 * Deliberately bounded and brute-forceable teaching fixture.  This fixed,
 * six-bit domain is not a one-way-function instantiation or security claim.
 */
function boundedTeachingSha(candidate: BitVector): string {
  return createHash('sha256')
    .update('Hidden Bit bounded brute-forceable GL fixture v1\0', 'utf8')
    .update(Uint8Array.of(candidate.length))
    .update(candidate)
    .digest('hex');
}

function controlledPredictor(secret: BitVector, r: BitVector): Bit {
  const error = Number(r[0] === 0 && r[1] === 0) as Bit;
  return (innerProductMod2(secret, r) ^ error) as Bit;
}

describe('bounded Rackoff-style Goldreich-Levin reconstruction', () => {
  it('derives ell, the nonempty subset count, and exact query/work accounting', () => {
    const plan = planGoldreichLevin(6, 0.25);
    expect(plan).toEqual({
      n: 6,
      epsilon: 0.25,
      ell: 7,
      subsetCount: 127,
      sigmaGuesses: 128,
      predictorQueries: 762,
      reconstructionVotes: 97_536,
    });
  });

  it('recovers through predictor access and independent f(candidate)=y verification', async () => {
    const secret = bits('101101');
    const y = boundedTeachingSha(secret);
    let calls = 0;
    const input: GoldreichLevinInput<string> = {
      y,
      n: secret.length,
      epsilon: 0.25,
      predictor: (_image, r) => {
        calls += 1;
        return controlledPredictor(secret, r);
      },
      verifyPreimage: (candidate, image) => boundedTeachingSha(candidate) === image,
      sampleUniform: seededUniformSource(0x91e1_0da5),
    };

    // @ts-expect-error The reconstruction API deliberately has no secret-x input.
    const forbiddenSecretInput: GoldreichLevinInput<string> = { ...input, x: secret };
    expect(forbiddenSecretInput).toHaveProperty('x');

    const result = await reconstructGoldreichLevin(input);
    expect(result.status).toBe('recovered');
    expect(result.predictorQueries).toBe(result.n * result.subsetCount);
    expect(calls).toBe(result.predictorQueries);
    expect(result.sigmaGuesses).toBe(2 ** result.ell);
    expect(result.verifiedCandidates.map(bitVectorKey)).toContain(bitVectorKey(secret));
    for (const candidate of result.verifiedCandidates) expect(boundedTeachingSha(candidate)).toBe(y);
  });

  it('uses a predictor whose exact finite success is 1/2+epsilon, while normalized advantage is 2epsilon', () => {
    const secret = bits('101101');
    let correct = 0;
    for (let value = 0; value < 2 ** secret.length; value += 1) {
      const r = vectorFromInteger(value, secret.length);
      correct += Number(controlledPredictor(secret, r) === innerProductMod2(secret, r));
    }
    const success = correct / (2 ** secret.length);
    const epsilon = success - 0.5;
    expect(success).toBe(0.75);
    expect(epsilon).toBe(0.25);
    expect((2 * success) - 1).toBe(2 * epsilon);
  });

  it('deduplicates sigma-derived candidates before verification and reports honest failure', async () => {
    let verifierCalls = 0;
    const result = await reconstructGoldreichLevin({
      y: 'no matching preimage',
      n: 1,
      epsilon: 0.5,
      predictor: () => 0,
      verifyPreimage: () => {
        verifierCalls += 1;
        return false;
      },
      // A fixed source is intentionally nonuniform: it demonstrates that the
      // theorem's uniform-source premise matters and supplies no guarantee.
      sampleUniform: (length) => new Uint8Array(length),
    });
    expect(result.status).toBe('no-verified-candidate');
    expect(result.verifiedCandidates).toEqual([]);
    expect(result.uniqueCandidates.length).toBeLessThan(result.sigmaGuesses);
    expect(verifierCalls).toBe(result.uniqueCandidates.length);
    expect(result.predictorQueries).toBe(7);
  });

  it('reports failure when the claimed bias premise is absent instead of retrying until success', async () => {
    const n = 10;
    const firstPass = await reconstructGoldreichLevin({
      y: 'find the emitted list',
      n,
      epsilon: 0.25,
      // For every nonzero x this constant predictor has success exactly 1/2,
      // so the theorem offers no reconstruction guarantee.
      predictor: () => 0,
      verifyPreimage: () => false,
      sampleUniform: seededUniformSource(0x4d59_5df4),
    });
    const emitted = new Set(firstPass.uniqueCandidates.map(bitVectorKey));
    let absent: BitVector | undefined;
    for (let value = 1; value < 2 ** n; value += 1) {
      const candidate = vectorFromInteger(value, n);
      if (!emitted.has(bitVectorKey(candidate))) {
        absent = candidate;
        break;
      }
    }
    expect(absent, 'a list of at most 256 candidates cannot cover 1,024 inputs').toBeDefined();
    const image = bitVectorKey(absent!);
    const result = await reconstructGoldreichLevin({
      y: image,
      n,
      epsilon: 0.25,
      predictor: () => 0,
      verifyPreimage: (candidate, expected) => bitVectorKey(candidate) === expected,
      sampleUniform: seededUniformSource(0x4d59_5df4),
    });
    expect(result.status).toBe('no-verified-candidate');
    expect(result.verifiedCandidates).toEqual([]);
  });

  it('does not accept a candidate merely because reconstruction emitted it', async () => {
    const secret = bits('101101');
    const wrongImage = boundedTeachingSha(bits('000000'));
    const result = await reconstructGoldreichLevin({
      y: wrongImage,
      n: secret.length,
      epsilon: 0.25,
      predictor: (_image, r) => controlledPredictor(secret, r),
      verifyPreimage: (candidate, image) => boundedTeachingSha(candidate) === image,
      sampleUniform: seededUniformSource(0x91e1_0da5),
    });
    expect(result.verifiedCandidates.map(bitVectorKey)).not.toContain(bitVectorKey(secret));
    for (const candidate of result.verifiedCandidates) expect(boundedTeachingSha(candidate)).toBe(wrongImage);
  });

  it('rejects invalid theorem parameters and work beyond the teaching caps', () => {
    for (const n of [0, -1, 1.5, 257]) expect(() => planGoldreichLevin(n, 0.25)).toThrow('n must');
    for (const epsilon of [0, -0.1, 0.500_001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planGoldreichLevin(6, epsilon)).toThrow('epsilon');
    }
    expect(() => planGoldreichLevin(256, 0.01)).toThrow(`${MAX_GL_SUBSETS}`);
    expect(() => planGoldreichLevin(32, 0.25)).toThrow(`${MAX_GL_RECONSTRUCTION_VOTES}`);
  });

  it('rejects malformed samples, predictor bits, and verifier results', async () => {
    const common = {
      y: 'fixture',
      n: 1,
      epsilon: 0.5,
      predictor: () => 0 as Bit,
      verifyPreimage: () => false,
      sampleUniform: (length: number) => new Uint8Array(length),
    };
    await expect(reconstructGoldreichLevin({ ...common, sampleUniform: () => new Uint8Array(2) })).rejects.toThrow('exactly 1');
    await expect(reconstructGoldreichLevin({ ...common, sampleUniform: () => Uint8Array.of(2) })).rejects.toThrow('0 or 1');
    await expect(reconstructGoldreichLevin({ ...common, predictor: () => 2 as Bit })).rejects.toThrow('Predictor output');
    await expect(reconstructGoldreichLevin({
      ...common,
      verifyPreimage: () => 'yes' as unknown as boolean,
    })).rejects.toThrow('boolean');
    await expect(reconstructGoldreichLevin({ ...common, predictor: null as never })).rejects.toThrow('predictor');
    await expect(reconstructGoldreichLevin({ ...common, verifyPreimage: null as never })).rejects.toThrow('verifier');
    await expect(reconstructGoldreichLevin({ ...common, sampleUniform: null as never })).rejects.toThrow('source');
  });
});
