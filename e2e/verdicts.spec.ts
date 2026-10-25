import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { REGISTRY, family, requiredHelper } from './mutation-registry';
import { SWITCHING_BITS, SWITCHING_QUERIES, SWITCHING_TRIALS } from './switching-params';
import {
  claimField,
  expectNoVerdict,
  expectVerdict,
  formatUnmarked,
  readClaim,
  renderedMarkers,
  unmarkedVerdicts,
  type Claim,
} from './verdict-audit';

const COVERED = {
  verdict: Array.from(
    new Set(REGISTRY.mutations.filter((entry) => family(entry) === 'verdict').map((entry) => entry.marker)),
  ).sort(),
  claim: Array.from(
    new Set(REGISTRY.mutations.filter((entry) => family(entry) === 'claim').map((entry) => entry.marker)),
  ).sort(),
};

/**
 * Markers reachable only on a failure path — the engine-failure verdict is not
 * rendered by any healthy page, so the walk below cannot observe it. The
 * exemption is earned, not asserted: such a marker must be ABSENT from every
 * healthy state, which is what stops the flag being used to hide a verdict that
 * really is rendered and really is unaudited.
 */
const FAILURE_ONLY = REGISTRY.mutations
  .filter((entry) => entry.rendersOnlyUnderMutation)
  .map((entry) => entry.marker);

/**
 * Wilson interval stand-in. Deliberately NOT imported from
 * src/game/advantage.ts: an oracle that calls the code under test agrees with
 * it by construction and proves nothing. This is the same arithmetic written
 * out again, so a change to the implementation has to be matched here on
 * purpose.
 */
function wilson(wins: number, trials: number): { estimate: number; low: number; high: number } {
  const z = 1.959963984540054;
  const probability = wins / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (probability + (z * z) / (2 * trials)) / denominator;
  const radius =
    (z / denominator) *
    Math.sqrt((probability * (1 - probability)) / trials + (z * z) / (4 * trials * trials));
  return {
    estimate: 2 * probability - 1,
    low: Math.max(-1, 2 * (center - radius) - 1),
    high: Math.min(1, 2 * (center + radius) - 1),
  };
}

/** The page's own display format, written out rather than imported, as above. */
function formatted(value: number, digits = 3): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** The switching bound, q(q - 1) / 2^(n + 1), derived from the CHOSEN n. */
function switchingBound(bits: number, queries: number): number {
  return (queries * (queries - 1)) / (2 * 2 ** bits);
}

/**
 * What a row at THIS q should measure, predicted independently of the row.
 *
 * Fix 4. The oracle below used to check each row's INTERNAL consistency only —
 * measured advantage against the Wilson estimate of that row's own wins and
 * trials — which a row satisfies by construction because it is the same row.
 * The 2026-09-21 audit replicated the first q point into every later row, with
 * only `queries` and `bound` corrected, and the suite stayed green at 35/35
 * while the page rendered four identical rows under "4 q values, 200 trials
 * each". Nothing bound a row to its own run, which is what "trials each"
 * claims and what the exhibit teaches: advantage rising with q.
 *
 * This is that binding. The collision finder guesses "function" exactly when it
 * sees a repeat, so it is right on every permutation draw and right on a
 * function draw only when q queries collide. Its win rate is therefore
 * (1 + p) / 2 and its advantage is p, where p is the birthday probability of a
 * collision among q draws from 2^n — which rises steeply with q and is what
 * separates a measured row from a copied one.
 *
 * This is the same arithmetic as `exactFunctionCollisionProbability` in
 * src/prf/switching.ts, written out again here rather than imported, for the
 * reason the `wilson` stand-in above states: an oracle that calls the code it
 * judges agrees with it by construction. Nothing on the render path calls that
 * function at all, so this is a genuinely independent prediction of the number
 * the page measured.
 */
function exactCollisionProbability(bits: number, queries: number): number {
  const size = 2 ** bits;
  let noCollision = 1;
  for (let index = 0; index < queries; index += 1) noCollision *= (size - index) / size;
  return 1 - noCollision;
}

/** The q values a curve measures: powers of two below q, then q itself. */
function queryValues(maximum: number): number[] {
  const values: number[] = [];
  for (let value = 2; value < maximum; value *= 2) values.push(value);
  values.push(maximum);
  return Array.from(new Set(values));
}

async function boot(page: Page): Promise<void> {
  await page.goto('.');
  await expect(page.locator('#cpa-scheme')).toBeEnabled({ timeout: 30_000 });
}

async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
}

/**
 * Fill a numeric control and COMMIT it. `fill` raises `input` but not `change`,
 * and three of this lab's inputs retire their stale result on `change`; without
 * the blur the walk below would never reach a retired state and the coverage
 * rules would be judging a set that quietly excludes it.
 */
async function setNumber(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).fill(value);
  await page.locator(selector).blur();
}

/** The four counts a trial ledger renders, read by label rather than position. */
function ledgerOf(claim: Claim): { wins: number; losses: number; errors: number; trials: number } {
  return {
    wins: Number(claimField(claim, 'Wins')),
    losses: Number(claimField(claim, 'Losses')),
    errors: Number(claimField(claim, 'Errors')),
    trials: Number(claimField(claim, 'Trials')),
  };
}

/**
 * Every value a select offers, read from the DOM rather than listed here. A
 * hand-kept list of options is a declared denominator: add an eighth scheme and
 * a listed walk keeps passing over seven.
 */
async function optionValues(page: Page, selector: string): Promise<string[]> {
  const values = await page
    .locator(`${selector} option`)
    .evaluateAll((elements) => elements.map((element) => (element as HTMLOptionElement).value));
  expect(values.length, `${selector} offers no options to walk`).toBeGreaterThan(0);
  return values;
}

/**
 * Drive every rendered state, calling back after each one.
 *
 * THIS FUNCTION IS THE DENOMINATOR. The marker-coverage tests and the
 * outside-marker test all enumerate over it, so a marker — or an unmarked
 * number — that appears only in a state this walk never reaches is outside the
 * set those rules judge, however carefully the rules themselves are written.
 * The lane rule it implements:
 *
 *   driveEveryState visits every option of every control that changes what
 *   renders — each control on its own, not the full cross-product.
 *
 * Per-control, not combinatorial, is what keeps it affordable: seven schemes
 * plus three adversaries plus five signature tactics is fifteen visits, not a
 * hundred and five. The cross-product would buy interaction coverage, which is
 * a different question and not one the marker rules ask.
 *
 * Controls enumerated, by exhibit:
 *
 *   tab list (8)       — each tab renders a different panel.
 *   #cpa-scheme (7)    — every option, read from the DOM.
 *   #cpa-adversary (3) — every option, walked on chained-IV CBC, the one scheme
 *                        that offers all three.
 *   #cpa-trials        — not a list but three distinct RENDERED outcomes: an
 *                        estimate (10 or more), the one-trial warning, and the
 *                        refusal below the floor.
 *   #cpa-step, #cpa-stop — each renders a state no other control reaches (the
 *                        one-trial warning; the stopped partial result).
 *   #cca-scheme (2)    — every option; plus the trials refusal and a retirement.
 *   #forgery-scheme (5)— every option; plus a retirement.
 *   #switch-bits, #switch-queries, #switch-trials — both ends of n, two q values
 *                        and two trial counts, plus all three refusals (n out of
 *                        range, q out of range, and the work cap) and a
 *                        retirement.
 *   #reduction-adversary (2) — every option; plus the odd-trials refusal and a
 *                        retirement.
 *   #multi-users, #multi-queries, #multi-chance — default, sampled, saturated
 *                        and invalid bounded-toy states.
 *   #hybrid-queries, #hybrid-next, #hybrid-reset — valid and refused q, every
 *                        adjacent H0-to-H5 prefix and a reset.
 *   #hybrid-oracle-run, #hardcore-run — fresh executable cache checks and one
 *                        uniform-sample reconstruction outcome.
 *   #tcr-family (2), #tcr-strategy (3), #tcr-key (4) — every option; plus
 *                        fresh target-first and key-first games, an explicit
 *                        no-answer forfeit, the spray refusal, a fresh sample,
 *                        a retirement and an invalid sample budget.
 *
 * Controls skipped, with the reason: #cpa-run, #cca-run, #forgery-run,
 * #switch-run, #reduction-run, #tcr-play, #cr-play and #tcr-sample-run are the
 * actions that produce each state above rather than states of their own, and
 * the tab list's arrow keys move the same selection its clicks do.
 */
async function driveEveryState(
  page: Page,
  visit: (label: string) => Promise<void>,
): Promise<void> {
  await visit('initial load');

  // ── exhibit 01 · #cpa-scheme, every option ────────────────────────────────
  for (const scheme of await optionValues(page, '#cpa-scheme')) {
    await page.locator('#cpa-scheme').selectOption(scheme);
    await setNumber(page, '#cpa-trials', '10');
    await page.locator('#cpa-run').click();
    await expect(page.locator('#cpa-retirement')).toContainText('Fresh result', { timeout: 90_000 });
    await visit(`exhibit 01, scheme ${scheme}`);
  }

  // ── exhibit 01 · #cpa-adversary, every option ─────────────────────────────
  await page.locator('#cpa-scheme').selectOption('aes-cbc-chained');
  await visit('exhibit 01, result retired by a scheme change');
  for (const adversary of await optionValues(page, '#cpa-adversary')) {
    await page.locator('#cpa-adversary').selectOption(adversary);
    await setNumber(page, '#cpa-trials', '10');
    await page.locator('#cpa-run').click();
    await expect(page.locator('#cpa-retirement')).toContainText('Fresh result', { timeout: 90_000 });
    await visit(`exhibit 01, adversary ${adversary}`);
  }

  // ── exhibit 01 · #cpa-trials, #cpa-step, #cpa-stop ────────────────────────
  await setNumber(page, '#cpa-trials', '5');
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Refused');
  await visit('exhibit 01, trials below the floor refused');

  await page.locator('#cpa-step').click();
  await expect(page.locator('#cpa-verdict')).toContainText('ONE TRIAL, NOT AN ESTIMATE', {
    timeout: 90_000,
  });
  await visit('exhibit 01, one stepped trial');

  // The stopped partial result is a state only this button reaches, so the run
  // it interrupts has to still be running when the click lands. Textbook RSA
  // with a random guess finishes 5,000 trials in about a second and the click
  // arrived after the run was already over; RSA-OAEP with the re-encrypting
  // adversary is two WebCrypto operations per trial, which leaves seconds of
  // margin. The click below auto-waits for the button to be enabled, so there
  // is one round trip between the run starting and the stop landing.
  await page.locator('#cpa-scheme').selectOption('rsa-oaep');
  await page.locator('#cpa-adversary').selectOption('reencrypt');
  await setNumber(page, '#cpa-trials', '5000');
  await page.locator('#cpa-run').click();
  await page.locator('#cpa-stop').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Stopped after', { timeout: 90_000 });
  await visit('exhibit 01, run stopped mid-flight');

  // ── exhibit 02 · #cca-scheme, every option, then #cca-trials ──────────────
  await openTab(page, 'CCA2 oracle');
  for (const scheme of await optionValues(page, '#cca-scheme')) {
    await page.locator('#cca-scheme').selectOption(scheme);
    await setNumber(page, '#cca-trials', '10');
    await page.locator('#cca-run').click();
    await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result', {
      timeout: 90_000,
    });
    await visit(`exhibit 02, scheme ${scheme}`);
  }
  await setNumber(page, '#cca-trials', '20');
  await expect(page.locator('#cca-retirement')).toContainText('retired');
  await visit('exhibit 02, result retired by a trial-count change');
  await setNumber(page, '#cca-trials', '5');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Refused');
  await visit('exhibit 02, trials below the floor refused');

  // ── exhibit 03 · #forgery-scheme, every option ────────────────────────────
  await openTab(page, 'Signature oracle');
  for (const scheme of await optionValues(page, '#forgery-scheme')) {
    await page.locator('#forgery-scheme').selectOption(scheme);
    await page.locator('#forgery-run').click();
    await expect(page.locator('#forgery-retirement')).toContainText('Fresh result', {
      timeout: 90_000,
    });
    await visit(`exhibit 03, scheme ${scheme}`);
  }
  await page.locator('#forgery-scheme').selectOption('rsa-pss');
  await expect(page.locator('#forgery-retirement')).toContainText('retired');
  await visit('exhibit 03, transcript retired by a scheme change');

  // ── exhibit 04 · #switch-bits, #switch-queries, #switch-trials ────────────
  const curves = [
    { bits: '8', queries: '16', trials: '100', label: 'smallest n' },
    { bits: '20', queries: '16', trials: '100', label: 'largest n' },
    { bits: '12', queries: '2', trials: '400', label: 'smallest q, larger trial count' },
    { bits: '12', queries: '64', trials: '100', label: 'larger q' },
  ];
  await openTab(page, 'PRP / PRF');
  for (const curve of curves) {
    await page.locator('#switch-bits').fill(curve.bits);
    await page.locator('#switch-queries').fill(curve.queries);
    await page.locator('#switch-trials').fill(curve.trials);
    await page.locator('#switch-run').click();
    await expect(page.locator('#switch-status')).toContainText('Fresh switching curve', {
      timeout: 90_000,
    });
    await visit(`exhibit 04, ${curve.label}`);
  }
  await setNumber(page, '#switch-trials', '200');
  await expect(page.locator('#switch-status')).toContainText('retired');
  await visit('exhibit 04, curve retired by a trial-count change');
  await setNumber(page, '#switch-bits', '7');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('Refused: n');
  await visit('exhibit 04, n outside its range refused');
  // q is refused against min(2^n, 4,096), so the refusal needs an n whose
  // domain is the smaller of the two: at n = 12 a q of 4,096 is legal and the
  // page would measure a twelve-point curve instead of refusing.
  await setNumber(page, '#switch-bits', '8');
  await setNumber(page, '#switch-queries', '4096');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('Refused: q');
  await visit('exhibit 04, q outside its range refused');
  await setNumber(page, '#switch-bits', '20');
  await setNumber(page, '#switch-queries', '4096');
  await setNumber(page, '#switch-trials', '500');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('the cap is 2,000,000');
  await visit('exhibit 04, work cap refused');
  await page.locator('#ggm-randomize').click();
  await visit('exhibit 04, GGM seed refreshed');
  await page.locator('#ggm-repeat-tree [data-ggm-path="111"]').click();
  await visit('exhibit 04, GGM alternate leaf selected');

  // ── exhibit 05 · #reduction-adversary, every option, then #reduction-trials
  await openTab(page, 'DDH reduction');
  for (const adversary of await optionValues(page, '#reduction-adversary')) {
    await page.locator('#reduction-adversary').selectOption(adversary);
    await setNumber(page, '#reduction-trials', '20');
    await page.locator('#reduction-run').click();
    await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run', {
      timeout: 90_000,
    });
    await visit(`exhibit 05, adversary ${adversary}`);
  }
  await setNumber(page, '#reduction-trials', '40');
  await expect(page.locator('#reduction-status')).toContainText('retired');
  await visit('exhibit 05, result retired by a trial-count change');
  await setNumber(page, '#reduction-trials', '21');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Refused');
  await visit('exhibit 05, odd trial count refused');

  // ── exhibit 06 · independently keyed toy opportunities ──────────────────
  await openTab(page, 'Multi-key toy');
  await visit('exhibit 06, default budget');
  await page.locator('#multi-run').click();
  await visit('exhibit 06, fresh tagged-leak game');
  await setNumber(page, '#multi-users', '8');
  await setNumber(page, '#multi-queries', '8');
  await setNumber(page, '#multi-chance', '100');
  await visit('exhibit 06, saturated ceiling');
  await setNumber(page, '#multi-users', '0');
  await visit('exhibit 06, invalid user count');

  // ── exhibit 07 · adjacent hybrids and hard-core reconstruction ───────────
  await openTab(page, 'Hybrid proof');
  await expect(page.locator('#hardcore-run')).toBeEnabled();
  await visit('exhibit 07, H0 and bounded predicate fixture');
  for (let hop = 1; hop <= 5; hop += 1) {
    await page.locator('#hybrid-next').click();
    await expect(page.locator('#hybrid-ledger [data-field="hybrid-through"]')).toHaveText(`H${hop}`);
    await visit(`exhibit 07, adjacent prefix through H${hop}`);
  }
  await page.locator('#hybrid-reset').click();
  await expect(page.locator('#hybrid-ledger [data-field="hybrid-through"]')).toHaveText('H0');
  await visit('exhibit 07, reset to H0');
  await setNumber(page, '#hybrid-queries', '1');
  await expect(page.locator('#hybrid-proof-verdict')).toContainText('INPUT REFUSED');
  await visit('exhibit 07, q below the UI range refused');
  await setNumber(page, '#hybrid-queries', '48');
  await visit('exhibit 07, valid q restores H0');
  await page.locator('#hybrid-oracle-run').click();
  await expect(page.locator('#hybrid-oracles [data-field="oracle-summary"]')).toContainText('All three oracles');
  await visit('exhibit 07, fresh real and ideal oracle checks');
  await page.locator('#hardcore-run').click();
  await expect(page.locator('#hardcore-status')).toContainText('Fresh uniform reconstruction run', {
    timeout: 90_000,
  });
  await visit('exhibit 07, fresh reconstruction');

  // ── exhibit 08 · target-first and key-first hash games ──────────────────
  await openTab(page, 'Target collisions');
  await visit('exhibit 08, default target-collision controls');
  for (const family of await optionValues(page, '#tcr-family')) {
    await page.locator('#tcr-family').selectOption(family);
    await visit(`exhibit 08, family ${family}`);
  }
  await page.locator('#tcr-family').selectOption('planted-pair');
  for (const strategy of await optionValues(page, '#tcr-strategy')) {
    await page.locator('#tcr-strategy').selectOption(strategy);
    await visit(`exhibit 08, strategy ${strategy}`);
  }
  await page.locator('#tcr-strategy').selectOption('plant-shift');
  for (const key of await optionValues(page, '#tcr-key')) {
    await page.locator('#tcr-key').selectOption(key);
    await visit(`exhibit 08, key mode ${key}`);
  }

  await page.locator('#tcr-key').selectOption('00');
  await page.locator('#tcr-play').click();
  await expect(page.locator('#tcr-verdict')).toContainText('TARGET COLLISION');
  await visit('exhibit 08, fresh target-first win');
  await page.locator('#cr-play').click();
  await expect(page.locator('#cr-verdict')).toContainText('COLLISION');
  await visit('exhibit 08, fresh key-first win');

  await page.locator('#tcr-key').selectOption('10');
  await page.locator('#tcr-play').click();
  await expect(page.locator('#tcr-transcript')).toContainText('forfeit (no partner)');
  await expect(page.locator('#tcr-transcript')).toContainText('none submitted (forfeit)');
  await visit('exhibit 08, explicit no-answer forfeit');

  await page.locator('#tcr-key').selectOption('00');
  await page.locator('#tcr-strategy').selectOption('spray-multi');
  await page.locator('#tcr-play').click();
  await expect(page.locator('#tcr-transcript')).toContainText('exactly one target');
  await visit('exhibit 08, spray second-target refusal');

  await page.locator('#tcr-strategy').selectOption('plant-shift');
  await setNumber(page, '#tcr-trials', '64');
  await page.locator('#tcr-sample-run').click();
  await expect(page.locator('#tcr-status')).toContainText('Fresh sample');
  await visit('exhibit 08, fresh bounded sample');
  const sampleBeforeReplayChange = (await readClaim(page, 'tcr-sample')).text;
  await page.locator('#tcr-key').selectOption('10');
  expect((await readClaim(page, 'tcr-sample')).text).toBe(sampleBeforeReplayChange);
  await expect(page.locator('#tcr-status')).toContainText('uniform-key sample is unchanged');
  await visit('exhibit 08, replay fixture changed while the uniform-key sample remains visible');

  await page.locator('#tcr-key').selectOption('00');
  await page.locator('#tcr-play').click();
  await page.locator('#cr-play').click();
  await expect(page.locator('#tcr-verdict')).toContainText('TARGET COLLISION');
  await expect(page.locator('#cr-verdict')).toContainText('COLLISION');
  await setNumber(page, '#tcr-trials', '128');
  await expect(page.locator('#tcr-status')).toContainText('retired');
  await expect(page.locator('#tcr-sample')).toContainText('Sample retired');
  await expect(page.locator('#tcr-verdict')).toContainText('TARGET COLLISION');
  await expect(page.locator('#cr-verdict')).toContainText('COLLISION');
  await visit('exhibit 08, sample retired by a budget change');
  await setNumber(page, '#tcr-trials', '5');
  await page.locator('#tcr-sample-run').click();
  await expect(page.locator('#tcr-status')).toContainText('Trials must be an integer');
  await visit('exhibit 08, sample budget outside the teaching range refused');
}

/**
 * Exhibit 01 either initializes or replaces its panel with the engine-failure
 * verdict. This test deliberately does NOT go through boot(): it races the two
 * outcomes so that a forced initialization failure is reported as "the page
 * rendered its engine-failure verdict", which is this marker's own assertion,
 * rather than as a 30-second timeout waiting for a control that will never
 * appear. A timeout is not a kill.
 */
test('healthy boot renders no engine-failure verdict', async ({ page }) => {
  // marker: cpa-init
  await page.goto('.');
  const outcome = await Promise.race([
    page.locator('#cpa-scheme').waitFor({ state: 'attached', timeout: 30_000 }).then(() => 'initialized'),
    page
      .locator('[data-verdict="cpa-init"]')
      .waitFor({ state: 'attached', timeout: 30_000 })
      .then(() => 'engine-failure'),
  ]);
  expect(outcome, 'exhibit 01 rendered its engine-failure verdict on a healthy boot').toBe('initialized');
  await expectNoVerdict(page, 'cpa-init');
  await expectVerdict(page, 'cpa', { text: 'READY FOR AN ADVERSARY', state: 'neutral' });
});

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title === 'healthy boot renders no engine-failure verdict') return;
  await boot(page);
});

// ── C: coverage is derived from the page ────────────────────────────────────

test('every rendered verdict marker has a mutation covering it', async ({ page }) => {
  const seen = new Set<string>();
  await driveEveryState(page, async () => {
    for (const marker of await renderedMarkers(page, 'verdict')) seen.add(marker);
  });
  const rendered = Array.from(seen).sort();
  expect(rendered.length, 'the page rendered no verdict markers at all').toBeGreaterThan(0);

  const uncovered = rendered.filter((marker) => !COVERED.verdict.includes(marker));
  expect(
    uncovered,
    `verdict markers rendered by the page with no mutation in mutations/registry.json: ${uncovered.join(', ')}`,
  ).toEqual([]);

  // The registry may not claim coverage of a marker the page never renders,
  // unless that marker is declared reachable only under mutation.
  const phantom = COVERED.verdict.filter(
    (marker) => !rendered.includes(marker) && !FAILURE_ONLY.includes(marker),
  );
  expect(
    phantom,
    `mutations/registry.json covers verdict markers the page never rendered: ${phantom.join(', ')}`,
  ).toEqual([]);

  // And the exemption must be true: a failure-only marker that turns up on a
  // healthy page was never failure-only, and has been dodging the walk.
  const notActuallyFailureOnly = FAILURE_ONLY.filter((marker) => rendered.includes(marker));
  expect(
    notActuallyFailureOnly,
    `markers flagged rendersOnlyUnderMutation that the healthy page renders anyway: ${notActuallyFailureOnly.join(', ')}`,
  ).toEqual([]);
});

/**
 * Measurement markers join the loop on the SAME terms.
 *
 * Coverage that runs over one of the two marker families is coverage of half
 * the page: a new rendered number would otherwise ship with no mutation and
 * nothing would go red, which is precisely what the coverage rule exists to
 * make impossible.
 */
test('every rendered claim marker has a mutation covering it', async ({ page }) => {
  const seen = new Set<string>();
  await driveEveryState(page, async () => {
    for (const marker of await renderedMarkers(page, 'claim')) seen.add(marker);
  });
  const rendered = Array.from(seen).sort();
  expect(rendered.length, 'the page rendered no claim markers at all').toBeGreaterThan(0);

  const uncovered = rendered.filter((marker) => !COVERED.claim.includes(marker));
  expect(
    uncovered,
    `measurement markers rendered by the page with no mutation in mutations/registry.json: ${uncovered.join(', ')}`,
  ).toEqual([]);

  const phantom = COVERED.claim.filter((marker) => !rendered.includes(marker));
  expect(
    phantom,
    `mutations/registry.json covers claim markers the page never rendered: ${phantom.join(', ')}`,
  ).toEqual([]);
});

/**
 * The killing test EXISTS and names the right helper — a cheap pre-check, and
 * NOT the rule that enforces D6.
 *
 * This is a scan of spec source, and D6 exists because a scan of spec source is
 * exactly what three auditors defeated: comment the call out and the text
 * survives inside the comment; keep the call and feed it values read off the
 * page; leave an unrelated call elsewhere in the file. All three keep a
 * substring match green while the assertion that was recorded as the kill is
 * gone.
 *
 * So the authoritative rule now runs in `e2e/global-teardown.ts`: every helper
 * writes the `(test title, marker id)` pair it EXECUTES to a run-scoped sink,
 * and the teardown fails the run when a record's pair never appeared. What this
 * test still buys is the one thing a runtime rule cannot see — a killing test
 * that was DELETED rather than hollowed out has no title to observe and nothing
 * to complain about on a `--grep`'d run, and the message here names it by id
 * rather than leaving the reader to infer it from an absence.
 */
test('every recorded mutation names an existing test that calls the shared helper', async () => {
  const sources = new Map<string, string>();
  const sourceOf = (spec: string): string => {
    if (!sources.has(spec)) {
      sources.set(spec, readFileSync(fileURLToPath(new URL(`../${spec}`, import.meta.url)), 'utf8'));
    }
    return sources.get(spec)!;
  };

  const bodyOf = (spec: string, title: string): string | null => {
    const source = sourceOf(spec);
    const starts = [...source.matchAll(/^test\(\s*'([^']+)'/gm)];
    const index = starts.findIndex((match) => match[1]!.includes(title));
    if (index === -1) return null;
    const from = starts[index]!.index!;
    const to = index + 1 < starts.length ? starts[index + 1]!.index! : source.length;
    return source.slice(from, to);
  };

  const failures: string[] = [];
  for (const entry of REGISTRY.mutations) {
    const body = bodyOf(entry.spec, entry.grep);
    if (body === null) {
      failures.push(`${entry.id}: ${entry.spec} has no test whose title contains "${entry.grep}"`);
      continue;
    }
    const required = `${requiredHelper(entry)}(page, '${entry.marker}'`;
    if (!body.includes(required)) {
      failures.push(
        `${entry.id}: "${entry.grep}" never calls ${required}), so its recorded kill was ` +
          'validated by something weaker than the shared helper',
      );
    }
  }
  expect(
    failures,
    `recorded kills that do not go through the shared helpers:\n  ${failures.join('\n  ')}`,
  ).toEqual([]);
});

test('no verdict or measurement is rendered outside a marker', async ({ page }) => {
  await driveEveryState(page, async (label) => {
    const findings = await unmarkedVerdicts(page);
    expect(
      findings,
      `verdict styling, verdict words or a measurement outside any marker at "${label}":\n${formatUnmarked(findings)}`,
    ).toEqual([]);
  });
});

/**
 * The auditor's own test. A check that has never been shown to fail is a
 * decoration, so this adds raw, unmarked content exactly the way a careless
 * builder would — one banner with verdict styling, one with only verdict words,
 * and one bare measurement in a result region — and asserts the check reports
 * all three. Without this, "nothing outside a marker" could be passing because
 * the scan is broken rather than because the page is clean.
 */
test('the coverage check catches a raw unmarked banner and a raw unmarked number', async ({ page }) => {
  expect(await unmarkedVerdicts(page)).toEqual([]);

  await page.evaluate(() => {
    const styled = document.createElement('div');
    styled.className = 'verdict';
    styled.id = 'careless-styled-banner';
    styled.innerHTML = '<div><strong>ALL CLEAR</strong><p>pasted without a marker</p></div>';
    document.querySelector('main')!.append(styled);

    const worded = document.createElement('div');
    worded.id = 'careless-worded-banner';
    // Use one of Exhibit 07's dynamic headlines so this self-test proves the
    // newly extended vocabulary cannot silently fall out of audit coverage.
    worded.innerHTML = '<strong>VERIFIED PREIMAGE FOUND</strong>';
    document.querySelector('main')!.append(worded);

    const counted = document.createElement('div');
    counted.id = 'careless-stat';
    counted.innerHTML = '<span>Group operations</span><strong>1,632</strong>';
    document.querySelector('main')!.append(counted);
  });

  const findings = await unmarkedVerdicts(page);
  expect(findings.some((finding) => finding.reason === 'styling'), 'styled banner not caught').toBe(true);
  expect(findings.some((finding) => finding.reason === 'words'), 'worded banner not caught').toBe(true);
  expect(findings.some((finding) => finding.reason === 'number'), 'unmarked number not caught').toBe(true);
  expect(findings.map((finding) => finding.where)).toEqual(
    expect.arrayContaining(['div#careless-styled-banner.verdict', 'strong']),
  );
});

// ── per-verdict assertions: each one is the kill for its own mutation ───────

test('KAT strip verdict follows the measured vectors', async ({ page }) => {
  // marker: kat
  await expectVerdict(page, 'kat', { text: 'Instruments agree', state: 'pass' });
  await expect(page.locator('#kat-summary')).toContainText('3/3 published vector cases pass');
  // The headline and the count are two renderings of the same fact; a verdict
  // that does not branch lets them disagree.
  const summary = (await page.locator('#kat-summary').textContent()) ?? '';
  const [passed, total] = summary.match(/(\d+)\/(\d+)/)!.slice(1).map(Number);
  expect(passed, 'strip says "Instruments agree" while the count says otherwise').toBe(total);
});

test('CCA2 verdict follows the measured interval', async ({ page }) => {
  // marker: cca
  await openTab(page, 'CCA2 oracle');
  await page.locator('#cca-scheme').selectOption('elgamal-cca');
  await setNumber(page, '#cca-trials', '20');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');

  const wins = Number(await page.locator('#cca-wins').textContent());
  const trials = Number(await page.locator('#cca-total').textContent());
  const advantage = Number(await page.locator('#cca-advantage').getAttribute('data-value'));
  expect(advantage).toBeCloseTo((2 * wins) / trials - 1, 12);

  // Malleating ElGamal wins every trial, so the interval is strictly above zero
  // and the verdict must be the alarm branch. Recomputed here, not assumed.
  expect(wins).toBe(trials);
  await expectVerdict(page, 'cca', { text: 'BROKEN: ADVANTAGE', state: 'alarm' });
});

test('CCA2 OAEP verdict describes the measured sample without claiming a break', async ({ page }) => {
  await openTab(page, 'CCA2 oracle');
  // OAEP's bit flip produces random guesses. A finite 95% interval can exclude
  // zero by chance, so derive the expected branch from the *measured* ledger
  // rather than assuming this particular sample is neutral.
  await page.locator('#cca-scheme').selectOption('rsa-oaep-cca');
  await setNumber(page, '#cca-trials', '40');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');
  const oaepWins = Number(await page.locator('#cca-wins').textContent());
  const oaepTrials = Number(await page.locator('#cca-total').textContent());
  const oaepInterval = wilson(oaepWins, oaepTrials);
  expect(oaepTrials).toBe(40);
  expect(Number(await page.locator('#cca-advantage').getAttribute('data-value')))
    .toBeCloseTo(oaepInterval.estimate, 12);
  if (oaepInterval.low > 0) {
    await expectVerdict(page, 'cca', { text: 'POSITIVE SAMPLE, NOT AN OAEP BREAK', state: 'neutral' });
  } else {
    await expectVerdict(page, 'cca', {
      text: 'NO ADVANTAGE FOUND BY THIS ADVERSARY',
      state: 'neutral',
    });
  }
});

test('forgery verdict follows the real verifier outcome', async ({ page }) => {
  // marker: forgery
  await openTab(page, 'Signature oracle');

  // Broken scheme: the forgery verifies, so the verdict must be the alarm branch.
  await page.locator('#forgery-scheme').selectOption('rsa-multiplicative');
  await page.locator('#forgery-run').click();
  await expect(page.locator('#forgery-retirement')).toContainText('Fresh result');
  await expectVerdict(page, 'forgery', { text: 'FORGED:', state: 'alarm' });

  // Sound scheme: the altered signature is refused, so the same element must
  // reach the pass branch. A verdict pinned to one outcome fails one of these.
  await page.locator('#forgery-scheme').selectOption('rsa-pss');
  await page.locator('#forgery-run').click();
  await expect(page.locator('#forgery-retirement')).toContainText('Fresh result');
  await expectVerdict(page, 'forgery', { text: 'REJECTED', state: 'pass' });
});

test('switching verdict follows the measured rows', async ({ page }) => {
  // marker: switching
  await openTab(page, 'PRP / PRF');
  await setNumber(page, '#switch-bits', '8');
  await setNumber(page, '#switch-queries', '16');
  await setNumber(page, '#switch-trials', '200');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('Fresh switching curve');

  // Recompute the verdict from the displayed rows and require the banner to
  // agree with them. The rows and the banner are two views of one fact.
  const rows = await page.locator('#switch-rows tr').all();
  expect(rows.length).toBeGreaterThan(1);
  let anyBreach = false;
  for (const row of rows) {
    const measured = Number(await row.getAttribute('data-measured'));
    const bound = Number(await row.getAttribute('data-bound'));
    const tolerance = Number(await row.getAttribute('data-tolerance'));
    if (measured > bound + tolerance) anyBreach = true;
  }
  await expectVerdict(page, 'switching', {
    text: anyBreach ? 'SAMPLER CHECK FAILED' : 'ALL MEASURED POINTS STAY WITHIN BOUND',
    state: anyBreach ? 'alarm' : 'pass',
  });
});

test('reduction verdict follows the measured factor', async ({ page }) => {
  // marker: reduction
  await openTab(page, 'DDH reduction');
  await setNumber(page, '#reduction-trials', '200');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run', { timeout: 90_000 });

  const b = Number(await page.locator('#reduction-b').getAttribute('data-value'));
  const expected = Number(await page.locator('#reduction-expected').textContent());
  const tolerance = Number((await page.locator('#reduction-tolerance').textContent())?.replace('±', '').trim());
  const holds = Math.abs(b - expected) <= tolerance;

  await expectVerdict(page, 'reduction', {
    text: holds ? 'PRESERVES THE EXPECTED FACTOR' : 'RELATION OUTSIDE THE DISPLAYED INTERVAL',
    state: holds ? 'pass' : 'alarm',
  });
});

// ── per-claim assertions: each one is the kill for its own mutation ─────────

test('the coin claim shows the bit the transcript opened', async ({ page }) => {
  // marker: cpa-coin
  await page.locator('#cpa-scheme').selectOption('rsa-textbook');
  await page.locator('#cpa-adversary').selectOption('reencrypt');
  await page.locator('#cpa-step').click();
  await expect(page.locator('#cpa-coin')).toHaveAttribute('data-open', 'true', { timeout: 90_000 });

  const coin = await readClaim(page, 'cpa-coin');
  const trace = (await page.locator('#cpa-trace').textContent()) ?? '';
  const opened = trace.match(/The coin opened as (\d)\./)?.[1];
  expect(opened, 'the transcript never said which way the coin opened').toBeDefined();
  expect(coin.text, 'the coin face and the transcript disagree about the hidden bit').toBe(opened);
  await expect(page.locator('#cpa-guess')).toContainText(`coin ${opened}`);
});

test('the CPA advantage claim equals the recomputed Wilson estimate', async ({ page }) => {
  // marker: cpa-advantage
  await page.locator('#cpa-scheme').selectOption('rsa-textbook');
  await page.locator('#cpa-adversary').selectOption('reencrypt');
  await setNumber(page, '#cpa-trials', '20');
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Fresh result', { timeout: 90_000 });

  const ledger = ledgerOf(await readClaim(page, 'cpa-ledger'));
  const advantage = await readClaim(page, 'cpa-advantage');
  const recomputed = wilson(ledger.wins, ledger.trials).estimate;

  expect(Number(advantage.value), 'the advantage marker does not carry the measured estimate').toBeCloseTo(
    recomputed,
    12,
  );
  expect(advantage.text, 'the readable advantage and the machine-readable one disagree').toBe(
    formatted(recomputed),
  );
});

test('the CPA interval claim equals the recomputed Wilson interval', async ({ page }) => {
  // marker: cpa-interval
  await page.locator('#cpa-scheme').selectOption('rsa-textbook');
  await page.locator('#cpa-adversary').selectOption('reencrypt');
  await setNumber(page, '#cpa-trials', '20');
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Fresh result', { timeout: 90_000 });

  const ledger = ledgerOf(await readClaim(page, 'cpa-ledger'));
  const interval = await readClaim(page, 'cpa-interval');
  const recomputed = wilson(ledger.wins, ledger.trials);

  expect(interval.text, 'the rendered interval is not the Wilson interval of the rendered ledger').toBe(
    `Wilson 95% interval: ${formatted(recomputed.low)} to ${formatted(recomputed.high)}`,
  );
});

test('the CPA ledger claim balances against its own trial count', async ({ page }) => {
  // marker: cpa-ledger
  await page.locator('#cpa-scheme').selectOption('rsa-textbook');
  await page.locator('#cpa-adversary').selectOption('reencrypt');
  await setNumber(page, '#cpa-trials', '20');
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Fresh result', { timeout: 90_000 });

  const ledger = ledgerOf(await readClaim(page, 'cpa-ledger'));
  expect(ledger.trials, 'the ledger counted a different number of trials than were requested').toBe(20);
  expect(
    ledger.wins + ledger.losses + ledger.errors,
    'wins + losses + errors does not equal the trials the ledger reports',
  ).toBe(ledger.trials);
});

test('the CPA rate claim equals the win and loss shares of the ledger', async ({ page }) => {
  // marker: cpa-rates
  await page.locator('#cpa-scheme').selectOption('rsa-textbook');
  await page.locator('#cpa-adversary').selectOption('reencrypt');
  await setNumber(page, '#cpa-trials', '20');
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Fresh result', { timeout: 90_000 });

  const ledger = ledgerOf(await readClaim(page, 'cpa-ledger'));
  const decided = Math.max(1, ledger.wins + ledger.losses);
  const rates = await readClaim(page, 'cpa-rates');

  expect(claimField(rates, 'Win'), 'the win bar does not show the win share of the decided trials').toBe(
    `${Math.round((100 * ledger.wins) / decided)}%`,
  );
  expect(claimField(rates, 'Loss'), 'the loss bar does not show the loss share of the decided trials').toBe(
    `${Math.round((100 * ledger.losses) / decided)}%`,
  );
});

test('the CCA2 ledger claim balances against its own trial count', async ({ page }) => {
  // marker: cca-ledger
  await openTab(page, 'CCA2 oracle');
  await page.locator('#cca-scheme').selectOption('elgamal-cca');
  await setNumber(page, '#cca-trials', '20');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');

  const ledger = ledgerOf(await readClaim(page, 'cca-ledger'));
  expect(ledger.trials, 'the ledger counted a different number of trials than were requested').toBe(20);
  expect(
    ledger.wins + ledger.losses + ledger.errors,
    'wins + losses + errors does not equal the trials the ledger reports',
  ).toBe(ledger.trials);
});

test('the CCA2 advantage claim equals the recomputed Wilson estimate', async ({ page }) => {
  // marker: cca-advantage
  await openTab(page, 'CCA2 oracle');
  await page.locator('#cca-scheme').selectOption('elgamal-cca');
  await setNumber(page, '#cca-trials', '20');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');

  const ledger = ledgerOf(await readClaim(page, 'cca-ledger'));
  const advantage = await readClaim(page, 'cca-advantage');
  const recomputed = wilson(ledger.wins, ledger.trials).estimate;

  expect(Number(advantage.value), 'the advantage marker does not carry the measured estimate').toBeCloseTo(
    recomputed,
    12,
  );
  expect(advantage.text, 'the readable advantage and the machine-readable one disagree').toBe(
    formatted(recomputed),
  );
});

test('the CCA2 interval claim equals the recomputed Wilson interval', async ({ page }) => {
  // marker: cca-interval
  await openTab(page, 'CCA2 oracle');
  await page.locator('#cca-scheme').selectOption('elgamal-cca');
  await setNumber(page, '#cca-trials', '20');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');

  const ledger = ledgerOf(await readClaim(page, 'cca-ledger'));
  const interval = await readClaim(page, 'cca-interval');
  const recomputed = wilson(ledger.wins, ledger.trials);

  expect(interval.text, 'the rendered interval is not the Wilson interval of the rendered ledger').toBe(
    `95% interval: ${formatted(recomputed.low)} to ${formatted(recomputed.high)}`,
  );
});

test('the switching rows claim matches the bound recomputed at the chosen n', async ({ page }) => {
  // marker: switch-rows
  //
  // Fix 4. The trial count is 2,000 rather than the 200 this test used to
  // request, and that is load-bearing rather than caution. Each row renders its
  // own alarm tolerance, and the oracle below compares that row's measured
  // advantage with the per-q prediction WITHIN that rendered width; at 200
  // trials the width is 0.381, which is wider than the whole 0.004-to-0.380
  // spread the curve covers at n = 8, so every row would sit inside every other
  // row's tolerance and a replicated curve would still be indistinguishable.
  // At 2,000 trials the width is 0.121 while sampling noise is about 0.022 —
  // five standard deviations of headroom for an honest run, and far too narrow
  // for a row copied from a different q. q = 32 rather than 16 so that two rows
  // carry that separation, not one.
  const requestedTrials = SWITCHING_TRIALS;
  await openTab(page, 'PRP / PRF');
  await setNumber(page, '#switch-bits', SWITCHING_BITS);
  await setNumber(page, '#switch-queries', SWITCHING_QUERIES);
  await setNumber(page, '#switch-trials', String(requestedTrials));
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('Fresh switching curve', { timeout: 90_000 });

  // n and q come from the controls under test, never from a literal: a literal
  // is correct only at the one setting it was written for, and the whole point
  // of the row is that the bound moves with n.
  const bits = Number(await page.locator('#switch-bits').inputValue());
  const largest = Number(await page.locator('#switch-queries').inputValue());
  await readClaim(page, 'switch-rows');

  const rows = await page.locator('#switch-rows tr').all();
  const expectedQ = queryValues(largest);
  expect(
    rows.length,
    'the table measured a different number of q values than the curve defines',
  ).toBe(expectedQ.length);

  for (const [index, row] of rows.entries()) {
    const cells = await row.locator('td').allTextContents();
    const q = Number(cells[0]);
    expect(q, `row ${index} measured the wrong q`).toBe(expectedQ[index]);
    // The cell is rendered to six decimals, so the comparison cannot be tighter
    // than the rendering: five is the closest honest precision.
    expect(Number(cells[3]), `row ${index} carries a bound that is not q(q - 1) / 2^(n + 1)`).toBeCloseTo(
      switchingBound(bits, q),
      5,
    );
    const [wins, trials] = cells[1]!.split('/').map((part) => Number(part.trim()));
    expect(Number(cells[2]), `row ${index} measured advantage disagrees with its own wins/trials`).toBeCloseTo(
      wilson(wins!, trials!).estimate,
      3,
    );

    // ── Fix 4: bind the row to ITS OWN run ────────────────────────────────
    //
    // Everything above this line is satisfied by a row that was copied from
    // another q and had its q and bound corrected: internal consistency is a
    // property a replica inherits. These three are not.
    //
    // "M trials each" is a claim about this row, so this row's own denominator
    // has to be M.
    expect(trials, `row ${index} reports a trial count the caption does not claim`).toBe(requestedTrials);
    expect(wins, `row ${index} reports more wins than it ran trials`).toBeLessThanOrEqual(trials!);

    // And the measurement itself has to be THIS q's measurement. The predicted
    // advantage at q is the birthday collision probability at q; it rises from
    // 0.004 to 0.868 across this curve, so a row carrying another q's number is
    // outside its own rendered tolerance by a wide margin, while an honest row
    // sits about five sampling standard deviations inside it.
    const tolerance = Number(cells[5]!.replace('±', '').trim());
    const predicted = exactCollisionProbability(bits, q);
    expect(
      Math.abs(Number(cells[2]) - predicted),
      `row ${index} measured ${cells[2]} at q = ${q}, where a run of ${trials} trials predicts ` +
        `${predicted.toFixed(4)} — outside this row's own rendered tolerance of ± ${tolerance}. ` +
        'A row whose number was measured at a different q is not a measurement of this q, however ' +
        'consistent it is with itself.',
    ).toBeLessThanOrEqual(tolerance);
  }

  // The caption is the sentence the rows are evidence for, so both of its
  // numbers are read back out of it and checked against the table: the count of
  // rows, and the denominator every one of those rows reported. The page
  // formats them with the browser's locale, so they are parsed rather than
  // rebuilt — Node's default locale is not the browser's to assume.
  const caption = (await page.locator('#switch-status').textContent()) ?? '';
  const captionNumbers = caption.match(/^Fresh switching curve: ([\d,]+) q values, ([\d,]+) trials each\.$/);
  expect(captionNumbers, `the caption is not the sentence these rows are evidence for: "${caption}"`).not.toBeNull();
  expect(
    Number(captionNumbers![1]!.replaceAll(',', '')),
    'the caption counts q values the table did not measure',
  ).toBe(rows.length);
  expect(
    Number(captionNumbers![2]!.replaceAll(',', '')),
    'the caption claims a per-point trial count no row reported',
  ).toBe(requestedTrials);

  // The exhibit's whole teaching is that the advantage rises with q. A curve
  // that does not rise is not this exhibit, whatever each row says about
  // itself, so the claim is asserted rather than assumed from the prose beside
  // it — and the threshold is half the predicted rise rather than a literal, so
  // it keeps meaning the same thing at another n or another q.
  const measured: number[] = [];
  for (const row of rows) measured.push(Number((await row.locator('td').allTextContents())[2]));
  const predictedRise =
    exactCollisionProbability(bits, expectedQ.at(-1)!) - exactCollisionProbability(bits, expectedQ[0]!);
  expect(
    measured.at(-1)! - measured[0]!,
    `the curve did not rise across q — a prediction of +${predictedRise.toFixed(4)} against measured ` +
      `${JSON.stringify(measured)}`,
  ).toBeGreaterThan(predictedRise / 2);
});

test('the switching chart claim spans the same points as the table', async ({ page }) => {
  // marker: switch-chart
  await openTab(page, 'PRP / PRF');
  await setNumber(page, '#switch-bits', '8');
  await setNumber(page, '#switch-queries', '16');
  await setNumber(page, '#switch-trials', '200');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('Fresh switching curve');

  await readClaim(page, 'switch-chart');
  const rows = await page.locator('#switch-rows tr').all();
  const queries: number[] = [];
  for (const row of rows) queries.push(Number((await row.locator('td').allTextContents())[0]));

  // The chart is the only rendering of the curve a screen reader gets, so its
  // label must name the same span the table measured — derived from the table,
  // not from a literal.
  await expect(page.locator('[data-claim="switch-chart"]')).toHaveAttribute(
    'aria-label',
    `Measured PRP/PRF advantage and switching bound for ${queries.length} query counts from ${queries[0]} to ${queries.at(-1)}.`,
  );
  await expect(page.locator('#switch-chart .chart-dot-measured')).toHaveCount(queries.length);
  await expect(page.locator('#switch-chart .chart-dot-bound')).toHaveCount(queries.length);
});

test('the scaled bound claim equals q(q - 1) for the chosen q', async ({ page }) => {
  // marker: switch-scaled
  await openTab(page, 'PRP / PRF');
  for (const q of ['16', '48']) {
    await page.locator('#switch-queries').fill(q);
    const scaled = await readClaim(page, 'switch-scaled');
    const numerator = BigInt(q) * (BigInt(q) - 1n);
    expect(scaled.text, `the n = 128 bound was not rescaled for q = ${q}`).toBe(
      `For q = ${q}, the n = 128 switching bound is ${numerator} / 2^129.`,
    );
  }
});

test('the reduction A claim renders one measurement two ways', async ({ page }) => {
  // marker: reduction-a
  await openTab(page, 'DDH reduction');
  await setNumber(page, '#reduction-trials', '20');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run', { timeout: 90_000 });

  const a = await readClaim(page, 'reduction-a');
  expect(Number(a.value), "A's advantage is an absolute value in [0, 1]").toBeGreaterThanOrEqual(0);
  expect(Number(a.value), "A's advantage is an absolute value in [0, 1]").toBeLessThanOrEqual(1);
  expect(a.text, 'the readable A advantage and the machine-readable one disagree').toBe(
    formatted(Number(a.value)),
  );
});

test('the reduction B claim renders one measurement two ways', async ({ page }) => {
  // marker: reduction-b
  await openTab(page, 'DDH reduction');
  await setNumber(page, '#reduction-trials', '20');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run', { timeout: 90_000 });

  const b = await readClaim(page, 'reduction-b');
  expect(Number(b.value), "B's advantage is an absolute value in [0, 1]").toBeGreaterThanOrEqual(0);
  expect(Number(b.value), "B's advantage is an absolute value in [0, 1]").toBeLessThanOrEqual(1);
  expect(b.text, 'the readable B advantage and the machine-readable one disagree').toBe(
    formatted(Number(b.value)),
  );
});

test('the reduction relation claim is half the measured A advantage', async ({ page }) => {
  // marker: reduction-relation
  await openTab(page, 'DDH reduction');
  await setNumber(page, '#reduction-trials', '20');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run', { timeout: 90_000 });

  const a = await readClaim(page, 'reduction-a');
  const relation = await readClaim(page, 'reduction-relation');

  // The page states the convention Adv(B) = Adv(A) / 2. The displayed factor
  // must therefore be half the displayed A, recomputed here from A's own value.
  expect(claimField(relation, 'A / 2'), 'the displayed factor is not half the displayed A advantage').toBe(
    formatted(Number(a.value) / 2),
  );
  const tolerance = claimField(relation, 'Displayed tolerance');
  expect(tolerance, 'the tolerance is not rendered as a ± width').toMatch(/^± [\d.]+$/);
  expect(Number(tolerance.replace('±', '').trim()), 'a tolerance must be a non-negative width').toBeGreaterThanOrEqual(0);
});

test('multi-key budget claim matches the independent Q epsilon ceiling', async ({ page }) => {
  await openTab(page, 'Multi-key toy');
  for (const [users, perUser, percent] of [[3, 4, 5], [8, 8, 3], [1, 1, 100]] as const) {
    await setNumber(page, '#multi-users', String(users));
    await setNumber(page, '#multi-queries', String(perUser));
    await setNumber(page, '#multi-chance', String(percent));
    const claim = await readClaim(page, 'multi-budget');
    const Q = users * perUser;
    const epsilon = percent / 100;
    expect(claimField(claim, 'Total opportunities Q')).toBe(String(Q));
    expect(claimField(claim, 'Exact toy advantage')).toBe(formatted(1 - (1 - epsilon) ** Q));
    const independentCeiling = Math.min(1, Q * epsilon);
    expect(claimField(claim, 'Union ceiling min(1,Qε)')).toBe(formatted(independentCeiling));
    expect(Number(claim.value)).toBeCloseTo(independentCeiling, 12);
  }
  await page.locator('#multi-run').click();
  await expect(page.locator('#multi-status')).toContainText('Fresh toy game run');
});

/* ── Exhibit 08: target collision resistance (S09) ────────────────────────── */

/**
 * The planted family written out AGAIN here, from its definition, so the
 * transcript oracle never asks the page's own arithmetic whether the page is
 * right. h is the identity except at the planted pair; H_s(x) = h(x ⊕ s).
 */
function plantedHash(key: number, x: number): number {
  const u = (x ^ key) & 0xff;
  return u === 0xf0 ? 0x0f : u;
}
function foldedHash(key: number, x: number): number {
  return ((x ^ key) & 0xff) & 0x0f;
}
function hexByte(value: number): string {
  return `0x${value.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** The p-form Wilson interval, written out rather than imported. */
function wilsonRate(wins: number, trials: number): { estimate: number; low: number; high: number } {
  const z = 1.959963984540054;
  const probability = wins / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (probability + (z * z) / (2 * trials)) / denominator;
  const radius =
    (z / denominator) *
    Math.sqrt((probability * (1 - probability)) / trials + (z * z) / (4 * trials * trials));
  return { estimate: probability, low: Math.max(0, center - radius), high: Math.min(1, center + radius) };
}

test('target-collision verdict follows the machine outcome', async ({ page }) => {
  await openTab(page, 'Target collisions');
  // Planted family, plant-shift, replayed key 0x00: the committed 0xF0 lands
  // on the planted pair (0xF0 ⊕ 0x00 = 0xF0) and collides.
  await page.locator('#tcr-key').selectOption('00');
  await page.locator('#tcr-play').click();
  await expectVerdict(page, 'tcr-game', { text: 'TARGET COLLISION', state: 'alarm' });
  // Replayed key 0x10: 0xF0 ⊕ 0x10 = 0xE0, which is outside the planted
  // pair. Plant-shift has no candidate and explicitly forfeits; that one loss
  // is not evidence that the definition holds.
  await page.locator('#tcr-key').selectOption('10');
  await page.locator('#tcr-play').click();
  await expectVerdict(page, 'tcr-game', { text: 'NO TARGET COLLISION', state: 'pass' });
  const loss = page.locator('[data-verdict="tcr-game"]');
  await expect(loss).toContainText('selected adversary lost this trial');
  await expect(loss).not.toContainText('definition held');
  const transcript = await readClaim(page, 'tcr-transcript');
  expect(transcript.text).toContain('forfeit (no partner)');
  expect(transcript.text).toContain('forfeited without a partner');
  expect(claimField(transcript, 'Partner')).toBe('none submitted (forfeit)');
  expect(transcript.text).not.toContain('submit partner none');
});

test('key-first collision verdict follows the machine outcome', async ({ page }) => {
  await openTab(page, 'Target collisions');
  // Key-first on the planted family: the strategy shifts the planted pair past
  // the mask and always collides, whatever the key. Key 0x10 is replayed on
  // purpose: at 0x00 the unshifted pair would collide too, so this key is the
  // one that distinguishes the shift from the pair.
  await page.locator('#tcr-key').selectOption('10');
  await page.locator('#cr-play').click();
  await expectVerdict(page, 'cr-game', { text: 'COLLISION', state: 'alarm' });
  // The same submission on the fold family is NOT a collision there — {0xF0,
  // 0x0F} differ across their whole low nibble — so the family-specific
  // strategy loses and the verdict says so instead of flattering it.
  await page.locator('#tcr-family').selectOption('nibble-fold');
  await page.locator('#cr-play').click();
  await expectVerdict(page, 'cr-game', { text: 'NO COLLISION', state: 'pass' });
  const loss = page.locator('[data-verdict="cr-game"]');
  await expect(loss).toContainText('selected adversary lost this trial');
  await expect(loss).not.toContainText('definition held');
});

test('target-first transcript claim shows every adjudicated move', async ({ page }) => {
  await openTab(page, 'Target collisions');
  await page.locator('#tcr-key').selectOption('00');
  await page.locator('#tcr-play').click();
  let claim = await readClaim(page, 'tcr-transcript');
  expect(claimField(claim, 'Committed target')).toBe('0xF0');
  expect(claimField(claim, 'Key revealed after')).toBe('0x00');
  expect(claimField(claim, 'Partner')).toBe('0x0F');
  expect(claimField(claim, 'Target digest')).toBe(hexByte(plantedHash(0x00, 0xf0)));
  expect(claimField(claim, 'Partner digest')).toBe(hexByte(plantedHash(0x00, 0x0f)));
  expect(claim.text).toContain('committed before any key exists');
  expect(claim.text).toContain('revealed after the commit');
  expect(claim.text).not.toContain('drawn uniformly');

  // The spray strategy's second commit is refused on the tape, with the
  // single-target rule named — the order-of-play enforcement itself.
  await page.locator('#tcr-strategy').selectOption('spray-multi');
  await page.locator('#tcr-play').click();
  claim = await readClaim(page, 'tcr-transcript');
  expect(claim.text).toContain('commit target 0x0F');
  expect(claim.text).toContain('exactly one target');
  expect(claim.text).toContain('committed before any key exists');
});

test('key-first transcript claim shows the shifted pair', async ({ page }) => {
  await openTab(page, 'Target collisions');
  await page.locator('#tcr-key').selectOption('ff');
  await page.locator('#cr-play').click();
  let claim = await readClaim(page, 'cr-transcript');
  expect(claimField(claim, 'Published key')).toBe('0xFF');
  expect(claimField(claim, 'Chosen x')).toBe('0x0F');
  expect(claimField(claim, 'Partner')).toBe('0xF0');
  expect(claimField(claim, 'Digest of x')).toBe(hexByte(plantedHash(0xff, 0x0f)));
  expect(claimField(claim, 'Partner digest')).toBe(hexByte(plantedHash(0xff, 0xf0)));
  expect(claim.text).toContain('published before any input');

  // The fold family loses this game, and its two digests differ — the branch
  // where a swapped digest cannot hide behind a winning pair's equality.
  await page.locator('#tcr-family').selectOption('nibble-fold');
  await page.locator('#cr-play').click();
  claim = await readClaim(page, 'cr-transcript');
  expect(claimField(claim, 'Digest of x')).toBe(hexByte(foldedHash(0xff, 0x0f)));
  expect(claimField(claim, 'Partner digest')).toBe(hexByte(foldedHash(0xff, 0xf0)));
});

test('target-collision separation claim distinguishes strategy from family winnability', async ({ page }) => {
  await openTab(page, 'Target collisions');
  // Planted family, every strategy: selected target-first 2/256, selected
  // key-first 1, and family/second-preimage winnability 2/256.
  for (const strategy of ['plant-shift', 'scan-pairs', 'spray-multi'] as const) {
    await page.locator('#tcr-strategy').selectOption(strategy);
    const claim = await readClaim(page, 'tcr-separation');
    expect(claimField(claim, 'Selected target-first strategy')).toBe(formatted(2 / 256));
    expect(claimField(claim, 'Selected key-first strategy')).toBe(formatted(1));
    expect(claimField(claim, 'Family target winnability')).toBe(formatted(2 / 256));
    expect(claimField(claim, 'Uniform-challenge second-preimage winnability')).toBe(formatted(2 / 256));
    expect(claimField(claim, 'Winnable inner points')).toBe('2 of 256');
    expect(Number(claim.value)).toBeCloseTo(2 / 256, 12);
  }

  // Fold family: only scan enumerates a working pair. The planted strategies
  // lose in both orders even though a partner exists for every target.
  await page.locator('#tcr-family').selectOption('nibble-fold');
  for (const [strategy, selected] of [['plant-shift', 0], ['scan-pairs', 1], ['spray-multi', 0]] as const) {
    await page.locator('#tcr-strategy').selectOption(strategy);
    const claim = await readClaim(page, 'tcr-separation');
    expect(claimField(claim, 'Selected target-first strategy')).toBe(formatted(selected));
    expect(claimField(claim, 'Selected key-first strategy')).toBe(formatted(selected));
    expect(claimField(claim, 'Family target winnability')).toBe(formatted(1));
    expect(claimField(claim, 'Uniform-challenge second-preimage winnability')).toBe(formatted(1));
    expect(claimField(claim, 'Winnable inner points')).toBe('256 of 256');
    expect(Number(claim.value)).toBe(selected);
  }
});

test('sample claim brackets deterministic and sampled orders', async ({ page }) => {
  await openTab(page, 'Target collisions');
  // Deterministic corners on the fold family: the scan wins every game in
  // both orders, while the direct planted-pair strategy loses both.
  await page.locator('#tcr-family').selectOption('nibble-fold');
  await page.locator('#tcr-strategy').selectOption('scan-pairs');
  await setNumber(page, '#tcr-trials', '64');
  await page.locator('#tcr-sample-run').click();
  let claim = await readClaim(page, 'tcr-sample');
  expect(claimField(claim, 'Target-first wins')).toContain('64 of 64');
  expect(claimField(claim, 'Key-first wins')).toContain('64 of 64');

  await page.locator('#tcr-strategy').selectOption('plant-shift');
  await page.locator('#tcr-sample-run').click();
  claim = await readClaim(page, 'tcr-sample');
  expect(claimField(claim, 'Target-first wins')).toContain('0 of 64');
  expect(claimField(claim, 'Key-first wins')).toContain('0 of 64');

  // The sampled case on the planted family: whatever the uniform keys drew,
  // the displayed rate and interval must agree with an independent Wilson
  // computation from the displayed win count itself.
  await page.locator('#tcr-family').selectOption('planted-pair');
  await setNumber(page, '#tcr-trials', '512');
  await page.locator('#tcr-sample-run').click();
  claim = await readClaim(page, 'tcr-sample');
  const wins = Number(claimField(claim, 'Target-first wins').split(' of ')[0]);
  const interval = wilsonRate(wins, 512);
  expect(claimField(claim, 'Target-first wins'))
    .toContain(`(rate ${formatted(interval.estimate)}, 95% ${formatted(interval.low)} to ${formatted(interval.high)})`);
  expect(Number(claim.value)).toBeCloseTo(wins / 512, 12);
});
