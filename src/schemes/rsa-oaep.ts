import type { CpaScheme } from '../game/types';
import { textEncoder, toArrayBuffer } from './utils';
import { getRsaMaterial } from './rsa-textbook';

const MESSAGES = [textEncoder.encode('balance=00000100'), textEncoder.encode('balance=90000100')] as const;

export async function createRsaOaepScheme(): Promise<CpaScheme> {
  const { oaepPublic } = await getRsaMaterial();
  const encrypt = async (message: Uint8Array) => {
    const body = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        oaepPublic,
        toArrayBuffer(message),
      ),
    );
    return { bytes: body, body };
  };
  return {
    id: 'rsa-oaep',
    label: 'RSA-OAEP',
    family: 'public-key',
    broken: false,
    detail: 'RSA-2048 OAEP with SHA-256 through WebCrypto.',
    messages: MESSAGES,
    challenge: encrypt,
    oracle: { encrypt },
  };
}