import { ecb } from '@noble/ciphers/aes.js';

export const GGM_SEED_BYTES = 16;
export const GGM_DEMO_DEPTH = 3;

export type GeneratorMode = 'aes' | 'repeat';
export interface GgmNode {
  readonly path: string;
  readonly seed: Uint8Array;
}

function checkSeed(seed: Uint8Array): void {
  if (seed.length !== GGM_SEED_BYTES) throw new Error('A GGM node needs a 128-bit seed.');
}

/**
 * G(s) = AES_s(0^128) || AES_s(0^127 || 1).
 * Under the AES-128 PRP assumption this is a 128-to-256-bit PRG candidate.
 * The input seed is the AES key, not a plaintext or a counter.
 */
export function expandAes(seed: Uint8Array): readonly [Uint8Array, Uint8Array] {
  checkSeed(seed);
  const inputs = new Uint8Array(2 * GGM_SEED_BYTES);
  inputs[inputs.length - 1] = 1;
  const output = ecb(seed, { disablePadding: true }).encrypt(inputs);
  return [output.slice(0, GGM_SEED_BYTES), output.slice(GGM_SEED_BYTES)];
}

/** Deliberately non-pseudorandom: both branches copy their parent. */
export function expandRepeat(seed: Uint8Array): readonly [Uint8Array, Uint8Array] {
  checkSeed(seed);
  return [seed.slice(), seed.slice()];
}

export function derivePath(root: Uint8Array, path: string, mode: GeneratorMode): Uint8Array {
  checkSeed(root);
  if (!/^[01]*$/.test(path) || path.length > 128) throw new Error('Path must contain at most 128 binary digits.');
  let state: Uint8Array = root.slice();
  for (const bit of path) state = (mode === 'aes' ? expandAes(state) : expandRepeat(state))[Number(bit)]!;
  return state;
}

export function buildTree(root: Uint8Array, mode: GeneratorMode, depth = GGM_DEMO_DEPTH): readonly (readonly GgmNode[])[] {
  checkSeed(root);
  if (!Number.isInteger(depth) || depth < 0 || depth > GGM_DEMO_DEPTH) throw new Error('Tree depth is out of range.');
  const levels: GgmNode[][] = [[{ path: '', seed: root.slice() }]];
  for (let level = 0; level < depth; level++) {
    const children: GgmNode[] = [];
    for (const node of levels[level]!) {
      const [left, right] = mode === 'aes' ? expandAes(node.seed) : expandRepeat(node.seed);
      children.push({ path: `${node.path}0`, seed: left }, { path: `${node.path}1`, seed: right });
    }
    levels.push(children);
  }
  return levels;
}

export function firstBit(state: Uint8Array): 0 | 1 {
  checkSeed(state);
  return (state[0]! & 0x80) === 0 ? 0 : 1;
}

export function seedHex(state: Uint8Array): string {
  checkSeed(state);
  return Array.from(state, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function parseSeedHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('The seed must contain exactly 32 hexadecimal digits.');
  return Uint8Array.from(hex.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
}
