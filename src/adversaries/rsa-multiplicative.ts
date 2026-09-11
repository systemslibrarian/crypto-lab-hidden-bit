import type { TextbookForgeryAdversary } from '../game/types';

export const rsaMultiplicativeForgery: TextbookForgeryAdversary = {
  id: 'rsa-multiplicative',
  async forge(publicKey, oracle) {
    const first = 2n;
    const second = 3n;
    const [firstSignature, secondSignature] = await Promise.all([
      oracle.sign(first),
      oracle.sign(second),
    ]);
    return {
      message: (first * second) % publicKey.n,
      signature: (firstSignature * secondSignature) % publicKey.n,
      queried: [first, second],
    };
  },
};