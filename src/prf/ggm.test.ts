import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildTree, derivePath, expandAes, expandRepeat, firstBit, parseSeedHex, seedHex } from './ggm';

const ROOT = parseSeedHex('00112233445566778899aabbccddeeff');

function referenceExpand(seed: Uint8Array): readonly [Uint8Array, Uint8Array] {
  const input = Buffer.alloc(32);
  input[31] = 1;
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(seed), null);
  cipher.setAutoPadding(false);
  const output = Buffer.concat([cipher.update(input), cipher.final()]);
  return [Uint8Array.from(output.subarray(0, 16)), Uint8Array.from(output.subarray(16))];
}

describe('GGM branch generators', () => {
  it('uses two independently checked AES block evaluations, exactly 128 bits each', () => {
    const [left, right] = expandAes(ROOT);
    const [expectedLeft, expectedRight] = referenceExpand(ROOT);
    expect(left).toEqual(expectedLeft);
    expect(right).toEqual(expectedRight);
    expect(left).toHaveLength(16);
    expect(right).toHaveLength(16);
    expect(left).not.toEqual(right);
  });

  it('walks left and right in input order and leaves the caller seed untouched', () => {
    const original = ROOT.slice();
    let independent: Uint8Array = ROOT.slice();
    for (const bit of '010') independent = referenceExpand(independent)[Number(bit)]!;
    expect(derivePath(ROOT, '010', 'aes')).toEqual(independent);
    const levels = buildTree(ROOT, 'aes');
    expect(levels.map((level) => level.length)).toEqual([1, 2, 4, 8]);
    expect(levels[3]!.find((node) => node.path === '010')!.seed).toEqual(independent);
    expect(ROOT).toEqual(original);
    expect(derivePath(ROOT, '010', 'aes')).toEqual(derivePath(ROOT, '010', 'aes'));
  });

  it('makes the s||s failure unmistakable at every leaf', () => {
    const [left, right] = expandRepeat(ROOT);
    expect(left).toEqual(ROOT);
    expect(right).toEqual(ROOT);
    const leaves = buildTree(ROOT, 'repeat')[3]!;
    expect(leaves.map((node) => node.path)).toEqual(['000', '001', '010', '011', '100', '101', '110', '111']);
    for (const leaf of leaves) {
      expect(leaf.seed).toEqual(ROOT);
      expect(firstBit(leaf.seed)).toBe(firstBit(ROOT));
    }
  });

  it('validates path, length, and seed encoding instead of accepting a partial key', () => {
    expect(seedHex(parseSeedHex(seedHex(ROOT)))).toBe(seedHex(ROOT));
    expect(() => parseSeedHex('0')).toThrow();
    expect(() => expandAes(new Uint8Array(15))).toThrow();
    expect(() => derivePath(ROOT, '02', 'aes')).toThrow();
    expect(() => buildTree(ROOT, 'aes', 4)).toThrow();
  });
});
