export const textEncoder = new TextEncoder();

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomBit(): 0 | 1 {
  return (randomBytes(1)[0]! & 1) as 0 | 1;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function xorBytes(...chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array();
  const length = chunks[0]!.length;
  if (chunks.some((chunk) => chunk.length !== length)) {
    throw new Error('XOR inputs must have equal length.');
  }
  const output = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = chunks.reduce((value, chunk) => value ^ chunk[index]!, 0);
  }
  return output;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '');
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(normalized)) {
    throw new Error('Expected an even-length hexadecimal string.');
  }
  return Uint8Array.from(normalized.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt(`0x${toHex(bytes) || '0'}`);
}

export function bigIntToBytes(value: bigint, length?: number): Uint8Array {
  if (value < 0n) throw new Error('Cannot encode a negative integer.');
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  const bytes = fromHex(hex);
  if (length === undefined) return bytes;
  if (bytes.length > length) throw new Error('Integer does not fit in the requested length.');
  const output = new Uint8Array(length);
  output.set(bytes, length - bytes.length);
  return output;
}

export function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus <= 0n || exponent < 0n) throw new Error('Invalid modular exponentiation input.');
  let result = 1n;
  let factor = ((base % modulus) + modulus) % modulus;
  let power = exponent;
  while (power > 0n) {
    if ((power & 1n) === 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

export function modInverse(value: bigint, modulus: bigint): bigint {
  let oldR = ((value % modulus) + modulus) % modulus;
  let remainder = modulus;
  let oldCoefficient = 1n;
  let coefficient = 0n;
  while (remainder !== 0n) {
    const quotient = oldR / remainder;
    [oldR, remainder] = [remainder, oldR - quotient * remainder];
    [oldCoefficient, coefficient] = [coefficient, oldCoefficient - quotient * coefficient];
  }
  if (oldR !== 1n) throw new Error('Value has no modular inverse.');
  return (oldCoefficient + modulus) % modulus;
}