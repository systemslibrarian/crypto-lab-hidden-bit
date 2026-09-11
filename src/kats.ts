import { ecb } from '@noble/ciphers/aes.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { fromHex, textEncoder, toHex } from './schemes/utils';

export interface KatResult {
  readonly id: string;
  readonly source: string;
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
}

export function runKnownAnswerTests(): KatResult[] {
  const aesKey = fromHex('000102030405060708090a0b0c0d0e0f');
  const aesPlaintext = fromHex('00112233445566778899aabbccddeeff');
  const aesExpected = '69c4e0d86a7b0430d8cdb78070b4c55a';
  const aesActual = toHex(ecb(aesKey, { disablePadding: true }).encrypt(aesPlaintext));

  const ecdsaPrivate = fromHex('c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721');
  const ecdsa = p256.Signature.fromBytes(
    p256.sign(textEncoder.encode('sample'), ecdsaPrivate, {
      prehash: true,
      lowS: false,
      format: 'compact',
      extraEntropy: false,
    }),
    'compact',
  );
  const ecdsaExpected =
    'efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716' +
    'f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8';
  const ecdsaActual = `${ecdsa.r.toString(16).padStart(64, '0')}${ecdsa.s.toString(16).padStart(64, '0')}`;

  const edSeed = fromHex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
  const edExpected =
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
    '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';
  const edActual = toHex(ed25519.sign(new Uint8Array(), edSeed));

  return [
    { id: 'aes-128', source: 'FIPS 197 C.1', passed: aesActual === aesExpected, expected: aesExpected, actual: aesActual },
    { id: 'ecdsa-p256', source: 'RFC 6979 A.2.5', passed: ecdsaActual === ecdsaExpected, expected: ecdsaExpected, actual: ecdsaActual },
    { id: 'ed25519', source: 'RFC 8032 7.1 test 1', passed: edActual === edExpected, expected: edExpected, actual: edActual },
  ];
}