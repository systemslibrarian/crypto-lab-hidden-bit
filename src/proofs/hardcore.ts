/** A teaching bit vector stores one bit (0 or 1) per byte; it is not packed. */
export type Bit = 0 | 1;
export type BitVector = Uint8Array;

export interface ExposedFunctionOutput<Image> {
  readonly image: Image;
  readonly r: BitVector;
}

export function assertBitVector(vector: Uint8Array, expectedLength?: number, label = 'Bit vector'): void {
  if (!(vector instanceof Uint8Array)) throw new Error(`${label} must be a Uint8Array.`);
  if (expectedLength !== undefined && vector.length !== expectedLength) {
    throw new Error(`${label} must contain exactly ${expectedLength} bits.`);
  }
  for (const bit of vector) {
    if (bit !== 0 && bit !== 1) throw new Error(`${label} entries must each be 0 or 1.`);
  }
}

export function bitVectorKey(vector: Uint8Array): string {
  assertBitVector(vector);
  return Array.from(vector, String).join('');
}

/** Compute F(x,r)=(f(x),r), cloning both bit-vector inputs at the boundary. */
export function evaluateExposedFunction<Image>(
  f: (x: BitVector) => Image,
  x: BitVector,
  r: BitVector,
): ExposedFunctionOutput<Image> {
  if (typeof f !== 'function') throw new Error('f must be callable.');
  assertBitVector(x, undefined, 'x');
  assertBitVector(r, x.length, 'r');
  if (x.length === 0) throw new Error('x and r must contain at least one bit.');
  return Object.freeze({ image: f(x.slice()), r: r.slice() });
}

/** The deliberately easy predicate: the first bit of public r. */
export function exposedFirstBit<Image>(output: ExposedFunctionOutput<Image>): Bit {
  assertBitVector(output.r, undefined, 'Public r');
  if (output.r.length === 0) throw new Error('Public r has no first bit.');
  return output.r[0] as Bit;
}

/** Goldreich-Levin predicate <x,r> = sum_i x_i r_i mod 2. */
export function innerProductMod2(x: BitVector, r: BitVector): Bit {
  assertBitVector(x, undefined, 'x');
  assertBitVector(r, x.length, 'r');
  if (x.length === 0) throw new Error('x and r must contain at least one bit.');
  let parity: Bit = 0;
  for (let index = 0; index < x.length; index += 1) {
    parity = (parity ^ (x[index]! & r[index]!)) as Bit;
  }
  return parity;
}
