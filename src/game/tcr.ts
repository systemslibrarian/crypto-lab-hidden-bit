/**
 * S09 — Target collision resistance as an order-of-play game.
 *
 * A target-collision (universal one-way hash) family is keyed: H_s(x) =
 * h(x ⊕ s). The lesson's two families are small on purpose so every claim on
 * the page can be verified by exhaustive computation:
 *
 *   planted-pair — h is the identity on {0,1}^8 except h(0xF0) = 0x0F, so the
 *     family has exactly one colliding inner pair {0x0F, 0xF0}, at a KNOWN
 *     location. Collision resistance is broken outright: an adversary that
 *     sees the key first shifts the planted pair past the input mask. Target
 *     collision resistance survives: a target committed before the key lands
 *     on the planted pair for exactly 2 of the 256 keys, whatever the target.
 *
 *   nibble-fold — h(u) = u & 0x0F. Every input has fifteen partners, so both
 *     orders fall. Input masking does not rescue an over-compressing inner
 *     function; this family is the exhibit's negative control.
 *
 * The two challenge orders (Naor–Yung STOC '89):
 *
 *   target-before-key  — the adversary commits x, THEN the key is drawn, then
 *     it produces x′. It wins when x′ ≠ x and H_s(x′) = H_s(x).
 *   collision-after-key — the key is published FIRST, then the adversary
 *     picks both x and x′. It wins under the same pair condition.
 *
 * The machines below enforce each order as a state machine: every move is
 * accepted or refused with a reason, and the refusals are part of the
 * teaching, not an error path. A second preimage (SPR) is defined for
 * contrast: the key and the challenge x are both handed to the adversary; it
 * only supplies x′.
 *
 * NOT A REAL HASH. An 8-bit domain is exhaustible by design; the exact counts
 * on this page are properties of these toy families, never statements about
 * SHA-256, and UOWHF security is an asymptotic property of families against
 * polynomial-time adversaries that no browser run establishes.
 */

export type TcrFamilyId = 'planted-pair' | 'nibble-fold';
export type TcrStrategyId = 'plant-shift' | 'scan-pairs' | 'spray-multi';
export type TcrOrder = 'target-before-key' | 'collision-after-key';

export const TCR_DOMAIN = 256;

/** The inner (unkeyed) function h of each family. */
export function familyInner(id: TcrFamilyId): (u: number) => number {
  switch (id) {
    case 'planted-pair':
      return (u) => (u === 0xf0 ? 0x0f : u & 0xff);
    case 'nibble-fold':
      return (u) => u & 0x0f;
  }
}

/** The keyed family member: H_s(x) = h(x ⊕ s), all values 8-bit. */
export function familyHash(id: TcrFamilyId, key: number, x: number): number {
  if (!isByte(key) || !isByte(x)) {
    throw new Error('Family inputs are 8-bit: 0 through 255.');
  }
  return familyInner(id)((x ^ key) & 0xff);
}

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

export interface FamilyFacts {
  readonly id: TcrFamilyId;
  readonly label: string;
  readonly description: string;
  /** Inner colliding pairs of h, exhaustive. */
  readonly innerCollisionPairs: readonly [number, number][];
}

export function familyFacts(id: TcrFamilyId): FamilyFacts {
  const h = familyInner(id);
  const seen = new Map<number, number>();
  const pairs: [number, number][] = [];
  for (let u = 0; u < 256; u += 1) {
    const y = h(u);
    if (seen.has(y)) pairs.push([seen.get(y)!, u]);
    else seen.set(y, u);
  }
  return {
    id,
    label: id === 'planted-pair' ? 'Planted pair (one collision)' : 'Nibble fold (fifteen partners everywhere)',
    description:
      id === 'planted-pair'
        ? 'h(u) = u except h(0xF0) = 0x0F: exactly one colliding inner pair {0x0F, 0xF0}, at a published location.'
        : 'h(u) = u & 0x0F: the high nibble is discarded, so every input has exactly fifteen collision partners.',
    innerCollisionPairs: pairs,
  };
}

/* ── The target-before-key machine ──────────────────────────────────── */

export type TcrPhase = 'awaiting-target' | 'awaiting-key' | 'awaiting-partner' | 'resolved';

export interface TcrState {
  readonly phase: TcrPhase;
  readonly family: TcrFamilyId;
  readonly target: number | null;
  readonly key: number | null;
  readonly partner: number | null;
}

export interface MoveOutcome {
  readonly accepted: boolean;
  readonly reason: string;
}

export function freshTcrState(family: TcrFamilyId): TcrState {
  return { phase: 'awaiting-target', family, target: null, key: null, partner: null };
}

/** Order of play: the target must precede the key, and there is only one. */
export function tcrCommitTarget(state: TcrState, x: number): MoveOutcome {
  if (!isByte(x)) return { accepted: false, reason: 'Refused: inputs are 8-bit (0–255).' };
  if (state.target !== null) {
    return { accepted: false, reason: 'Refused: the target-before-key game commits exactly one target.' };
  }
  if (state.phase !== 'awaiting-target') {
    return { accepted: false, reason: 'Refused: the target must be committed before the key is drawn.' };
  }
  return { accepted: true, reason: `Target 0x${x.toString(16).padStart(2, '0')} committed before any key exists.` };
}

export function tcrApplyTarget(state: TcrState, x: number): TcrState {
  return { ...state, target: x, phase: 'awaiting-key' };
}

export function tcrDrawKey(state: TcrState, key: number): MoveOutcome {
  if (!isByte(key)) return { accepted: false, reason: 'Refused: keys are 8-bit (0–255).' };
  if (state.phase !== 'awaiting-key') {
    return { accepted: false, reason: 'Refused: draw the key only after a target is committed.' };
  }
  return { accepted: true, reason: `Key 0x${key.toString(16).padStart(2, '0')} drawn uniformly after the commit.` };
}

export function tcrApplyKey(state: TcrState, key: number): TcrState {
  return { ...state, key, phase: 'awaiting-partner' };
}

export function tcrSubmitPartner(state: TcrState, x2: number): MoveOutcome {
  if (!isByte(x2)) return { accepted: false, reason: 'Refused: inputs are 8-bit (0–255).' };
  if (state.phase !== 'awaiting-partner') {
    return { accepted: false, reason: 'Refused: the partner is submitted after the key is drawn.' };
  }
  if (x2 === state.target) {
    return { accepted: false, reason: 'Refused: the partner must differ from the committed target.' };
  }
  return { accepted: true, reason: `Partner 0x${x2.toString(16).padStart(2, '0')} submitted under the drawn key.` };
}

export function tcrApplyPartner(state: TcrState, x2: number): TcrState {
  return { ...state, partner: x2, phase: 'resolved' };
}

export function tcrWon(state: TcrState): boolean {
  if (state.phase !== 'resolved' || state.target === null || state.key === null) {
    throw new Error('The target-before-key game resolves only after target and key.');
  }
  // An adversary that produced no partner loses: the definition's win
  // condition requires an x-prime that differs from the target.
  if (state.partner === null) return false;
  return familyHash(state.family, state.key, state.partner) === familyHash(state.family, state.key, state.target);
}

/* ── The collision-after-key machine ────────────────────────────────── */

export type CrPhase = 'awaiting-key' | 'awaiting-x' | 'awaiting-partner' | 'resolved';

export interface CrState {
  readonly phase: CrPhase;
  readonly family: TcrFamilyId;
  readonly key: number | null;
  readonly x: number | null;
  readonly partner: number | null;
}

export interface CrMoveOutcome {
  readonly accepted: boolean;
  readonly reason: string;
}

export function freshCrState(family: TcrFamilyId): CrState {
  return { phase: 'awaiting-key', family, key: null, x: null, partner: null };
}

/** Order of play: the key is published first; both inputs come after. */
export function crDrawKey(state: CrState, key: number): CrMoveOutcome {
  if (!isByte(key)) return { accepted: false, reason: 'Refused: keys are 8-bit (0–255).' };
  if (state.phase !== 'awaiting-key') {
    return { accepted: false, reason: 'Refused: the key is drawn exactly once, first.' };
  }
  return { accepted: true, reason: `Key 0x${key.toString(16).padStart(2, '0')} published before any input.` };
}

export function crApplyKey(state: CrState, key: number): CrState {
  return { ...state, key, phase: 'awaiting-x' };
}

export function crChooseX(state: CrState, x: number): CrMoveOutcome {
  if (!isByte(x)) return { accepted: false, reason: 'Refused: inputs are 8-bit (0–255).' };
  if (state.phase !== 'awaiting-x') {
    return { accepted: false, reason: 'Refused: choose x only after the key is published.' };
  }
  return { accepted: true, reason: `x = 0x${x.toString(16).padStart(2, '0')} chosen with the key in hand.` };
}

export function crApplyX(state: CrState, x: number): CrState {
  return { ...state, x, phase: 'awaiting-partner' };
}

export function crSubmitPartner(state: CrState, x2: number): CrMoveOutcome {
  if (!isByte(x2)) return { accepted: false, reason: 'Refused: inputs are 8-bit (0–255).' };
  if (state.phase !== 'awaiting-partner') {
    return { accepted: false, reason: 'Refused: the partner is submitted after x is chosen.' };
  }
  if (x2 === state.x) {
    return { accepted: false, reason: 'Refused: the partner must differ from x.' };
  }
  return { accepted: true, reason: `Partner 0x${x2.toString(16).padStart(2, '0')} submitted.` };
}

export function crApplyPartner(state: CrState, x2: number): CrState {
  return { ...state, partner: x2, phase: 'resolved' };
}

export function crWon(state: CrState): boolean {
  if (state.phase !== 'resolved' || state.key === null || state.x === null || state.partner === null) {
    throw new Error('The collision-after-key game resolves only after key, x and partner.');
  }
  return familyHash(state.family, state.key, state.partner) === familyHash(state.family, state.key, state.x);
}

/* ── Strategies, as scripted move sequences the machines adjudicate ───── */

export interface TranscriptEntry {
  readonly move: string;
  readonly value: number | null;
  readonly accepted: boolean;
  readonly reason: string;
}

export interface TcrGameRecord {
  readonly family: TcrFamilyId;
  readonly strategy: TcrStrategyId;
  readonly transcript: readonly TranscriptEntry[];
  readonly target: number;
  readonly key: number;
  readonly partner: number | null;
  readonly targetHash: number;
  readonly partnerHash: number | null;
  readonly won: boolean;
}

export interface CrGameRecord {
  readonly family: TcrFamilyId;
  readonly strategy: TcrStrategyId;
  readonly transcript: readonly TranscriptEntry[];
  readonly key: number;
  readonly x: number;
  readonly partner: number | null;
  readonly xHash: number;
  readonly partnerHash: number | null;
  readonly won: boolean;
}

/** The planted pair of the planted-pair inner function, as published constants. */
export const PLANTED_A = 0xf0;
export const PLANTED_B = 0x0f;

/** The strategy-level partner search: first x-prime hashing equal under this key. */
function firstPartner(family: TcrFamilyId, key: number, x: number): number | null {
  const targetHash = familyHash(family, key, x);
  for (let x2 = 0; x2 < 256; x2 += 1) {
    if (x2 !== x && familyHash(family, key, x2) === targetHash) return x2;
  }
  return null;
}

/**
 * playTcrGame runs one complete target-before-key game. The strategies script
 * moves at the machine; every refusal stays in the transcript. The committed
 * target precedes the key draw in every case, including spray-multi, whose
 * second commit the machine refuses.
 */
export function playTcrGame(
  family: TcrFamilyId,
  strategy: TcrStrategyId,
  randomByte: () => number,
): TcrGameRecord {
  // The strategy holds its own mutable copy of the position and feeds every
  // intended move through the machine for adjudication; the machine's
  // accept/refuse decision — never the strategy's expectation — decides what
  // the position becomes.
  let state = freshTcrState(family);
  const transcript: TranscriptEntry[] = [];
  const commit = (x: number): void => {
    const outcome = tcrCommitTarget(state, x);
    transcript.push({ move: 'commit target', value: x, accepted: outcome.accepted, reason: outcome.reason });
    if (outcome.accepted) state = tcrApplyTarget(state, x);
  };
  const drawKey = (): void => {
    const key = randomByte() & 0xff;
    const outcome = tcrDrawKey(state, key);
    transcript.push({ move: 'draw key', value: key, accepted: outcome.accepted, reason: outcome.reason });
    if (outcome.accepted) state = tcrApplyKey(state, key);
  };
  const submit = (x2: number | null): void => {
    if (x2 === null) {
      transcript.push({
        move: 'submit partner',
        value: null,
        accepted: false,
        reason: 'No partner exists under this key: the scan of all 255 other inputs found no equal hash.',
      });
      state = { ...state, partner: null, phase: 'resolved' };
      return;
    }
    const outcome = tcrSubmitPartner(state, x2);
    transcript.push({ move: 'submit partner', value: x2, accepted: outcome.accepted, reason: outcome.reason });
    if (outcome.accepted) state = tcrApplyPartner(state, x2);
  };

  switch (strategy) {
    case 'plant-shift':
      commit(PLANTED_A);
      drawKey();
      submit(state.key === null ? null : firstPartner(family, state.key, state.target ?? 0));
      break;
    case 'scan-pairs':
      commit(0x00);
      drawKey();
      submit(state.key === null ? null : firstPartner(family, state.key, state.target ?? 0));
      break;
    case 'spray-multi':
      // The collision-game native plan: commit several targets up front and
      // hope the key lands one of them on a collision. The machine commits
      // exactly one target; the second commit is refused and stays on tape.
      commit(PLANTED_A);
      commit(PLANTED_B);
      drawKey();
      submit(state.key === null ? null : firstPartner(family, state.key, state.target ?? 0));
      break;
  }

  if (state.phase !== 'resolved' || state.target === null || state.key === null) {
    throw new Error('The target-before-key game did not resolve; check the machine transitions.');
  }
  const targetHash = familyHash(family, state.key, state.target);
  const partnerHash = state.partner === null ? null : familyHash(family, state.key, state.partner);
  return {
    family,
    strategy,
    transcript,
    target: state.target,
    key: state.key,
    partner: state.partner,
    targetHash,
    partnerHash,
    won: state.partner !== null && partnerHash === targetHash,
  };
}

/** playCrGame runs one complete collision-after-key game under the same family. */
export function playCrGame(
  family: TcrFamilyId,
  strategy: TcrStrategyId,
  randomByte: () => number,
): CrGameRecord {
  let state = freshCrState(family);
  const transcript: TranscriptEntry[] = [];
  const drawKey = (): void => {
    const key = randomByte() & 0xff;
    const outcome = crDrawKey(state, key);
    transcript.push({ move: 'publish key', value: key, accepted: outcome.accepted, reason: outcome.reason });
    if (outcome.accepted) state = crApplyKey(state, key);
  };
  const choose = (x: number): void => {
    const outcome = crChooseX(state, x);
    transcript.push({ move: 'choose x', value: x, accepted: outcome.accepted, reason: outcome.reason });
    if (outcome.accepted) state = crApplyX(state, x);
  };
  const submit = (x2: number): void => {
    const outcome = crSubmitPartner(state, x2);
    transcript.push({ move: 'submit partner', value: x2, accepted: outcome.accepted, reason: outcome.reason });
    if (outcome.accepted) state = crApplyPartner(state, x2);
  };

  drawKey();
  const key = state.key!;
  switch (strategy) {
    case 'plant-shift':
      // The key is public: shift the planted inner pair past the input mask.
      choose((PLANTED_A ^ key) & 0xff);
      submit((PLANTED_B ^ key) & 0xff);
      break;
    case 'scan-pairs': {
      // Structure-blind: evaluate until two inputs collide under this key.
      const seen = new Map<number, number>();
      let first: number | null = null;
      let second: number | null = null;
      for (let x = 0; x < 256 && second === null; x += 1) {
        const y = familyHash(family, key, x);
        if (seen.has(y)) {
          first = seen.get(y)!;
          second = x;
        } else seen.set(y, x);
      }
      if (first === null || second === null) {
        transcript.push({
          move: 'choose x',
          value: null,
          accepted: false,
          reason: 'No collision found among the 256 inputs under this key.',
        });
        choose(0x00);
        submit(0x01);
      } else {
        choose(first);
        submit(second);
      }
      break;
    }
    case 'spray-multi':
      // Fully legal here: nothing is committed before the key, so gathering
      // several candidate inputs and matching them is an ordinary CR move.
      choose((PLANTED_A ^ key) & 0xff);
      submit((PLANTED_B ^ key) & 0xff);
      break;
  }

  if (state.phase !== 'resolved' || state.x === null || state.partner === null) {
    throw new Error('The collision-after-key game did not resolve; check the machine transitions.');
  }
  const xHash = familyHash(family, key, state.x);
  const partnerHash = familyHash(family, key, state.partner);
  return {
    family,
    strategy,
    transcript,
    key,
    x: state.x,
    partner: state.partner,
    xHash,
    partnerHash,
    won: partnerHash === xHash,
  };
}

/* ── Exact analysis, by exhaustion over the whole key space ─────────── */

export interface ExactAnalysis {
  /** Target-before-key win chance for the worst committed target (exact). */
  readonly tcrWorstTargetWinChance: number;
  /** Collision-after-key win chance for the strategy (exact, over keys). */
  readonly crWinChance: number;
  /** Second-preimage win chance over uniform key and challenge (exact). */
  readonly sprWinChance: number;
  /**
   * Inner points with a collision partner. By the mask symmetry these are in
   * one-to-one correspondence with the keys beating any committed target
   * (s = x ⊕ u), so the count is rendered as "keys beating the worst target".
   */
  readonly worstTargetKeys: readonly number[];
}

/**
 * The input mask makes the target-before-key and second-preimage chances one
 * pass each — by symmetry, not by sampling:
 *
 *   A committed target x is beaten by key s exactly when u = x ⊕ s has a
 *   collision partner under the inner h. As s runs over all 256 keys, u runs
 *   over all 256 inner points, so EVERY target is beaten by the same number of
 *   keys: the number of inner points that belong to some colliding pair of h.
 *
 *   The second-preimage game hands the adversary (s, x) with the key in hand;
 *   u = x ⊕ s is uniform there too, so its winnable count is the same number.
 *   The two games coincide on every family of the form h(x ⊕ s); they remain
 *   different definitions, because the order of play differs and TCR lets the
 *   adversary choose the target.
 */
export function exactAnalysis(family: TcrFamilyId, strategy: TcrStrategyId): ExactAnalysis {
  // Inner points with a collision partner — the mask-symmetric winnable set.
  const worstKeys: number[] = [];
  for (let u = 0; u < 256; u += 1) {
    const h = familyInner(family);
    const digest = h(u);
    for (let other = 0; other < 256; other += 1) {
      if (other !== u && h(other) === digest) {
        worstKeys.push(u);
        break;
      }
    }
  }
  const tcrChance = worstKeys.length / 256;

  // Collision-after-key: run the strategy's actual choice rule per key.
  let crWins = 0;
  for (let s = 0; s < 256; s += 1) {
    const record = playCrGame(family, strategy, () => s);
    if (record.won) crWins += 1;
  }
  const crChance = crWins / 256;

  return {
    tcrWorstTargetWinChance: tcrChance,
    crWinChance: crChance,
    sprWinChance: tcrChance,
    worstTargetKeys: worstKeys,
  };
}

/* ── Bounded sampling with the same strategies ──────────────────────── */

export interface SampleResult {
  readonly wins: number;
  readonly losses: number;
  readonly trials: number;
}

export function sampleGames(
  family: TcrFamilyId,
  order: TcrOrder,
  strategy: TcrStrategyId,
  trials: number,
  randomByte: () => number,
): SampleResult {
  if (!Number.isInteger(trials) || trials < 32 || trials > 2_048) {
    throw new Error('Trials must be an integer from 32 through 2,048.');
  }
  let wins = 0;
  for (let index = 0; index < trials; index += 1) {
    const won =
      order === 'target-before-key'
        ? playTcrGame(family, strategy, randomByte).won
        : playCrGame(family, strategy, randomByte).won;
    if (won) wins += 1;
  }
  return { wins, losses: trials - wins, trials };
}

/* ── The win-rate Wilson interval (p form, not the ±1 advantage form) ─── */

export interface WinRateInterval {
  /** The observed win rate wins / trials. */
  readonly rate: number;
  readonly low: number;
  readonly high: number;
}

/**
 * A 95% Wilson interval for a win RATE. The guessing games elsewhere in this
 * lab report the ±1 advantage 2p − 1; a collision-style game has no guessing
 * coin, its natural statistic is the win probability itself, and conflating
 * the two would halve the number for no reason. The z is the same 95% point
 * the rest of the lab uses.
 */
export function winRateInterval(wins: number, trials: number): WinRateInterval {
  if (!Number.isInteger(wins) || !Number.isInteger(trials) || wins < 0 || trials <= 0 || wins > trials) {
    throw new Error('The win-rate interval requires integer counts with 0 <= wins <= trials.');
  }
  const z = 1.959963984540054;
  const probability = wins / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (probability + (z * z) / (2 * trials)) / denominator;
  const radius =
    (z / denominator) *
    Math.sqrt((probability * (1 - probability)) / trials + (z * z) / (4 * trials * trials));
  return {
    rate: probability,
    low: Math.max(0, center - radius),
    high: Math.min(1, center + radius),
  };
}
