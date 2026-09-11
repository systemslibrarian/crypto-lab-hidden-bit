import { ecb } from '@noble/ciphers/aes.js';
import type { CiphertextView, CpaScheme } from '../game/types';
import { concatBytes, randomBytes, textEncoder, toArrayBuffer } from './utils';

const MESSAGES = [
  textEncoder.encode('TRANSFER:ALICE!!'),
  textEncoder.encode('TRANSFER:BOB!!!!'),
] as const;

async function importAesKey(raw: Uint8Array, name: 'AES-CBC' | 'AES-CTR' | 'AES-GCM') {
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name }, false, ['encrypt', 'decrypt']);
}

function envelope(iv: Uint8Array, body: ArrayBuffer): CiphertextView {
  const bodyBytes = new Uint8Array(body);
  return { bytes: concatBytes(iv, bodyBytes), iv, body: bodyBytes };
}

export async function createAesSchemes(): Promise<CpaScheme[]> {
  const raw = randomBytes(16);
  const [cbcKey, ctrKey, gcmKey] = await Promise.all([
    importAesKey(raw, 'AES-CBC'),
    importAesKey(raw, 'AES-CTR'),
    importAesKey(raw, 'AES-GCM'),
  ]);
  let chainedIv = randomBytes(16);

  const encryptEcb = async (message: Uint8Array): Promise<CiphertextView> => {
    if (message.length !== 16) throw new Error('AES-ECB exhibit accepts exactly one 16-byte block.');
    const body = ecb(raw, { disablePadding: true }).encrypt(message);
    return { bytes: body, body };
  };

  const encryptChainedCbc = async (message: Uint8Array): Promise<CiphertextView> => {
    const iv = chainedIv.slice();
    const body = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-CBC', iv: toArrayBuffer(iv) }, cbcKey, toArrayBuffer(message)),
    );
    chainedIv = body.slice(-16);
    return { bytes: concatBytes(iv, body), iv, body };
  };

  const encryptCtr = async (message: Uint8Array): Promise<CiphertextView> => {
    const counter = randomBytes(16);
    return envelope(
      counter,
      await crypto.subtle.encrypt(
        { name: 'AES-CTR', counter: toArrayBuffer(counter), length: 64 },
        ctrKey,
        toArrayBuffer(message),
      ),
    );
  };

  const encryptGcm = async (message: Uint8Array): Promise<CiphertextView> => {
    const iv = randomBytes(12);
    return envelope(
      iv,
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, gcmKey, toArrayBuffer(message)),
    );
  };

  return [
    {
      id: 'aes-gcm',
      label: 'AES-GCM',
      family: 'symmetric',
      broken: false,
      detail: 'AES-128-GCM with a fresh 96-bit nonce from WebCrypto.',
      messages: MESSAGES,
      challenge: encryptGcm,
      oracle: { encrypt: encryptGcm },
    },
    {
      id: 'aes-ctr',
      label: 'AES-CTR',
      family: 'symmetric',
      broken: false,
      detail: 'AES-128-CTR with a fresh 128-bit counter block from WebCrypto.',
      messages: MESSAGES,
      challenge: encryptCtr,
      oracle: { encrypt: encryptCtr },
    },
    {
      id: 'aes-cbc-chained',
      label: 'AES-CBC, chained IV',
      family: 'symmetric',
      broken: true,
      detail: 'WebCrypto AES-128-CBC whose next IV is the previous ciphertext tail.',
      messages: MESSAGES,
      challenge: encryptChainedCbc,
      oracle: { encrypt: encryptChainedCbc },
    },
    {
      id: 'aes-ecb',
      label: 'AES-ECB',
      family: 'symmetric',
      broken: true,
      detail: 'Noble AES-128-ECB, the named library used because WebCrypto omits ECB.',
      messages: MESSAGES,
      challenge: encryptEcb,
      oracle: { encrypt: encryptEcb },
    },
  ];
}

// [extension] point: register another symmetric IND-CPA construction here.