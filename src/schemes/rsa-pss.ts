import { getRsaMaterial } from './rsa-textbook';
import { toArrayBuffer } from './utils';

export async function signPss(message: Uint8Array): Promise<Uint8Array> {
  const { pssPrivate } = await getRsaMaterial();
  return new Uint8Array(
    await crypto.subtle.sign(
      { name: 'RSA-PSS', saltLength: 32 },
      pssPrivate,
      toArrayBuffer(message),
    ),
  );
}

export async function verifyPss(message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const { pssPublic } = await getRsaMaterial();
  return crypto.subtle.verify(
    { name: 'RSA-PSS', saltLength: 32 },
    pssPublic,
    toArrayBuffer(signature),
    toArrayBuffer(message),
  );
}