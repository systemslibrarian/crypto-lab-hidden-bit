/**
 * The reusable, typed proof ledger for E-K-04.
 *
 * The AES term is deliberately symbolic.  This module performs no experiment
 * that could turn a computational PRP assumption into a measured number.
 */

export const AES_PRP_TERM = 'Adv_AES^PRP(B_AES)' as const;
export const AES_BLOCK_BITS = 128 as const;
export const AES_SWITCHING_DENOMINATOR_POWER = 129 as const;

export const AES_HYBRID_IDS = ['H0', 'H1', 'H2', 'H3', 'H4', 'H5'] as const;
export type HybridId = (typeof AES_HYBRID_IDS)[number];
export type HybridStepKind = 'exact' | 'assumption' | 'bad-event';

export interface HybridNode {
  readonly id: HybridId;
  readonly title: string;
  readonly oracle: string;
}

export interface ZeroContribution {
  readonly type: 'zero';
  readonly expression: '0';
}

export interface AesPrpContribution {
  readonly type: 'symbolic-assumption';
  readonly symbol: typeof AES_PRP_TERM;
}

export interface SwitchingContribution {
  readonly type: 'bad-event-bound';
  readonly numerator: bigint;
  readonly denominatorPower: typeof AES_SWITCHING_DENOMINATOR_POWER;
  readonly expression: string;
}

export type HybridContribution = ZeroContribution | AesPrpContribution | SwitchingContribution;
export type NonzeroHybridContribution = AesPrpContribution | SwitchingContribution;

export interface HybridTransition {
  readonly from: HybridId;
  readonly to: HybridId;
  readonly kind: HybridStepKind;
  readonly title: string;
  readonly change: string;
  readonly justification: string;
  readonly contribution: HybridContribution;
}

export interface CumulativeHybridBound {
  readonly terms: readonly NonzeroHybridContribution[];
  readonly expression: string;
}

export interface AesHybridLedger {
  readonly queries: number;
  readonly through: HybridId;
  readonly nodes: readonly HybridNode[];
  readonly transitions: readonly HybridTransition[];
  readonly cumulative: CumulativeHybridBound;
}

const ZERO: ZeroContribution = Object.freeze({ type: 'zero', expression: '0' });
const PRP: AesPrpContribution = Object.freeze({
  type: 'symbolic-assumption',
  symbol: AES_PRP_TERM,
});

export const AES_HYBRID_NODES: readonly HybridNode[] = Object.freeze([
  Object.freeze({
    id: 'H0',
    title: 'Direct AES-128',
    oracle: 'Choose uniform K and answer each distinct 128-bit input with AES_K(input).',
  }),
  Object.freeze({
    id: 'H1',
    title: 'Factored AES oracle',
    oracle: 'Route the same AES_K computation through a memoizing byte-oracle interface.',
  }),
  Object.freeze({
    id: 'H2',
    title: 'Ideal permutation',
    oracle: 'Replace the AES family with a uniform permutation on 128-bit blocks.',
  }),
  Object.freeze({
    id: 'H3',
    title: 'Lazy ideal permutation',
    oracle: 'Sample a fresh unused output for each new input and cache repeated inputs.',
  }),
  Object.freeze({
    id: 'H4',
    title: 'Collision-coupled function',
    oracle: 'Allow with-replacement outputs and mark bad if two distinct inputs receive one output.',
  }),
  Object.freeze({
    id: 'H5',
    title: 'Inlined ideal function',
    oracle: 'Independently sample each new input output and cache it for repeated queries.',
  }),
]);

function assertQueryCount(queries: number): void {
  if (!Number.isSafeInteger(queries) || queries < 1) {
    throw new Error('q must be a positive safe integer counting distinct oracle inputs.');
  }
}

function switchingContribution(queries: number): SwitchingContribution {
  const q = BigInt(queries);
  const numerator = q * (q - 1n);
  return Object.freeze({
    type: 'bad-event-bound',
    numerator,
    denominatorPower: AES_SWITCHING_DENOMINATOR_POWER,
    expression: `${numerator} / 2^${AES_SWITCHING_DENOMINATOR_POWER}`,
  });
}

/** Return the only accepted adjacent H0-to-H5 path for q distinct inputs. */
export function createAesHybridTransitions(queries: number): readonly HybridTransition[] {
  assertQueryCount(queries);
  return Object.freeze([
    Object.freeze({
      from: 'H0',
      to: 'H1',
      kind: 'exact',
      title: 'Factor out the AES oracle',
      change: 'Replace direct AES calls with a memoizing wrapper around the same key and primitive.',
      justification: 'AES is deterministic and repeated inputs receive the same cached block.',
      contribution: ZERO,
    }),
    Object.freeze({
      from: 'H1',
      to: 'H2',
      kind: 'assumption',
      title: 'Replace AES by an ideal permutation',
      change: 'Swap the wrapped AES-128 family for a uniform 128-bit permutation.',
      justification: 'This is the computational AES-PRP assumption, not an empirical measurement.',
      contribution: PRP,
    }),
    Object.freeze({
      from: 'H2',
      to: 'H3',
      kind: 'exact',
      title: 'Lazy-sample the ideal permutation',
      change: 'Generate unused outputs on first query instead of choosing the full permutation eagerly.',
      justification: 'Lazy and eager sampling induce the same transcript distribution.',
      contribution: ZERO,
    }),
    Object.freeze({
      from: 'H3',
      to: 'H4',
      kind: 'bad-event',
      title: 'Permit a random-function collision',
      change: 'Stop rejecting an output already used by a different input.',
      justification: 'The coupled transcripts are identical until the random-function collision event.',
      contribution: switchingContribution(queries),
    }),
    Object.freeze({
      from: 'H4',
      to: 'H5',
      kind: 'exact',
      title: 'Erase unused coupling bookkeeping',
      change: 'Remove the internal bad flag and inline the same with-replacement sampler and cache.',
      justification: 'The bad flag was never returned to the adversary; outputs remain fresh only on distinct inputs and repeats stay fixed.',
      contribution: ZERO,
    }),
  ]);
}

function sameContribution(actual: HybridContribution, expected: HybridContribution): boolean {
  if (actual.type !== expected.type) return false;
  if (actual.type === 'zero' && expected.type === 'zero') return actual.expression === expected.expression;
  if (actual.type === 'symbolic-assumption' && expected.type === 'symbolic-assumption') {
    return actual.symbol === expected.symbol;
  }
  if (actual.type === 'bad-event-bound' && expected.type === 'bad-event-bound') {
    return actual.numerator === expected.numerator
      && actual.denominatorPower === expected.denominatorPower
      && actual.expression === expected.expression;
  }
  return false;
}

function sameTransition(actual: HybridTransition, expected: HybridTransition): boolean {
  return actual.from === expected.from
    && actual.to === expected.to
    && actual.kind === expected.kind
    && actual.title === expected.title
    && actual.change === expected.change
    && actual.justification === expected.justification
    && typeof actual.contribution === 'object'
    && actual.contribution !== null
    && sameContribution(actual.contribution, expected.contribution);
}

/**
 * Validate an H0-prefix and derive its bound.  Requiring the canonical prefix
 * prevents a UI from skipping an adjacent game or relabeling an assumption as
 * an exact rewrite.
 */
export function validateAesHybridSequence(
  queries: number,
  transitions: readonly HybridTransition[],
): CumulativeHybridBound {
  assertQueryCount(queries);
  if (!Array.isArray(transitions)) throw new Error('Hybrid transitions must be an array.');
  const expected = createAesHybridTransitions(queries);
  if (transitions.length > expected.length) throw new Error('The AES hybrid path ends at H5.');

  for (let index = 0; index < transitions.length; index += 1) {
    const actual = transitions[index];
    const canonical = expected[index]!;
    if (typeof actual !== 'object' || actual === null || !sameTransition(actual, canonical)) {
      throw new Error(`Hybrid step ${index + 1} must be the canonical adjacent ${canonical.from} -> ${canonical.to} transition.`);
    }
  }

  const terms = transitions
    .map((transition) => transition.contribution)
    .filter((term): term is NonzeroHybridContribution => term.type !== 'zero');
  const expression = terms.map((term) => (
    term.type === 'symbolic-assumption' ? term.symbol : term.expression
  )).join(' + ') || '0';
  return Object.freeze({ terms: Object.freeze([...terms]), expression });
}

export function createAesHybridLedger(queries: number, through: HybridId = 'H5'): AesHybridLedger {
  assertQueryCount(queries);
  const nodeIndex = AES_HYBRID_IDS.indexOf(through);
  if (nodeIndex < 0) throw new Error('Unknown AES hybrid endpoint.');
  const transitions = createAesHybridTransitions(queries).slice(0, nodeIndex);
  const cumulative = validateAesHybridSequence(queries, transitions);
  return Object.freeze({
    queries,
    through,
    nodes: Object.freeze(AES_HYBRID_NODES.slice(0, nodeIndex + 1)),
    transitions: Object.freeze(transitions),
    cumulative,
  });
}
