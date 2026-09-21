import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectVerdict, readClaim } from './verdict-audit';

const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};
type CurvePoint = typeof SECP_G | null;

function modulo(value: bigint, modulus: bigint): bigint {
  const result = value % modulus;
  return result >= 0n ? result : result + modulus;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = modulo(base, modulus);
  let power = exponent;
  while (power > 0n) {
    if ((power & 1n) === 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

function inverse(value: bigint, modulus: bigint): bigint {
  return modPow(modulo(value, modulus), modulus - 2n, modulus);
}

function addPoints(left: CurvePoint, right: CurvePoint): CurvePoint {
  if (!left) return right;
  if (!right) return left;
  if (left.x === right.x && modulo(left.y + right.y, SECP_P) === 0n) return null;
  const slope = left.x === right.x && left.y === right.y
    ? modulo(3n * left.x * left.x * inverse(2n * left.y, SECP_P), SECP_P)
    : modulo((right.y - left.y) * inverse(right.x - left.x, SECP_P), SECP_P);
  const x = modulo(slope * slope - left.x - right.x, SECP_P);
  return { x, y: modulo(slope * (left.x - x) - left.y, SECP_P) };
}

function multiplyPoint(scalar: bigint, point: CurvePoint): CurvePoint {
  let result: CurvePoint = null;
  let addend = point;
  let remaining = modulo(scalar, SECP_N);
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    remaining >>= 1n;
  }
  return result;
}

function decompressPublicKey(hex: string): CurvePoint {
  const prefix = Number.parseInt(hex.slice(0, 2), 16);
  const x = BigInt(`0x${hex.slice(2)}`);
  const root = modPow(modulo(x * x * x + 7n, SECP_P), (SECP_P + 1n) / 4n, SECP_P);
  const y = Number(root & 1n) === (prefix & 1) ? root : SECP_P - root;
  return { x, y };
}

function verifyEcdsaIndependently(messageHex: string, publicKeyHex: string, r: bigint, s: bigint): boolean {
  if (r <= 0n || r >= SECP_N || s <= 0n || s >= SECP_N) return false;
  const digest = createHash('sha256').update(Buffer.from(messageHex, 'hex')).digest('hex');
  const inverseS = inverse(s, SECP_N);
  const point = addPoints(
    multiplyPoint((BigInt(`0x${digest}`) * inverseS) % SECP_N, SECP_G),
    multiplyPoint((r * inverseS) % SECP_N, decompressPublicKey(publicKeyHex)),
  );
  return point !== null && point.x % SECP_N === r;
}

async function boot(page: Page): Promise<void> {
  await page.goto('.');
  await expect(page.locator('#cpa-scheme')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('h1')).toHaveText('Hidden Bit');
}
// The KAT strip's own verdict assertion lives in verdicts.spec.ts
// ("KAT strip verdict follows the measured vectors"), not in boot(). A claim
// asserted inside a shared fixture turns one broken verdict into a red suite,
// which is exactly the shape that makes a real kill indistinguishable from a
// collapsed run.

async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
}

async function runCpa(
  page: Page,
  scheme: string,
  adversary: string,
  trials: number,
): Promise<void> {
  await page.locator('#cpa-scheme').selectOption(scheme);
  await page.locator('#cpa-adversary').selectOption(adversary);
  await page.locator('#cpa-trials').fill(String(trials));
  await page.locator('#cpa-trials').blur();
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Fresh result', { timeout: 90_000 });
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('headline advantage and ledger are independently consistent', async ({ page }) => {
  await runCpa(page, 'rsa-textbook', 'reencrypt', 20);
  const wins = Number(await page.locator('#cpa-wins').textContent());
  const losses = Number(await page.locator('#cpa-losses').textContent());
  const errors = Number(await page.locator('#cpa-errors').textContent());
  const trials = Number(await page.locator('#cpa-total').textContent());
  const displayed = Number(await page.locator('#cpa-advantage').textContent());
  expect(wins + losses + errors).toBe(trials);
  expect(wins).toBe(20);
  expect(losses).toBe(0);
  expect(displayed).toBeCloseTo((2 * wins) / trials - 1, 12);
  await expectVerdict(page, 'cpa', { text: 'BROKEN: ADVANTAGE', state: 'alarm' });
});

test('changing an input retires a result while a no-op does not', async ({ page }) => {
  await runCpa(page, 'rsa-textbook', 'reencrypt', 10);
  const freshText = await page.locator('#cpa-retirement').textContent();
  await page.locator('#cpa-scheme').selectOption('rsa-textbook');
  expect(await page.locator('#cpa-retirement').textContent()).toBe(freshText);
  await page.locator('#cpa-scheme').selectOption('aes-gcm');
  await expect(page.locator('#cpa-retirement')).toContainText('retired');
  await expect(page.locator('#cpa-total')).toHaveText('0');
  await expect(page.locator('#cpa-verdict')).toContainText('READY FOR AN ADVERSARY');
});

test('negative claim survives green KATs and two misleading flat lines', async ({ page }) => {
  await runCpa(page, 'aes-cbc-chained', 'random', 600);
  await runCpa(page, 'aes-cbc-chained', 'reencrypt', 600);
  await expect(page.locator('#kat-strip')).toHaveAttribute('data-state', 'pass');
  // The headline and the tone are one claim: two genuine flat lines promote
  // both, so a mutation that pins either of them fails here.
  await expectVerdict(page, 'cpa-negative', {
    text: 'NO ADVANTAGE FOUND BY THESE ADVERSARIES — AND THE SCHEME IS BROKEN',
    state: 'alarm',
  });
  await expect(page.locator('#cbc-negative')).toContainText(
    'A measured advantage near zero shows that these adversaries failed; it is not evidence that the scheme is IND-CPA secure.',
  );
  await expect(page.locator('#fixture-random')).toHaveAttribute('data-done', 'true');
  await expect(page.locator('#fixture-reencrypt')).toHaveAttribute('data-done', 'true');

  await runCpa(page, 'aes-cbc-chained', 'beast', 20);
  expect(Number(await page.locator('#cpa-advantage').getAttribute('data-value'))).toBeGreaterThan(0.9);
});

test('ECDSA values reconstruct the accepted high-S twin', async ({ page }) => {
  await openTab(page, 'Signature oracle');
  await page.locator('#forgery-scheme').selectOption('ecdsa-malleation');
  await page.locator('#forgery-run').click();
  await expect(page.locator('#forgery-retirement')).toContainText('Fresh result');

  // The transcript marker is read and SHAPE-CHECKED before anything is
  // converted. BigInt() throws on a value it cannot parse, and a thrown
  // conversion is not an assertion: a kill has to be this marker's own check
  // failing, with an Expected and a Received a reader can compare.
  const transcript = await readClaim(page, 'forgery-transcript');
  for (const field of ['r', 's', 'n', 'malleatedS', 'malleatedSignature', 'plainVerifier', 'lowSVerifier']) {
    expect(transcript.text, `the transcript no longer renders ${field}`).toContain(field);
  }
  for (const field of ['r', 's', 'n', 'malleatedS']) {
    expect(
      await page.locator(`[data-field="${field}"]`).textContent(),
      `the transcript renders ${field} in a form no reader can check`,
    ).toMatch(/^0x[0-9a-f]+$/);
  }

  const r = BigInt(await page.locator('[data-field="r"]').textContent() ?? '0');
  const s = BigInt(await page.locator('[data-field="s"]').textContent() ?? '0');
  const n = BigInt(await page.locator('[data-field="n"]').textContent() ?? '0');
  const malleatedS = BigInt(await page.locator('[data-field="malleatedS"]').textContent() ?? '0');
  const messageHex = await page.locator('[data-field="messageHex"]').textContent() ?? '';
  const publicKey = await page.locator('[data-field="publicKey"]').textContent() ?? '';
  const malleatedSignature = await page.locator('[data-field="malleatedSignature"]').textContent() ?? '';
  expect(r).toBeGreaterThan(0n);
  expect(n).toBe(SECP_N);
  expect(malleatedS).toBe(n - s);
  expect(BigInt(`0x${malleatedSignature.slice(0, 64)}`)).toBe(r);
  expect(BigInt(`0x${malleatedSignature.slice(64)}`)).toBe(malleatedS);
  expect(malleatedS).toBeGreaterThan(n / 2n);

  // Both verifier banners are checked against an INDEPENDENT decision, not
  // against the text they are expected to show. Asserting that a banner says
  // "ACCEPTED" proves only that some string reached the DOM; until this lane
  // these two banners were literals, and forcing the page's own plain verifier
  // to enforce low-S left it rendering "PLAIN VERIFIER: ACCEPTED" next to a
  // computed "rejected" with all ten claims still green.
  const independentlyAccepted = verifyEcdsaIndependently(messageHex, publicKey, r, malleatedS);
  expect(independentlyAccepted, 'the (r, n - s) twin must verify under plain ECDSA').toBe(true);
  await expectVerdict(page, 'forgery-plain', {
    text: independentlyAccepted ? 'PLAIN VERIFIER: ACCEPTED' : 'PLAIN VERIFIER: REJECTED',
    state: independentlyAccepted ? 'alarm' : 'pass',
  });
  if (independentlyAccepted) {
    await expect(page.locator('#plain-verifier')).toContainText('VERIFIES — AND IS A NEW SIGNATURE ON A QUERIED MESSAGE');
  }

  // A canonical low-S verifier must refuse any s above n / 2. That is decided
  // here by arithmetic on the displayed s, not by the page's own verifier.
  const twinIsHighS = malleatedS > n / 2n;
  expect(twinIsHighS, 'the twin must be the high-S form for this exhibit to mean anything').toBe(true);
  await expectVerdict(page, 'forgery-lows', {
    text: twinIsHighS ? 'LOW-S VERIFIER: REJECTED' : 'LOW-S VERIFIER: ACCEPTED',
    state: twinIsHighS ? 'pass' : 'alarm',
  });

  // The transcript's own computed fields must agree with the banners; three
  // readouts of one fact are only evidence while they cannot disagree.
  await expect(page.locator('[data-field="plainVerifier"]')).toHaveText(
    independentlyAccepted ? 'accepted' : 'rejected',
  );
  await expect(page.locator('[data-field="lowSVerifier"]')).toHaveText(
    twinIsHighS ? 'rejected' : 'accepted',
  );

});

test('displayed textbook RSA forgeries verify on unqueried messages', async ({ page }) => {
  await openTab(page, 'Signature oracle');
  for (const scheme of ['rsa-multiplicative', 'rsa-blinding']) {
    await page.locator('#forgery-scheme').selectOption(scheme);
    await page.locator('#forgery-run').click();
    await expect(page.locator('#forgery-retirement')).toContainText('Fresh result');
    const messageField = scheme === 'rsa-multiplicative' ? 'forgedMessage' : 'target';
    const message = BigInt(await page.locator(`[data-field="${messageField}"]`).textContent() ?? '0');
    const signature = BigInt(await page.locator('[data-field="forgedSignature"]').textContent() ?? '0');
    const modulus = BigInt(await page.locator('[data-field="modulus"]').textContent() ?? '0');
    const exponent = BigInt(await page.locator('[data-field="exponent"]').textContent() ?? '0');
    const queried = (await page.locator('[data-field="queried"]').textContent() ?? '')
      .split(',')
      .map((value) => BigInt(value.trim()));
    expect(queried).not.toContain(message);
    expect(modPow(signature, exponent, modulus)).toBe(message);
    await expect(page.locator('#forgery-verdict')).toHaveAttribute('data-tone', 'alarm');
  }
});

test('switching rows match the formula and stay under bound plus tolerance', async ({ page }) => {
  await openTab(page, 'PRP / PRF');
  await page.locator('#switch-bits').fill('8');
  await page.locator('#switch-queries').fill('20');
  await page.locator('#switch-trials').fill('200');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('Fresh switching curve');
  const rows = page.locator('#switch-rows tr');
  expect(await rows.count()).toBeGreaterThan(1);
  // n is read back from the control, never written as a literal: 2 ** 9 is
  // 2^(n + 1) for the one n this test happens to set, and it would keep
  // agreeing by luck while silently ceasing to check anything the moment the
  // control moved.
  const bits = Number(await page.locator('#switch-bits').inputValue());
  for (const row of await rows.all()) {
    const cells = await row.locator('td').allTextContents();
    const q = Number(cells[0]);
    const measured = Number(cells[2]);
    const bound = Number(cells[3]);
    const tolerance = Number(cells[5]!.replace('±', '').trim());
    expect(bound).toBeCloseTo((q * (q - 1)) / (2 * 2 ** bits), 5);
    expect(measured).toBeLessThanOrEqual(bound + tolerance + 0.0002);
  }
});

test('DDH wrapper reports the stated factor within its displayed interval', async ({ page }) => {
  await openTab(page, 'DDH reduction');
  await page.locator('#reduction-trials').fill('200');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run', { timeout: 90_000 });
  const a = Number(await page.locator('#reduction-a').textContent());
  const b = Number(await page.locator('#reduction-b').textContent());
  const expected = Number(await page.locator('#reduction-expected').textContent());
  const tolerance = Number((await page.locator('#reduction-tolerance').textContent())?.replace('±', '').trim());
  expect(expected).toBeCloseTo(a / 2, 2);
  expect(Math.abs(b - expected)).toBeLessThanOrEqual(tolerance + 0.002);
});

test('exact CCA challenge is refused and hidden panels stay unpainted', async ({ page }) => {
  await openTab(page, 'CCA2 oracle');
  await page.locator('#cca-trials').fill('20');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');
  await expectVerdict(page, 'cca-boundary', { text: 'EXACT CHALLENGE REFUSED', state: 'pass' });
  expect(Number(await page.locator('#cca-errors').textContent())).toBe(0);

  await page.locator('#cca-scheme').selectOption('elgamal-cca');
  await page.locator('#cca-trials').fill('10');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');
  await expectVerdict(page, 'cca-boundary', { text: 'EXACT CHALLENGE REFUSED', state: 'pass' });
  await expect(page.locator('#cca-advantage')).toHaveText('1.000');

  const paintedHidden = await page.locator('[hidden]').evaluateAll((elements) =>
    elements
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => element.id || element.className),
  );
  expect(paintedHidden).toEqual([]);
  const verdicts = await page.locator('.verdict strong').allTextContents();
  expect(verdicts.join(' ')).not.toMatch(/\bsecure\b/i);
});

test('every exhibit retires stale output and switching refuses excessive work', async ({ page }) => {
  await openTab(page, 'CCA2 oracle');
  await page.locator('#cca-scheme').selectOption('elgamal-cca');
  await page.locator('#cca-trials').fill('10');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');
  await page.locator('#cca-scheme').selectOption('rsa-oaep-cca');
  await expect(page.locator('#cca-total')).toHaveText('0');
  await expect(page.locator('#cca-refusal')).toContainText('NOT QUERIED YET');

  await openTab(page, 'Signature oracle');
  await page.locator('#forgery-scheme').selectOption('ecdsa-malleation');
  await page.locator('#forgery-run').click();
  await expect(page.locator('#forgery-retirement')).toContainText('Fresh result');
  await page.locator('#forgery-scheme').selectOption('rsa-pss');
  await expect(page.locator('#forgery-values')).toContainText('Previous transcript retired');
  await expect(page.locator('#ecdsa-twin')).toBeHidden();

  await openTab(page, 'PRP / PRF');
  await page.locator('#switch-bits').fill('8');
  await page.locator('#switch-queries').fill('8');
  await page.locator('#switch-trials').fill('100');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('Fresh switching curve');
  await page.locator('#switch-bits').fill('9');
  await expect(page.locator('#switch-rows')).toContainText('Previous curve retired');
  await expect(page.locator('#switch-chart')).toBeEmpty();
  await page.locator('#switch-bits').fill('20');
  await page.locator('#switch-queries').fill('4096');
  await page.locator('#switch-trials').fill('500');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('the cap is 2,000,000');

  await openTab(page, 'DDH reduction');
  await page.locator('#reduction-trials').fill('20');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run');
  await page.locator('#reduction-adversary').selectOption('reencrypt');
  await expect(page.locator('#reduction-a')).toHaveText('0.000');
  await expect(page.locator('#reduction-verdict')).toContainText('RESULT RETIRED');
});

test('all vulnerable choices are labelled and never selected by default', async ({ page }) => {
  await expect(page.locator('#cpa-scheme')).toHaveValue('rsa-oaep');
  const options = await page.locator('#cpa-scheme option').allTextContents();
  expect(options).toContain('Textbook RSA (BROKEN)');
  expect(options).toContain('AES-ECB (BROKEN)');
  expect(options).toContain('AES-CBC, chained IV (BROKEN)');
  await openTab(page, 'CCA2 oracle');
  await expect(page.locator('#cca-scheme')).toHaveValue('rsa-oaep-cca');
  await openTab(page, 'Signature oracle');
  await expect(page.locator('#forgery-scheme')).toHaveValue('rsa-pss');
});