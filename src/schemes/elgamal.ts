import { getMinHashLength, mapHashToField } from '@noble/curves/abstract/modular.js';
import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';
import type { CiphertextView, CpaScheme } from '../game/types';
import { bytesEqual, concatBytes, randomBytes, textEncoder } from './utils';

export type RistrettoPoint = ReturnType<typeof ristretto255.Point.fromBytes>;

export interface ElGamalCiphertext extends CiphertextView {
  readonly c1: RistrettoPoint;
  readonly c2: RistrettoPoint;
}

export interface ElGamalContext {
  readonly publicPoint: RistrettoPoint;
  readonly encrypt: (message: RistrettoPoint) => ElGamalCiphertext;
  readonly decrypt: (ciphertext: Uint8Array) => RistrettoPoint;
}

const MESSAGES = [textEncoder.encode('LEFT ENVELOPE!'), textEncoder.encode('RIGHT ENVELOPE')] as const;
const DST = 'crypto-lab-hidden-bit-elgamal-v1';

export function randomRistrettoScalar(): bigint {
  const { Fn } = ristretto255.Point;
  const seed = randomBytes(getMinHashLength(Fn.ORDER));
  return Fn.fromBytes(mapHashToField(seed, Fn.ORDER, Fn.isLE));
}

export function messageToPoint(message: Uint8Array): RistrettoPoint {
  return ristretto255_hasher.hashToCurve(message, { DST });
}

export function serializeElGamal(c1: RistrettoPoint, c2: RistrettoPoint): Uint8Array {
  return concatBytes(c1.toBytes(), c2.toBytes());
}

export function deserializeElGamal(bytes: Uint8Array): ElGamalCiphertext {
  if (bytes.length !== 64) throw new Error('ElGamal ciphertext must be exactly 64 bytes.');
  const c1 = ristretto255.Point.fromBytes(bytes.slice(0, 32));
  const c2 = ristretto255.Point.fromBytes(bytes.slice(32));
  const canonical = serializeElGamal(c1, c2);
  if (!bytesEqual(bytes, canonical)) throw new Error('ElGamal ciphertext is not canonical.');
  return { c1, c2, parts: [c1.toBytes(), c2.toBytes()], bytes: canonical };
}

export function createElGamalContext(): ElGamalContext {
  const privateScalar = randomRistrettoScalar();
  const publicPoint = ristretto255.Point.BASE.multiply(privateScalar);
  const encrypt = (message: RistrettoPoint): ElGamalCiphertext => {
    const ephemeral = randomRistrettoScalar();
    const c1 = ristretto255.Point.BASE.multiply(ephemeral);
    const c2 = message.add(publicPoint.multiply(ephemeral));
    return { c1, c2, parts: [c1.toBytes(), c2.toBytes()], bytes: serializeElGamal(c1, c2) };
  };
  const decrypt = (bytes: Uint8Array): RistrettoPoint => {
    const ciphertext = deserializeElGamal(bytes);
    return ciphertext.c2.subtract(ciphertext.c1.multiply(privateScalar));
  };
  return { publicPoint, encrypt, decrypt };
}

export function createElGamalScheme(): CpaScheme {
  const context = createElGamalContext();
  const encrypt = async (message: Uint8Array) => {
    if (!MESSAGES.some((label) => bytesEqual(label, message))) {
      throw new Error('ElGamal message is outside the two labelled group points.');
    }
    return context.encrypt(messageToPoint(message));
  };
  return {
    id: 'elgamal',
    label: 'ElGamal / ristretto255',
    family: 'public-key',
    broken: false,
    detail: 'Hand-rolled ElGamal over Noble ristretto255 with labelled hash-to-group messages.',
    messages: MESSAGES,
    challenge: encrypt,
    oracle: { encrypt },
  };
}