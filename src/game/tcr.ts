/**
 * S09 — Target collision resistance as an order-of-play game.
 *
 * This bounded target-collision lesson uses keyed toys H_s(x) = h(x ⊕ s).
 * The two families are small on purpose so every claim on the page can be
 * verified by exhaustive computation:
 *
 *   planted-pair — h is the identity on {0,1}^8 except h(0xF0) = 0x0F, so the
 *     family has exactly one colliding inner pair {0x0F, 0xF0}, at a KNOWN
 *     location. Collision resistance is broken outright: an adversary that
 *     sees the key first shifts the planted pair past the input mask. In the
 *     target-first game, every fixed target lands on the planted pair
 *     for exactly 2 of the 256 keys. That is a complete fact about this fixed
 *     toy, not a target-collision-resistance conclusion.
 *
 *   nibble-fold — h(u) = u & 0x0F. Every input has fifteen partners, so an
 *     exhaustive scan wins in both orders. The direct planted-pair strategy
 *     still loses because its published pair is not a fold collision; this
 *     family is the exhibit's strategy-control case.
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
 * contrast: the key and an independently uniform challenge x are both handed
 * to the adversary; it only supplies x′.
 *
 * NOT A REAL HASH OR UOWHF CONSTRUCTION. This fixed, length-preserving 8-bit
 * model illustrates challenge order only. The exact counts are properties of
 * these toys, never statements about SHA-256, and UOWHF security is an
 * asymptotic property of families against polynomial-time adversaries that no
 * browser run establishes.
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
  /** One first-seen representative for each later colliding inner input. */
  readonly representativeInnerCollisions: readonly [number, number][];
  /** Every unordered pair {u, u'} with u < u' and h(u) = h(u'). */
  readonly unorderedInnerCollisionCount: number;
}

export function familyFacts(id: TcrFamilyId): FamilyFacts {
  const h = familyInner(id);
  const seen = new Map<number, number>();
  const representatives: [number, number][] = [];
  const bucketSizes = new Map<number, number>();
  for (let u = 0; u < 256; u += 1) {
    const y = h(u);
    bucketSizes.set(y, (bucketSizes.get(y) ?? 0) + 1);
    if (seen.has(y)) representatives.push([seen.get(y)!, u]);
    else seen.set(y, u);
  }
  let unorderedInnerCollisionCount = 0;
  for (const size of bucketSizes.values()) {
    unorderedInnerCollisionCount += (size * (size - 1)) / 2;
  }
  return {
    id,
    label: id === 'planted-pair' ? 'Planted pair (one collision)' : 'Nibble fold (fifteen partners everywhere)',
    description:
      id === 'planted-pair'
        ? 'h(u) = u except h(0xF0) = 0x0F: exactly one colliding inner pair {0x0F, 0xF0}, at a published location.'
        : 'h(u) = u & 0x0F: the high nibble is discarded, so every input has exactly fifteen collision partners.',
    representativeInnerCollisions: representatives,
    unorderedInnerCollisionCount,
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
  return { accepted: true, reason: `Key 0x${key.toString(16).padStart(2, '0')} revealed after the commit.` };
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

/**
 * Ending without a partner is an explicit, legal loss after the key draw. It
 * is not a rejected partner submission: no x-prime was supplied for the
 * machine to validate.
 */
export function tcrForfeit(state: TcrState): MoveOutcome {
  if (state.phase !== 'awaiting-partner') {
    return { accepted: false, reason: 'Refused: a no-answer forfeit is available only when a partner is due.' };
  }
  return {
    accepted: true,
    reason: 'Accepted: the adversary forfeited without a partner, so this trial terminates as a loss.',
  };
}

export function tcrApplyForfeit(state: TcrState): TcrState {
  return { ...state, partner: null, phase: 'resolved' };
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
 * The planted-pair strategy uses only its published pair. It does not silently
 * turn into the exhaustive scan strategy after the key is drawn.
 */
function plantedPartnerForTarget(key: number, target: number): number | null {
  const innerTarget = (target ^ key) & 0xff;
  if (innerTarget === PLANTED_A) return (PLANTED_B ^ key) & 0xff;
  if (innerTarget === PLANTED_B) return (PLANTED_A ^ key) & 0xff;
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
      const outcome = tcrForfeit(state);
      transcript.push({
        move: 'forfeit (no partner)',
        value: null,
        accepted: outcome.accepted,
        reason: outcome.reason,
      });
      if (outcome.accepted) state = tcrApplyForfeit(state);
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
      submit(state.key === null ? null : plantedPartnerForTarget(state.key, state.target ?? 0));
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
      // Continue with the surviving member of the same planted candidate set;
      // unlike scan-pairs, spray never enumerates the domain for a replacement.
      submit(state.key === null ? null : plantedPartnerForTarget(state.key, state.target ?? 0));
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
    won: tcrWon(state),
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

/* ── Exact analysis, by key enumeration and mask symmetry ──────────── */

export interface ExactAnalysis {
  /** Target-before-key win chance for the selected strategy (exact over keys). */
  readonly selectedTcrWinChance: number;
  /** Collision-after-key win chance for the selected strategy (exact over keys). */
  readonly selectedCrWinChance: number;
  /** Fraction of keys for which any partner exists for any fixed target. */
  readonly familyTargetWinnableChance: number;
  /** Winnability over a uniform key and independently uniform challenge x. */
  readonly uniformChallengeSecWinnableChance: number;
  /**
   * Inner points with a collision partner. By mask symmetry, their count is
   * the number of keys under which any fixed target has some partner.
   */
  readonly winnableInnerPoints: readonly number[];
}

/**
 * The input mask makes the family-level target and uniform-challenge
 * second-preimage winnability rates computable in one pass — by symmetry, not
 * by sampling:
 *
 *   A committed target x is beaten by key s exactly when u = x ⊕ s has a
 *   collision partner under the inner h. As s runs over all 256 keys, u runs
 *   over all 256 inner points, so EVERY target is beaten by the same number of
 *   keys: the number of inner points that belong to some colliding pair of h.
 *
 *   The second-preimage game hands the adversary (s, x) with the key in hand;
 *   u = x ⊕ s is uniform there too, so its winnable count is the same number.
 *   These two existence rates coincide for this masked family; the security
 *   games remain different definitions, and their adversaries need not use the
 *   same strategy.
 */
export function exactAnalysis(family: TcrFamilyId, strategy: TcrStrategyId): ExactAnalysis {
  // Inner points with a collision partner — the mask-symmetric winnable set.
  const winnableInnerPoints: number[] = [];
  for (let u = 0; u < 256; u += 1) {
    const h = familyInner(family);
    const digest = h(u);
    for (let other = 0; other < 256; other += 1) {
      if (other !== u && h(other) === digest) {
        winnableInnerPoints.push(u);
        break;
      }
    }
  }
  const familyTargetWinnableChance = winnableInnerPoints.length / 256;

  // Target-before-key: run the selected strategy's actual rule per key. This
  // is intentionally separate from the family-level existence of a partner.
  let selectedTcrWins = 0;
  for (let s = 0; s < 256; s += 1) {
    if (playTcrGame(family, strategy, () => s).won) selectedTcrWins += 1;
  }

  // Collision-after-key: run the strategy's actual choice rule per key.
  let selectedCrWins = 0;
  for (let s = 0; s < 256; s += 1) {
    const record = playCrGame(family, strategy, () => s);
    if (record.won) selectedCrWins += 1;
  }

  return {
    selectedTcrWinChance: selectedTcrWins / 256,
    selectedCrWinChance: selectedCrWins / 256,
    familyTargetWinnableChance,
    uniformChallengeSecWinnableChance: familyTargetWinnableChance,
    winnableInnerPoints,
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
