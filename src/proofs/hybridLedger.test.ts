import { describe, expect, it } from 'vitest';
import {
  AES_HYBRID_IDS,
  AES_PRP_TERM,
  createAesHybridLedger,
  createAesHybridTransitions,
  type HybridTransition,
  validateAesHybridSequence,
} from './hybridLedger';

describe('typed AES hybrid ledger', () => {
  it('builds the six-game adjacent path with the three honest classifications', () => {
    const ledger = createAesHybridLedger(20);
    expect(ledger.nodes.map(({ id }) => id)).toEqual(AES_HYBRID_IDS);
    expect(ledger.transitions.map(({ from, to }) => `${from}->${to}`)).toEqual([
      'H0->H1',
      'H1->H2',
      'H2->H3',
      'H3->H4',
      'H4->H5',
    ]);
    expect(ledger.transitions.map(({ kind }) => kind)).toEqual([
      'exact',
      'assumption',
      'exact',
      'bad-event',
      'exact',
    ]);
  });

  it('keeps AES-PRP symbolic and adds the exact q(q-1)/2^129 union bound', () => {
    const ledger = createAesHybridLedger(20);
    expect(ledger.cumulative.expression).toBe(`${AES_PRP_TERM} + 380 / 2^129`);
    expect(ledger.cumulative.terms).toEqual([
      { type: 'symbolic-assumption', symbol: AES_PRP_TERM },
      { type: 'bad-event-bound', numerator: 380n, denominatorPower: 129, expression: '380 / 2^129' },
    ]);
    expect(JSON.stringify(ledger.cumulative, (_key, value) => (
      typeof value === 'bigint' ? value.toString() : value
    ))).not.toContain('measured');
  });

  it('derives the cumulative expression at every prefix rather than jumping endpoints', () => {
    expect(createAesHybridLedger(8, 'H0').cumulative.expression).toBe('0');
    expect(createAesHybridLedger(8, 'H1').cumulative.expression).toBe('0');
    expect(createAesHybridLedger(8, 'H2').cumulative.expression).toBe(AES_PRP_TERM);
    expect(createAesHybridLedger(8, 'H3').cumulative.expression).toBe(AES_PRP_TERM);
    expect(createAesHybridLedger(8, 'H4').cumulative.expression).toBe(`${AES_PRP_TERM} + 56 / 2^129`);
    expect(createAesHybridLedger(8, 'H5').cumulative.expression).toBe(`${AES_PRP_TERM} + 56 / 2^129`);
  });

  it('retains an explicit zero bad-event term when q=1', () => {
    const bad = createAesHybridTransitions(1)[3]!.contribution;
    expect(bad).toEqual({
      type: 'bad-event-bound',
      numerator: 0n,
      denominatorPower: 129,
      expression: '0 / 2^129',
    });
  });

  it('rejects skipped, reordered, duplicated, and post-H5 steps', () => {
    const valid = createAesHybridTransitions(20);
    expect(() => validateAesHybridSequence(20, [valid[1]!])).toThrow('H0 -> H1');
    expect(() => validateAesHybridSequence(20, [valid[0]!, valid[2]!])).toThrow('H1 -> H2');
    expect(() => validateAesHybridSequence(20, [valid[0]!, valid[0]!])).toThrow('H1 -> H2');
    expect(() => validateAesHybridSequence(20, [...valid, valid[4]!])).toThrow('ends at H5');
  });

  it('rejects relabeling an assumption or bad event as an exact rewrite', () => {
    const valid = createAesHybridTransitions(20);
    const relabeledAssumption = { ...valid[1]!, kind: 'exact' } as HybridTransition;
    expect(() => validateAesHybridSequence(20, [valid[0]!, relabeledAssumption])).toThrow('H1 -> H2');

    const relabeledBad = { ...valid[3]!, kind: 'exact' } as HybridTransition;
    expect(() => validateAesHybridSequence(20, [...valid.slice(0, 3), relabeledBad])).toThrow('H3 -> H4');
  });

  it('rejects numericizing the PRP term, changing the factor two, or charging an exact hop', () => {
    const valid = createAesHybridTransitions(20);
    const numericPrp = { ...valid[1]!, contribution: 0.000_001 } as unknown as HybridTransition;
    expect(() => validateAesHybridSequence(20, [valid[0]!, numericPrp])).toThrow('H1 -> H2');

    const wrongDenominator = {
      ...valid[3]!,
      contribution: { ...valid[3]!.contribution, denominatorPower: 128, expression: '380 / 2^128' },
    } as unknown as HybridTransition;
    expect(() => validateAesHybridSequence(20, [...valid.slice(0, 3), wrongDenominator])).toThrow('H3 -> H4');

    const chargedExact = {
      ...valid[0]!,
      contribution: { type: 'bad-event-bound', numerator: 1n, denominatorPower: 129, expression: '1 / 2^129' },
    } as unknown as HybridTransition;
    expect(() => validateAesHybridSequence(20, [chargedExact])).toThrow('H0 -> H1');
  });

  it('binds the bad-event numerator to the declared distinct-query count', () => {
    const forTwenty = createAesHybridTransitions(20);
    expect(() => validateAesHybridSequence(21, forTwenty)).toThrow('H3 -> H4');
  });

  it('rejects invalid q values and unknown endpoints', () => {
    for (const q of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createAesHybridLedger(q)).toThrow('positive safe integer');
    }
    expect(() => createAesHybridLedger(2, 'H6' as never)).toThrow('Unknown');
    expect(() => validateAesHybridSequence(2, null as unknown as readonly HybridTransition[])).toThrow('array');
  });
});
