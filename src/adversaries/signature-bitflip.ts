import type { SignatureMutationAdversary } from '../game/types';

export const flipFirstSignatureBit: SignatureMutationAdversary = {
  id: 'flip-first-signature-bit',
  mutate(signature) {
    if (signature.length === 0) throw new Error('Cannot mutate an empty signature.');
    const candidate = signature.slice();
    candidate[0] = candidate[0]! ^ 1;
    return candidate;
  },
};