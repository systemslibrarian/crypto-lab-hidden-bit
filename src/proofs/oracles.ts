import { ecb } from '@noble/ciphers/aes.js';

export const AES_BLOCK_BYTES = 16 as const;

export type RandomBytesSource = (length: number) => Uint8Array;

export interface ByteOracle128 {
  readonly distinctQueryCount: number;
  query(input: Uint8Array): Uint8Array;
}

function assertBlock(value: Uint8Array, label: string): void {
  if (!(value instanceof Uint8Array) || value.length !== AES_BLOCK_BYTES) {
    throw new Error(`${label} must be exactly 16 bytes (128 bits).`);
  }
}

function blockKey(block: Uint8Array): string {
  let key = '';
  for (const byte of block) key += byte.toString(16).padStart(2, '0');
  return key;
}

function drawBlock(randomBytes: RandomBytesSource): Uint8Array {
  const drawn = randomBytes(AES_BLOCK_BYTES);
  assertBlock(drawn, 'Injected random source output');
  return drawn.slice();
}

/** A real AES-128 oracle whose cache is only an exact, semantics-preserving wrapper. */
export class MemoizedAes128Oracle implements ByteOracle128 {
  readonly #key: Uint8Array;
  readonly #table = new Map<string, Uint8Array>();

  constructor(key: Uint8Array) {
    assertBlock(key, 'AES-128 key');
    this.#key = key.slice();
  }

  get distinctQueryCount(): number {
    return this.#table.size;
  }

  query(input: Uint8Array): Uint8Array {
    assertBlock(input, 'AES oracle input');
    const cacheKey = blockKey(input);
    const cached = this.#table.get(cacheKey);
    if (cached !== undefined) return cached.slice();
    const output = ecb(this.#key, { disablePadding: true }).encrypt(input.slice());
    assertBlock(output, 'AES oracle output');
    this.#table.set(cacheKey, output.slice());
    return output.slice();
  }
}

/** A lazy uniform function on 128-bit blocks; distinct inputs may share an output. */
export class LazyRandomFunction128 implements ByteOracle128 {
  readonly #randomBytes: RandomBytesSource;
  readonly #table = new Map<string, Uint8Array>();

  constructor(randomBytes: RandomBytesSource) {
    if (typeof randomBytes !== 'function') throw new Error('A random byte source is required.');
    this.#randomBytes = randomBytes;
  }

  get distinctQueryCount(): number {
    return this.#table.size;
  }

  query(input: Uint8Array): Uint8Array {
    assertBlock(input, 'Random-function input');
    const cacheKey = blockKey(input);
    const cached = this.#table.get(cacheKey);
    if (cached !== undefined) return cached.slice();
    const output = drawBlock(this.#randomBytes);
    this.#table.set(cacheKey, output.slice());
    return output.slice();
  }
}

/** A lazy uniform permutation on 128-bit blocks, sampled without replacement. */
export class LazyIdealPermutation128 implements ByteOracle128 {
  readonly #randomBytes: RandomBytesSource;
  readonly #table = new Map<string, Uint8Array>();
  readonly #usedOutputs = new Set<string>();

  constructor(randomBytes: RandomBytesSource) {
    if (typeof randomBytes !== 'function') throw new Error('A random byte source is required.');
    this.#randomBytes = randomBytes;
  }

  get distinctQueryCount(): number {
    return this.#table.size;
  }

  query(input: Uint8Array): Uint8Array {
    assertBlock(input, 'Permutation input');
    const cacheKey = blockKey(input);
    const cached = this.#table.get(cacheKey);
    if (cached !== undefined) return cached.slice();

    // A uniform source terminates almost surely.  Do not impose a retry cap:
    // doing so would make this only statistically close to an ideal
    // permutation instead of an exact lazy representation of one.
    while (true) {
      const output = drawBlock(this.#randomBytes);
      const outputKey = blockKey(output);
      if (this.#usedOutputs.has(outputKey)) continue;
      this.#usedOutputs.add(outputKey);
      this.#table.set(cacheKey, output.slice());
      return output.slice();
    }
  }
}
