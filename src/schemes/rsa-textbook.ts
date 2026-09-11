import type { CpaScheme } from '../game/types';
import {
  base64UrlToBytes,
  bigIntToBytes,
  bytesToBigInt,
  modPow,
} from './utils';

export interface RsaMaterial {
  readonly oaepPublic: CryptoKey;
  readonly oaepPrivate: CryptoKey;
  readonly pssPublic: CryptoKey;
  readonly pssPrivate: CryptoKey;
  readonly n: bigint;
  readonly e: bigint;
  readonly d: bigint;
  readonly modulusBytes: number;
}

let materialPromise: Promise<RsaMaterial> | undefined;

function portableJwk(jwk: JsonWebKey): JsonWebKey {
  const copy = { ...jwk };
  delete copy.alg;
  delete copy.key_ops;
  delete copy.use;
  return copy;
}

async function generateRsaMaterial(): Promise<RsaMaterial> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair;
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
  ]);
  if (!privateJwk.n || !privateJwk.e || !privateJwk.d) {
    throw new Error('WebCrypto exported an incomplete RSA private JWK.');
  }
  const [pssPublic, pssPrivate] = await Promise.all([
    crypto.subtle.importKey(
      'jwk',
      portableJwk(publicJwk),
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['verify'],
    ),
    crypto.subtle.importKey(
      'jwk',
      portableJwk(privateJwk),
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['sign'],
    ),
  ]);
  const modulus = base64UrlToBytes(privateJwk.n);
  return {
    oaepPublic: pair.publicKey,
    oaepPrivate: pair.privateKey,
    pssPublic,
    pssPrivate,
    n: bytesToBigInt(modulus),
    e: bytesToBigInt(base64UrlToBytes(privateJwk.e)),
    d: bytesToBigInt(base64UrlToBytes(privateJwk.d)),
    modulusBytes: modulus.length,
  };
}

export function getRsaMaterial(): Promise<RsaMaterial> {
  materialPromise ??= generateRsaMaterial();
  return materialPromise;
}

export function textbookEncrypt(message: bigint, material: RsaMaterial): bigint {
  if (message < 0n || message >= material.n) throw new Error('Textbook RSA requires 0 <= m < n.');
  return modPow(message, material.e, material.n);
}

export function textbookDecrypt(ciphertext: bigint, material: RsaMaterial): bigint {
  if (ciphertext < 0n || ciphertext >= material.n) throw new Error('Textbook RSA ciphertext is out of range.');
  return modPow(ciphertext, material.d, material.n);
}

export function textbookSign(message: bigint, material: RsaMaterial): bigint {
  if (message <= 0n || message >= material.n) throw new Error('Textbook RSA representative is out of range.');
  return modPow(message, material.d, material.n);
}

export function textbookVerify(message: bigint, signature: bigint, material: RsaMaterial): boolean {
  return signature > 0n && signature < material.n && modPow(signature, material.e, material.n) === message;
}

export async function createTextbookRsaScheme(): Promise<CpaScheme> {
  const material = await getRsaMaterial();
  const messages = [bigIntToBytes(42n), bigIntToBytes(43n)] as const;
  const encrypt = async (message: Uint8Array) => {
    const representative = bytesToBigInt(message);
    const body = bigIntToBytes(textbookEncrypt(representative, material), material.modulusBytes);
    return { bytes: body, body };
  };
  return {
    id: 'rsa-textbook',
    label: 'Textbook RSA',
    family: 'public-key',
    broken: true,
    detail: 'Raw m^e mod n over the same RSA-2048 JWK used by OAEP and PSS.',
    messages,
    challenge: encrypt,
    oracle: { encrypt },
  };
}