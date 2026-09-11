import type { CpaAdversary } from '../game/types';

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export const reencryptAndCompare: CpaAdversary = {
  id: 'reencrypt',
  label: 'Re-encrypt and compare',
  async guess(view, oracle) {
    const candidate = await oracle.encrypt(view.messages[0]);
    return equal(candidate.bytes, view.ciphertext.bytes) ? 0 : 1;
  },
};