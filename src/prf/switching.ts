import { collisionFinder } from '../adversaries/prp-collision';
import { estimateAdvantage } from '../game/advantage';
import { randomBit, randomBytes } from '../schemes/utils';

export interface SwitchingPoint {
  readonly bits: number;
  readonly queries: number;
  readonly trials: number;
  readonly wins: number;
  readonly measured: number;
  readonly wilsonLow: number;
  readonly wilsonHigh: number;
  readonly tolerance: number;
  readonly bound: number;
  readonly withinTolerance: boolean;
}

export const MAX_SWITCHING_QUERIES = 4_096;
export const MAX_SWITCHING_WORK = 2_000_000;

function randomInteger(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
    throw new Error('Sampler domain must be an integer in 1..2^32.');
  }
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  let value = 0;
  do {
    const bytes = randomBytes(4);
    value = ((bytes[0]! * 0x1_000_000) + (bytes[1]! << 16) + (bytes[2]! << 8) + bytes[3]!) >>> 0;
  } while (value >= limit);
  return value % maxExclusive;
}

export class LazyRandomFunction {
  readonly #domainSize: number;
  readonly #table = new Map<number, number>();

  constructor(bits: number) {
    this.#domainSize = domainSize(bits);
  }

  query(input: number): number {
    if (!Number.isInteger(input) || input < 0 || input >= this.#domainSize) {
      throw new Error('Function query is outside the n-bit domain.');
    }
    const existing = this.#table.get(input);
    if (existing !== undefined) return existing;
    const output = randomInteger(this.#domainSize);
    this.#table.set(input, output);
    return output;
  }
}

export class LazyRandomPermutation {
  readonly #domainSize: number;
  readonly #table = new Map<number, number>();
  readonly #used = new Set<number>();

  constructor(bits: number) {
    this.#domainSize = domainSize(bits);
  }

  query(input: number): number {
    if (!Number.isInteger(input) || input < 0 || input >= this.#domainSize) {
      throw new Error('Permutation query is outside the n-bit domain.');
    }
    const existing = this.#table.get(input);
    if (existing !== undefined) return existing;
    if (this.#used.size >= this.#domainSize) throw new Error('Permutation range is exhausted.');
    let output = randomInteger(this.#domainSize);
    while (this.#used.has(output)) output = randomInteger(this.#domainSize);
    this.#used.add(output);
    this.#table.set(input, output);
    return output;
  }
}

function domainSize(bits: number): number {
  if (!Number.isInteger(bits) || bits < 8 || bits > 20) throw new Error('n must be an integer from 8 through 20.');
  return 2 ** bits;
}

export function switchingBound(bits: number, queries: number): number {
  const size = domainSize(bits);
  if (!Number.isInteger(queries) || queries < 1 || queries > Math.min(size, MAX_SWITCHING_QUERIES)) {
    throw new Error('q must be an integer with 1 <= q <= min(2^n, 4,096).');
  }
  return (queries * (queries - 1)) / (2 * size);
}

export function exactFunctionCollisionProbability(bits: number, queries: number): number {
  const size = domainSize(bits);
  if (!Number.isInteger(queries) || queries < 1 || queries > Math.min(size, MAX_SWITCHING_QUERIES)) {
    throw new Error('q must be an integer with 1 <= q <= min(2^n, 4,096).');
  }
  let noCollision = 1;
  for (let index = 0; index < queries; index += 1) noCollision *= (size - index) / size;
  return 1 - noCollision;
}

export function runSwitchingPoint(bits: number, queries: number, trials: number): SwitchingPoint {
  switchingBound(bits, queries);
  if (!Number.isInteger(trials) || trials < 10 || trials > 5_000) {
    throw new Error('Switching trials must be an integer from 10 through 5,000.');
  }
  if (queries * trials > MAX_SWITCHING_WORK) {
    throw new Error('Switching point exceeds the 2,000,000-oracle-call work cap.');
  }
  let wins = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const bit = randomBit();
    const oracle = bit === 0 ? new LazyRandomPermutation(bits) : new LazyRandomFunction(bits);
    const guess = collisionFinder.guess(queries, oracle);
    wins += Number(guess === bit);
  }
  const estimate = estimateAdvantage(wins, trials);
  const bound = switchingBound(bits, queries);
  const tolerance = Math.max(
    estimate.conservativeRadius,
    Math.sqrt((2 * Math.log(2_000_000)) / trials),
  );
  return {
    bits,
    queries,
    trials,
    wins,
    measured: estimate.estimate,
    wilsonLow: estimate.low,
    wilsonHigh: estimate.high,
    tolerance,
    bound,
    withinTolerance: estimate.estimate <= bound + tolerance,
  };
}

export function scaledBound128(queries: number): string {
  if (!Number.isInteger(queries) || queries < 1) throw new Error('q must be a positive integer.');
  const numerator = BigInt(queries) * BigInt(queries - 1);
  return `${numerator} / 2^129`;
}