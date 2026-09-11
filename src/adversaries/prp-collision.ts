import type { SwitchingAdversary } from '../game/types';

export const collisionFinder: SwitchingAdversary = {
  id: 'collision-finder',
  label: 'Collision finder',
  guess(queries, oracle) {
    const outputs = new Set<number>();
    for (let input = 0; input < queries; input += 1) {
      const output = oracle.query(input);
      if (outputs.has(output)) return 1;
      outputs.add(output);
    }
    return 0;
  },
};