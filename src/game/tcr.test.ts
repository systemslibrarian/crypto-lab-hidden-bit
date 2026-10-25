import { describe, expect, it } from 'vitest';
import {
  winRateInterval,
  crApplyKey,
  crApplyPartner,
  crApplyX,
  crChooseX,
  crDrawKey,
  crSubmitPartner,
  crWon,
  exactAnalysis,
  familyFacts,
  familyHash,
  familyInner,
  freshCrState,
  freshTcrState,
  PLANTED_A,
  PLANTED_B,
  playCrGame,
  playTcrGame,
  sampleGames,
  tcrApplyKey,
  tcrApplyPartner,
  tcrApplyTarget,
  tcrCommitTarget,
  tcrDrawKey,
  tcrSubmitPartner,
  tcrWon,
  type TcrFamilyId,
  type TcrStrategyId,
} from './tcr';

/**
 * Every fixed number below was reproduced by a standalone script that
 * re-implemented the families from their definitions BEFORE this module was
 * written: the planted family has exactly one inner colliding pair, a
 * committed target survives on exactly 2 of 256 keys whatever the target, the
 * plant-shift collision game wins on all 256 keys, the fold family loses both
 * orders everywhere, and the second-preimage count is 512 of 65,536.
 */

const planted: TcrFamilyId = 'planted-pair';
const fold: TcrFamilyId = 'nibble-fold';
const strategies: readonly TcrStrategyId[] = ['plant-shift', 'scan-pairs', 'spray-multi'];

describe('the keyed families', () => {
  it('plants exactly one inner colliding pair at {0x0F, 0xF0}', () => {
    expect(familyFacts(planted).innerCollisionPairs).toEqual([[0x0f, 0xf0]]);
    expect(familyInner(planted)(0xf0)).toBe(0x0f);
    expect(familyInner(planted)(0x0f)).toBe(0x0f);
    expect(familyInner(planted)(0x00)).toBe(0x00);
  });

  it('folds the high nibble away, leaving fifteen partners everywhere', () => {
    expect(familyFacts(fold).innerCollisionPairs).toHaveLength(240);
    expect(familyInner(fold)(0x12)).toBe(0x02);
    expect(familyInner(fold)(0xf2)).toBe(0x02);
  });

  it('masks the input with the key: H_s(x) = h(x ⊕ s)', () => {
    expect(familyHash(planted, 0x00, 0xf0)).toBe(0x0f);
    expect(familyHash(planted, 0x0f, 0xff)).toBe(0x0f);
    expect(familyHash(fold, 0x33, 0x21)).toBe(0x02);
    expect(() => familyHash(planted, 256, 0)).toThrow();
    expect(() => familyHash(planted, 0, -1)).toThrow();
    expect(() => familyHash(planted, 1.5, 0)).toThrow();
  });
});

describe('the target-before-key machine', () => {
  it('accepts the target only first, and only one', () => {
    let state = freshTcrState(planted);
    expect(tcrCommitTarget(state, 300)).toMatchObject({ accepted: false });
    expect(tcrCommitTarget(state, 0x42)).toMatchObject({ accepted: true });
    state = tcrApplyTarget(state, 0x42);
    expect(tcrCommitTarget(state, 0x43)).toMatchObject({ accepted: false, reason: expect.stringContaining('exactly one target') });
  });

  it('refuses a further target after the key is drawn', () => {
    // A completed commit plus a drawn key: the single-target rule is what the
    // repeat offender meets, because one target already exists.
    const state = tcrApplyKey(tcrApplyTarget(freshTcrState(planted), 0x42), 0x11);
    const outcome = tcrCommitTarget(state, 0x43);
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toContain('exactly one target');
  });

  it('refuses a first target after the key is drawn', () => {
    // A position with a key but no target cannot arise from the legal move
    // sequence; the machine still names the order violation, not a crash.
    const state = tcrApplyKey(freshTcrState(planted), 0x11);
    const outcome = tcrCommitTarget(state, 0x43);
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toContain('before the key');
  });

  it('refuses the key and the partner out of order', () => {
    const fresh = freshTcrState(planted);
    expect(tcrDrawKey(fresh, 0x10)).toMatchObject({ accepted: false, reason: expect.stringContaining('after a target') });
    const committed = tcrApplyTarget(fresh, 0x42);
    const keyed = tcrApplyKey(committed, 0x10);
    expect(tcrSubmitPartner(committed, 0x43)).toMatchObject({
      accepted: false,
      reason: expect.stringContaining('after the key'),
    });
    expect(tcrDrawKey(keyed, 0x10)).toMatchObject({ accepted: false, reason: expect.stringContaining('only after') });
  });

  it('refuses a partner identical to the committed target', () => {
    const keyed = tcrApplyKey(tcrApplyTarget(freshTcrState(planted), 0x42), 0x10);
    const outcome = tcrSubmitPartner(keyed, 0x42);
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toContain('differ from the committed target');
  });

  it('resolves a win exactly when the partner hash equals the target hash', () => {
    // Target 0xF0 under key 0x00: the planted partner is 0x0F.
    const win = tcrApplyPartner(tcrApplyKey(tcrApplyTarget(freshTcrState(planted), 0xf0), 0x00), 0x0f);
    expect(tcrWon(win)).toBe(true);
    // Under key 0x10 no partner of 0xF0 exists; 0x01 hashes differently.
    const loss = tcrApplyPartner(tcrApplyKey(tcrApplyTarget(freshTcrState(planted), 0xf0), 0x10), 0x01);
    expect(tcrWon(loss)).toBe(false);
    expect(() => tcrWon(tcrApplyTarget(freshTcrState(planted), 0xf0))).toThrow();
  });
});

describe('the collision-after-key machine', () => {
  it('publishes the key first and refuses everything before it', () => {
    const fresh = freshCrState(planted);
    expect(crChooseX(fresh, 0x42)).toMatchObject({ accepted: false, reason: expect.stringContaining('after the key') });
    expect(crDrawKey(fresh, 0x24)).toMatchObject({ accepted: true });
    expect(crDrawKey(crApplyKey(fresh, 0x24), 0x25)).toMatchObject({
      accepted: false,
      reason: expect.stringContaining('exactly once'),
    });
  });

  it('refuses an identical partner', () => {
    const keyed = crApplyKey(freshCrState(planted), 0x10);
    const chosen = crApplyX(keyed, 0x42);
    expect(crSubmitPartner(chosen, 0x42)).toMatchObject({
      accepted: false,
      reason: expect.stringContaining('differ from x'),
    });
  });

  it('resolves a win exactly when the two hashes agree', () => {
    const state = crApplyPartner(crApplyX(crApplyKey(freshCrState(planted), 0x00), 0xf0), 0x0f);
    expect(crWon(state)).toBe(true);
    expect(() => crWon(crApplyKey(freshCrState(planted), 0x00))).toThrow();
  });
});

describe('the strategies under both orders', () => {
  it('plant-shift wins every collision-after-key game on the planted family', () => {
    for (let key = 0; key < 256; key += 1) {
      const record = playCrGame(planted, 'plant-shift', () => key);
      expect(record.won).toBe(true);
      expect(record.x).toBe((PLANTED_A ^ key) & 0xff);
      expect(record.partner).toBe((PLANTED_B ^ key) & 0xff);
      expect(record.partnerHash).toBe(record.xHash);
    }
  });

  it('the same strategy, target first, wins only on the two planted keys', () => {
    // Target 0xF0 survives exactly when 0xF0 ⊕ s ∈ {0x0F, 0xF0}: s ∈ {0x00, 0xFF}.
    const wins = new Set<number>();
    for (let key = 0; key < 256; key += 1) {
      const record = playTcrGame(planted, 'plant-shift', () => key);
      expect(record.target).toBe(PLANTED_A);
      expect(record.partner).not.toBe(PLANTED_A);
      const recomputed = record.partner === null
        ? false
        : familyHash(planted, key, record.partner) === familyHash(planted, key, record.target);
      expect(record.won).toBe(recomputed);
      if (record.won) wins.add(key);
    }
    expect(wins).toEqual(new Set([0x00, 0xff]));
  });

  it('the structure-blind scan separates the same way', () => {
    let tcrWins = 0;
    for (let key = 0; key < 256; key += 1) {
      const record = playTcrGame(planted, 'scan-pairs', () => key);
      if (record.won) tcrWins += 1;
      expect(record.transcript.every((entry) => entry.accepted || entry.value === null)).toBe(true);
    }
    expect(tcrWins).toBe(2);
    for (let key = 0; key < 256; key += 1) {
      expect(playCrGame(planted, 'scan-pairs', () => key).won).toBe(true);
    }
  });

  it('spray-multi is refused its second commit target-first and is fully legal key-first', () => {
    const tcr = playTcrGame(planted, 'spray-multi', () => 0x10);
    const commits = tcr.transcript.filter((entry) => entry.move === 'commit target');
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ value: PLANTED_A, accepted: true });
    expect(commits[1]).toMatchObject({ value: PLANTED_B, accepted: false, reason: expect.stringContaining('exactly one target') });
    expect(tcr.target).toBe(PLANTED_A);

    const cr = playCrGame(planted, 'spray-multi', () => 0x10);
    expect(cr.won).toBe(true);
    expect(cr.transcript.every((entry) => entry.accepted)).toBe(true);
  });

  it('loses no partner move on the planted family when no partner exists', () => {
    // Key 0x10 against committed 0xF0: no partner; the transcript records the
    // failed scan instead of inventing a submission.
    const record = playTcrGame(planted, 'plant-shift', () => 0x10);
    expect(record.partner).toBeNull();
    expect(record.won).toBe(false);
    const last = record.transcript.at(-1)!;
    expect(last.accepted).toBe(false);
    expect(last.reason).toContain('No partner exists');
  });

  it('the fold family falls target-first under every strategy', () => {
    for (const strategy of strategies) {
      for (let key = 0; key < 256; key += 1) {
        expect(playTcrGame(fold, strategy, () => key).won).toBe(true);
      }
    }
  });

  it('the fold family: the structure-blind scan wins key-first, the planted pair does not', () => {
    // {0xF0, 0x0F} is a collision of the planted inner function only. Under
    // the fold family the two inputs differ in their whole low nibble, so the
    // plant-shift and spray submissions lose every key-first game — an honest
    // family-specific-strategy result, measured and pinned.
    for (const strategy of ['plant-shift', 'spray-multi'] as const) {
      let wins = 0;
      for (let key = 0; key < 256; key += 1) {
        if (playCrGame(fold, strategy, () => key).won) wins += 1;
      }
      expect(wins).toBe(0);
    }
    for (let key = 0; key < 256; key += 1) {
      expect(playCrGame(fold, 'scan-pairs', () => key).won).toBe(true);
    }
  });
});

describe('exact analysis by exhaustion', () => {
  it('pins the planted family: TCR 2/256 for the worst target, CR 1, SPR 2/256', () => {
    for (const strategy of strategies) {
      const analysis = exactAnalysis(planted, strategy);
      expect(analysis.tcrWorstTargetWinChance).toBeCloseTo(2 / 256, 12);
      expect(analysis.crWinChance).toBe(1);
      expect(analysis.sprWinChance).toBeCloseTo(2 / 256, 12);
      expect(analysis.worstTargetKeys).toHaveLength(2);
    }
  });

  it('pins the fold family: TCR 1, SPR 1, and CR per strategy', () => {
    for (const strategy of strategies) {
      const analysis = exactAnalysis(fold, strategy);
      expect(analysis.tcrWorstTargetWinChance).toBe(1);
      expect(analysis.sprWinChance).toBe(1);
      expect(analysis.worstTargetKeys).toHaveLength(256);
      expect(analysis.crWinChance).toBe(strategy === 'scan-pairs' ? 1 : 0);
    }
  });
});

describe('the win-rate interval', () => {
  it('brackets the observed rate and pins the exact endpoints', () => {
    // Endpoints recomputed with the same 95% Wilson formula the rest of the
    // lab trusts, written out here rather than imported from the module.
    const interval = winRateInterval(4, 512);
    expect(interval.rate).toBeCloseTo(4 / 512, 12);
    expect(interval.low).toBeLessThan(interval.rate);
    expect(interval.high).toBeGreaterThan(interval.rate);
    expect(interval.low).toBeCloseTo(0.003042, 5);
    expect(interval.high).toBeCloseTo(0.019913, 5);
  });

  it('covers the whole range at the extremes', () => {
    expect(winRateInterval(0, 64).rate).toBe(0);
    expect(winRateInterval(0, 64).low).toBeLessThan(1e-12);
    expect(winRateInterval(0, 64).high).toBeCloseTo(0.056624, 5);
    expect(winRateInterval(64, 64).high).toBe(1);
    expect(winRateInterval(64, 64).low).toBeCloseTo(0.943376, 5);
  });

  it('rejects impossible counts', () => {
    expect(() => winRateInterval(-1, 10)).toThrow();
    expect(() => winRateInterval(11, 10)).toThrow();
    expect(() => winRateInterval(1.5, 10)).toThrow();
    expect(() => winRateInterval(1, 0)).toThrow();
  });
});

describe('bounded sampling', () => {
  it('counts wins and losses that add up, for both orders', () => {
    const tcr = sampleGames(planted, 'target-before-key', 'plant-shift', 64, () => 0x10);
    expect(tcr).toMatchObject({ wins: 0, losses: 64, trials: 64 });
    const tcrWin = sampleGames(planted, 'target-before-key', 'plant-shift', 64, () => 0x00);
    expect(tcrWin).toMatchObject({ wins: 64, losses: 0, trials: 64 });
    const cr = sampleGames(planted, 'collision-after-key', 'plant-shift', 32, () => 0x7f);
    expect(cr).toMatchObject({ wins: 32, losses: 0, trials: 32 });
  });

  it('rejects trial counts outside the teaching budget', () => {
    expect(() => sampleGames(planted, 'target-before-key', 'scan-pairs', 0, () => 0)).toThrow();
    expect(() => sampleGames(planted, 'target-before-key', 'scan-pairs', 16, () => 0)).toThrow();
    expect(() => sampleGames(planted, 'target-before-key', 'scan-pairs', 2049, () => 0)).toThrow();
    expect(() => sampleGames(planted, 'target-before-key', 'scan-pairs', 12.5, () => 0)).toThrow();
  });
});
