import type { TextbookForgeryAdversary } from '../game/types';

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if ((power & 1n) === 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

function modInverse(value: bigint, modulus: bigint): bigint {
  let oldR = value % modulus;
  let remainder = modulus;
  let oldCoefficient = 1n;
  let coefficient = 0n;
  while (remainder !== 0n) {
    const quotient = oldR / remainder;
    [oldR, remainder] = [remainder, oldR - quotient * remainder];
    [oldCoefficient, coefficient] = [coefficient, oldCoefficient - quotient * coefficient];
  }
  if (oldR !== 1n) throw new Error('Blinder is not invertible modulo n.');
  return (oldCoefficient + modulus) % modulus;
}

export const rsaBlindingForgery: TextbookForgeryAdversary = {
  id: 'rsa-blinding',
  async forge(publicKey, oracle) {
    const target = 7n;
    const blinder = 2n;
    const blindedMessage = (target * modPow(blinder, publicKey.e, publicKey.n)) % publicKey.n;
    const oracleAnswer = await oracle.sign(blindedMessage);
    return {
      message: target,
      signature: (oracleAnswer * modInverse(blinder, publicKey.n)) % publicKey.n,
      queried: [blindedMessage],
    };
  },
};