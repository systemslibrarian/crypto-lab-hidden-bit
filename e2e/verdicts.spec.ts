import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { formatUnmarked, renderedMarkers, unmarkedVerdicts } from './verdict-audit';

const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL('../mutations/registry.json', import.meta.url)), 'utf8'),
) as { mutations: { marker: string; id: string; rendersOnlyUnderMutation?: boolean }[] };

const COVERED = Array.from(new Set(REGISTRY.mutations.map((entry) => entry.marker))).sort();

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

async function boot(page: Page): Promise<void> {
  await page.goto('.');
  await expect(page.locator('#cpa-scheme')).toBeEnabled({ timeout: 30_000 });
}

async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
}

/**
 * Drive every exhibit to a rendered-result state, calling back after each one.
 *
 * Coverage is taken from the page in each of these states rather than from the
 * initial HTML, because most verdicts in this lab do not exist until an
 * experiment has run: auditing only the freshly loaded document would report
 * near-total coverage of almost nothing.
 */
async function eachRenderedState(
  page: Page,
  visit: (label: string) => Promise<void>,
): Promise<void> {
  await visit('initial load');

  await page.locator('#cpa-scheme').selectOption('rsa-textbook');
  await page.locator('#cpa-adversary').selectOption('reencrypt');
  await page.locator('#cpa-trials').fill('10');
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Fresh result', { timeout: 90_000 });
  await visit('exhibit 01, textbook RSA broken');

  await page.locator('#cpa-scheme').selectOption('aes-cbc-chained');
  await page.locator('#cpa-adversary').selectOption('random');
  await page.locator('#cpa-trials').fill('200');
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Fresh result', { timeout: 90_000 });
  await visit('exhibit 01, chained-IV CBC flat line');

  await openTab(page, 'CCA2 oracle');
  await page.locator('#cca-scheme').selectOption('elgamal-cca');
  await page.locator('#cca-trials').fill('10');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');
  await visit('exhibit 02, ElGamal CCA2');

  await openTab(page, 'Signature oracle');
  await page.locator('#forgery-scheme').selectOption('ecdsa-malleation');
  await page.locator('#forgery-run').click();
  await expect(page.locator('#forgery-retirement')).toContainText('Fresh result');
  await visit('exhibit 03, ECDSA high-S twin');

  await openTab(page, 'PRP / PRF');
  await page.locator('#switch-bits').fill('8');
  await page.locator('#switch-queries').fill('8');
  await page.locator('#switch-trials').fill('100');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('Fresh switching curve');
  await visit('exhibit 04, switching curve');

  await openTab(page, 'DDH reduction');
  await page.locator('#reduction-trials').fill('20');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run', { timeout: 90_000 });
  await visit('exhibit 05, DDH reduction');
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
  await expect(page.locator('[data-verdict="cpa-init"]')).toHaveCount(0);
  await expect(page.locator('#cpa-verdict')).toContainText('READY FOR AN ADVERSARY');
});

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title === 'healthy boot renders no engine-failure verdict') return;
  await boot(page);
});

// ── C: coverage is derived from the page ────────────────────────────────────

test('every rendered verdict marker has a mutation covering it', async ({ page }) => {
  const seen = new Set<string>();
  await eachRenderedState(page, async () => {
    for (const marker of await renderedMarkers(page)) seen.add(marker);
  });
  const rendered = Array.from(seen).sort();
  expect(rendered.length, 'the page rendered no verdict markers at all').toBeGreaterThan(0);

  const uncovered = rendered.filter((marker) => !COVERED.includes(marker));
  expect(
    uncovered,
    `verdict markers rendered by the page with no mutation in mutations/registry.json: ${uncovered.join(', ')}`,
  ).toEqual([]);

  // The registry may not claim coverage of a marker the page never renders,
  // unless that marker is declared reachable only under mutation.
  const phantom = COVERED.filter(
    (marker) => !rendered.includes(marker) && !FAILURE_ONLY.includes(marker),
  );
  expect(
    phantom,
    `mutations/registry.json covers markers the page never rendered: ${phantom.join(', ')}`,
  ).toEqual([]);

  // And the exemption must be true: a failure-only marker that turns up on a
  // healthy page was never failure-only, and has been dodging the walk.
  const notActuallyFailureOnly = FAILURE_ONLY.filter((marker) => rendered.includes(marker));
  expect(
    notActuallyFailureOnly,
    `markers flagged rendersOnlyUnderMutation that the healthy page renders anyway: ${notActuallyFailureOnly.join(', ')}`,
  ).toEqual([]);
});

test('no verdict is rendered outside a marker', async ({ page }) => {
  await eachRenderedState(page, async (label) => {
    const findings = await unmarkedVerdicts(page);
    expect(
      findings,
      `verdict styling or verdict words outside any [data-verdict] marker at "${label}":\n${formatUnmarked(findings)}`,
    ).toEqual([]);
  });
});

/**
 * The auditor's own test. A check that has never been shown to fail is a
 * decoration, so this adds a raw, unmarked banner exactly the way a careless
 * builder would — one with verdict styling, one with only verdict words — and
 * asserts the check reports both. Without this, "no verdict outside a marker"
 * could be passing because the scan is broken rather than because the page is
 * clean.
 */
test('the coverage check catches a raw unmarked banner', async ({ page }) => {
  expect(await unmarkedVerdicts(page)).toEqual([]);

  await page.evaluate(() => {
    const styled = document.createElement('div');
    styled.className = 'verdict';
    styled.id = 'careless-styled-banner';
    styled.innerHTML = '<div><strong>ALL CLEAR</strong><p>pasted without a marker</p></div>';
    document.querySelector('main')!.append(styled);

    const worded = document.createElement('div');
    worded.id = 'careless-worded-banner';
    worded.innerHTML = '<strong>FORGED: the verifier accepted it</strong>';
    document.querySelector('main')!.append(worded);
  });

  const findings = await unmarkedVerdicts(page);
  expect(findings.some((finding) => finding.reason === 'styling'), 'styled banner not caught').toBe(true);
  expect(findings.some((finding) => finding.reason === 'words'), 'worded banner not caught').toBe(true);
  expect(findings.map((finding) => finding.where)).toEqual(
    expect.arrayContaining(['div#careless-styled-banner.verdict', 'strong']),
  );
});

// ── per-marker assertions: each one is the kill for its own mutation ────────

test('KAT strip verdict follows the measured vectors', async ({ page }) => {
  // marker: kat
  const strip = page.locator('#kat-strip');
  await expect(strip).toHaveAttribute('data-state', 'pass');
  await expect(strip.locator('strong')).toHaveText('Instruments agree');
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
  await page.locator('#cca-trials').fill('20');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');

  const wins = Number(await page.locator('#cca-wins').textContent());
  const trials = Number(await page.locator('#cca-total').textContent());
  const advantage = Number(await page.locator('#cca-advantage').getAttribute('data-value'));
  expect(advantage).toBeCloseTo((2 * wins) / trials - 1, 12);

  // Malleating ElGamal wins every trial, so the interval is strictly above zero
  // and the verdict must be the alarm branch. Recomputed here, not assumed.
  expect(wins).toBe(trials);
  const verdict = page.locator('#cca-verdict');
  await expect(verdict).toHaveAttribute('data-tone', 'alarm');
  await expect(verdict).toContainText('BROKEN: ADVANTAGE');

  // The other direction: OAEP wins nothing repeatable, so the same element must
  // reach the neutral branch. One assertion per branch or the branch is untested.
  await page.locator('#cca-scheme').selectOption('rsa-oaep-cca');
  await page.locator('#cca-trials').fill('40');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');
  await expect(verdict).toHaveAttribute('data-tone', 'neutral');
  await expect(verdict).toContainText('NO ADVANTAGE FOUND BY THIS ADVERSARY');
});

test('forgery verdict follows the real verifier outcome', async ({ page }) => {
  // marker: forgery
  await openTab(page, 'Signature oracle');

  // Broken scheme: the forgery verifies, so the verdict must be the alarm branch.
  await page.locator('#forgery-scheme').selectOption('rsa-multiplicative');
  await page.locator('#forgery-run').click();
  await expect(page.locator('#forgery-retirement')).toContainText('Fresh result');
  await expect(page.locator('#forgery-verdict')).toHaveAttribute('data-tone', 'alarm');
  await expect(page.locator('#forgery-verdict')).toContainText('FORGED:');

  // Sound scheme: the altered signature is refused, so the same element must
  // reach the pass branch. A verdict pinned to one outcome fails one of these.
  await page.locator('#forgery-scheme').selectOption('rsa-pss');
  await page.locator('#forgery-run').click();
  await expect(page.locator('#forgery-retirement')).toContainText('Fresh result');
  await expect(page.locator('#forgery-verdict')).toHaveAttribute('data-tone', 'pass');
  await expect(page.locator('#forgery-verdict')).toContainText('REJECTED');
});

test('switching verdict follows the measured rows', async ({ page }) => {
  // marker: switching
  await openTab(page, 'PRP / PRF');
  await page.locator('#switch-bits').fill('8');
  await page.locator('#switch-queries').fill('16');
  await page.locator('#switch-trials').fill('200');
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
  const verdict = page.locator('#switch-verdict');
  if (anyBreach) {
    await expect(verdict).toHaveAttribute('data-tone', 'alarm');
    await expect(verdict).toContainText('SAMPLER CHECK FAILED');
  } else {
    await expect(verdict).toHaveAttribute('data-tone', 'pass');
    await expect(verdict).toContainText('ALL MEASURED POINTS STAY WITHIN BOUND');
  }
});

test('reduction verdict follows the measured factor', async ({ page }) => {
  // marker: reduction
  await openTab(page, 'DDH reduction');
  await page.locator('#reduction-trials').fill('200');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run', { timeout: 90_000 });

  const b = Number(await page.locator('#reduction-b').getAttribute('data-value'));
  const expected = Number(await page.locator('#reduction-expected').textContent());
  const tolerance = Number((await page.locator('#reduction-tolerance').textContent())?.replace('±', '').trim());
  const holds = Math.abs(b - expected) <= tolerance;

  const verdict = page.locator('#reduction-verdict');
  if (holds) {
    await expect(verdict).toHaveAttribute('data-tone', 'pass');
    await expect(verdict).toContainText('PRESERVES THE EXPECTED FACTOR');
  } else {
    await expect(verdict).toHaveAttribute('data-tone', 'alarm');
    await expect(verdict).toContainText('RELATION OUTSIDE THE DISPLAYED INTERVAL');
  }
});
