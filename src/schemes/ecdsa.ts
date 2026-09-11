import { secp256k1 } from '@noble/curves/secp256k1.js';

export interface EcdsaSignature {
  readonly message: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly signature: Uint8Array;
  readonly n: bigint;
}

export function signEcdsa(message: Uint8Array): EcdsaSignature {
  const { secretKey, publicKey } = secp256k1.keygen();
  const signature = secp256k1.sign(message, secretKey, {
    prehash: true,
    lowS: true,
    format: 'compact',
    extraEntropy: false,
  });
  return { message, publicKey, signature, n: secp256k1.Point.Fn.ORDER };
}

export function verifyEcdsaPlain(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return secp256k1.verify(signature, message, publicKey, {
    prehash: true,
    lowS: false,
    format: 'compact',
  });
}

export function verifyEcdsaLowS(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return secp256k1.verify(signature, message, publicKey);
}