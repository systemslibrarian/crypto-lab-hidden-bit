import { ed25519 } from '@noble/curves/ed25519.js';

export function signEd25519(message: Uint8Array): {
  publicKey: Uint8Array;
  signature: Uint8Array;
} {
  const { secretKey, publicKey } = ed25519.keygen();
  return { publicKey, signature: ed25519.sign(message, secretKey) };
}

export function verifyEd25519(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return ed25519.verify(signature, message, publicKey, { zip215: false });
}