import type { EcdsaMutationAdversary } from '../game/types';

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const output = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error('Integer does not fit in compact ECDSA field.');
  return output;
}

export const ecdsaHighSTwin: EcdsaMutationAdversary = {
  id: 'ecdsa-high-s',
  mutate(signature, order) {
    if (signature.length !== 64) throw new Error('Expected a compact 64-byte ECDSA signature.');
    const r = bytesToBigInt(signature.slice(0, 32));
    const s = bytesToBigInt(signature.slice(32));
    const malleatedS = order - s;
    const candidate = new Uint8Array(64);
    candidate.set(bigIntToBytes(r, 32), 0);
    candidate.set(bigIntToBytes(malleatedS, 32), 32);
    return { signature: candidate, r, s, malleatedS };
  },
};