import type { CcaAdversary } from '../game/types';

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export const rsaOaepBitFlip: CcaAdversary = {
  id: 'rsa-oaep-bit-flip',
  label: 'Flip one ciphertext bit',
  async guess(view, oracle) {
    const modified = view.ciphertext.slice();
    modified[modified.length - 1] = modified[modified.length - 1]! ^ 1;
    const answer = await oracle.decrypt(modified);
    if (answer) return equal(answer, view.messages[0]) ? 0 : 1;
    return (crypto.getRandomValues(new Uint8Array(1))[0]! & 1) as 0 | 1;
  },
};