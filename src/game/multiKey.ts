import { randomBit, randomBytes } from '../schemes/utils';

/** A deliberately abstract game. Each oracle call independently reveals a
 * shared challenge bit with a public "signal" tag, or reveals nothing. Users
 * label independent key instances; no actual encryption is performed here. */
export interface MultiKeyConfig {
  readonly users: number;
  readonly queriesPerUser: number;
  readonly epsilon: number;
}

export interface MultiKeyBudget {
  readonly totalQueries: number;
  readonly exactAdvantage: number;
  readonly unionBound: number;
}

export function multiKeyBudget(config: MultiKeyConfig): MultiKeyBudget {
  const { users, queriesPerUser, epsilon } = config;
  if (!Number.isInteger(users) || users < 1 || users > 8 ||
      !Number.isInteger(queriesPerUser) || queriesPerUser < 1 || queriesPerUser > 8 ||
      !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1) {
    throw new Error('Choose 1–8 users, 1–8 queries per user, and a per-query chance from 0 to 1.');
  }
  const totalQueries = users * queriesPerUser;
  return {
    totalQueries,
    exactAdvantage: 1 - (1 - epsilon) ** totalQueries,
    unionBound: Math.min(1, totalQueries * epsilon),
  };
}

function uniformFraction(): number {
  const bytes = randomBytes(4);
  return ((bytes[0]! * 0x1000000) + (bytes[1]! * 0x10000) + (bytes[2]! * 0x100) + bytes[3]!) / 0x100000000;
}

export interface MultiKeyRun {
  readonly challengeBit: number;
  readonly guess: number;
  readonly revealedByUser: readonly number[];
  readonly won: boolean;
}

export function runMultiKeyGame(config: MultiKeyConfig, fraction: () => number = uniformFraction,
                                bit: () => number = randomBit): MultiKeyRun {
  multiKeyBudget(config);
  const challengeBit = bit();
  const revealedByUser: number[] = [];
  for (let user = 0; user < config.users; user += 1) {
    let reveals = 0;
    for (let query = 0; query < config.queriesPerUser; query += 1) {
      const draw = fraction();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error('Sampler must return [0, 1).');
      if (draw < config.epsilon) reveals += 1;
    }
    revealedByUser.push(reveals);
  }
  const guess = revealedByUser.some(count => count > 0) ? challengeBit : bit();
  return { challengeBit, guess, revealedByUser, won: guess === challengeBit };
}
