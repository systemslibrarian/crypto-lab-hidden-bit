import type { CpaAdversary } from '../game/types';

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export const beastIvPredictor: CpaAdversary = {
  id: 'beast',
  label: 'BEAST-style IV predictor',
  async guess(view, oracle) {
    const { iv, body } = view.ciphertext;
    if (view.schemeId !== 'aes-cbc-chained' || !iv || !body || body.length < 16) {
      throw new Error('The IV predictor requires chained AES-CBC with a visible first and last block.');
    }
    const nextIv = body.slice(-16);
    const probe = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) {
      probe[index] = view.messages[0][index]! ^ iv[index]! ^ nextIv[index]!;
    }
    const answer = await oracle.encrypt(probe);
    if (!answer.body || answer.body.length < 16) throw new Error('CBC oracle returned no ciphertext block.');
    return equal(answer.body.slice(0, 16), body.slice(0, 16)) ? 0 : 1;
  },
};