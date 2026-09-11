import type { CpaAdversary } from '../game/types';

export const randomGuess: CpaAdversary = {
  id: 'random',
  label: 'Random guess',
  async guess() {
    return (crypto.getRandomValues(new Uint8Array(1))[0]! & 1) as 0 | 1;
  },
};