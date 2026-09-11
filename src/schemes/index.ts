import type { CpaScheme } from '../game/types';
import { createAesSchemes } from './aes-modes';
import { createElGamalScheme } from './elgamal';
import { createRsaOaepScheme } from './rsa-oaep';
import { createTextbookRsaScheme } from './rsa-textbook';

export async function createSchemeRegistry(): Promise<Map<string, CpaScheme>> {
  const schemes = [
    await createRsaOaepScheme(),
    createElGamalScheme(),
    await createTextbookRsaScheme(),
    ...(await createAesSchemes()),
  ];
  return new Map(schemes.map((scheme) => [scheme.id, scheme]));
}

// [extension] point: add future KEM and encryption schemes through this registry.