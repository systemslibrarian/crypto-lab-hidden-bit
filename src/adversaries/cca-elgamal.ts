import { ristretto255 } from '@noble/curves/ed25519.js';
import type { CcaAdversary } from '../game/types';

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export const elgamalMalleateByGenerator: CcaAdversary = {
  id: 'elgamal-malleate-generator',
  label: 'Malleate by one group element',
  async guess(view, oracle) {
    if (view.ciphertext.length !== 64) throw new Error('Expected a 64-byte ristretto255 ElGamal ciphertext.');
    const first = ristretto255.Point.fromBytes(view.ciphertext.slice(0, 32));
    const second = ristretto255.Point.fromBytes(view.ciphertext.slice(32));
    const shifted = second.add(ristretto255.Point.BASE);
    const modified = new Uint8Array(64);
    modified.set(first.toBytes(), 0);
    modified.set(shifted.toBytes(), 32);
    const answer = await oracle.decrypt(modified);
    if (!answer) throw new Error('ElGamal oracle rejected a valid modified ciphertext.');
    const recovered = ristretto255.Point.fromBytes(answer).subtract(ristretto255.Point.BASE).toBytes();
    return equal(recovered, view.messages[0]) ? 0 : 1;
  },
};