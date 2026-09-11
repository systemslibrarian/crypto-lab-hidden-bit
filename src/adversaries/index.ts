import type { CpaAdversary } from '../game/types';
import { beastIvPredictor } from './beast';
import { randomGuess } from './random';
import { reencryptAndCompare } from './reencrypt';

export const adversaries = new Map<string, CpaAdversary>(
  [randomGuess, reencryptAndCompare, beastIvPredictor].map((strategy) => [strategy.id, strategy]),
);