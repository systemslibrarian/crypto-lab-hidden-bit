import { createCipheriv, createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { claimField, expectVerdict, readClaim } from './verdict-audit';
import { SWITCHING_BITS, SWITCHING_QUERIES, SWITCHING_TRIALS } from './switching-params';

const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};
const HARDCORE_BITS = '10110110';
const HARDCORE_DOMAIN = 'crypto-lab-hidden-bit:E-K-04:bounded-sha256:v1';
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
  await page.locator('#switch-bits').fill(SWITCHING_BITS);
  await page.locator('#switch-queries').fill(SWITCHING_QUERIES);
  await page.locator('#switch-trials').fill(String(SWITCHING_TRIALS));
  await page.locator('#switch-run').click();
  // The curve now runs at the shared parameters, which is real work: the default
  // assertion timeout was written for a far lighter run and expires under load.
  await expect(page.locator('#switch-status')).toContainText('Fresh switching curve', {
    timeout: 90_000,
  });
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

test('GGM tree follows independent AES branches and exposes the repeated-seed failure', async ({ page }) => {
  await openTab(page, 'PRP / PRF');
  await expect(page.locator('#ggm-extension')).toBeVisible();
  await expect(page.locator('.ggm-sources a')).toHaveCount(2);
  await page.locator('#ggm-aes-tree [data-ggm-path="111"]').click();
  const claim = await readClaim(page, 'ggm-tree');
  expect(claim.text).toContain('Selected path 111');

  const hex = (await page.locator('#ggm-root').textContent())!.match(/0x([0-9a-f]{32})/)![1]!;
  let state = Buffer.from(hex, 'hex');
  for (const bit of '111') {
    const input = Buffer.alloc(32);
    input[31] = 1;
    const cipher = createCipheriv('aes-128-ecb', state, null);
    cipher.setAutoPadding(false);
    const output = Buffer.concat([cipher.update(input), cipher.final()]);
    state = Buffer.from(output.subarray(bit === '0' ? 0 : 16, bit === '0' ? 16 : 32));
  }
  const expected = `Selected path 111: state 0x${state.toString('hex')}; leaf bit ${state[0]! >>> 7}`;
  await expect(page.locator('#ggm-aes-result')).toHaveText(expected);
  await expect(page.locator('#ggm-repeat-result')).toHaveText(
    `Selected path 111: state 0x${hex}; leaf bit ${Buffer.from(hex, 'hex')[0]! >>> 7}`,
  );
  const repeatedStates = await page.locator('#ggm-repeat-tree [data-ggm-path]').evaluateAll((nodes) =>
    nodes.filter((node) => (node as HTMLElement).dataset.ggmPath?.length === 3)
      .map((node) => node.getAttribute('aria-label')!.match(/state ([0-9a-f]{32})/)![1]),
  );
  expect(repeatedStates).toEqual(Array(8).fill(hex));

  await page.locator('#ggm-randomize').click();
  const newHex = (await page.locator('#ggm-root').textContent())!.match(/0x([0-9a-f]{32})/)![1]!;
  expect(newHex).not.toBe(hex);
  await expect(page.locator('#ggm-repeat-result')).toContainText(`state 0x${newHex}`);
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

test('adjacent AES hybrids and executable oracle boundaries are independently checkable', async ({ page }) => {
  await openTab(page, 'Hybrid proof');
  await page.locator('#hybrid-queries').fill('48');
  for (let hop = 0; hop < 5; hop += 1) await page.locator('#hybrid-next').click();

  const ledger = await readClaim(page, 'hybrid-ledger');
  expect(await page.locator('#hybrid-ledger .hybrid-step').count()).toBe(5);
  expect(await page.locator('#hybrid-ledger .hybrid-step').evaluateAll((steps) =>
    steps.map((step) => ({
      from: (step as HTMLElement).dataset.from,
      to: (step as HTMLElement).dataset.to,
      kind: (step as HTMLElement).dataset.kind,
    })),
  )).toEqual([
    { from: 'H0', to: 'H1', kind: 'exact' },
    { from: 'H1', to: 'H2', kind: 'assumption' },
    { from: 'H2', to: 'H3', kind: 'exact' },
    { from: 'H3', to: 'H4', kind: 'bad-event' },
    { from: 'H4', to: 'H5', kind: 'exact' },
  ]);
  expect(claimField(ledger, 'Distinct inputs q')).toBe('48');
  expect(claimField(ledger, 'Current endpoint')).toBe('H5');
  const independentNumerator = 48 * 47;
  expect(claimField(ledger, 'Cumulative bound')).toBe(
    `Adv_AES^PRP(B_AES) + ${independentNumerator} / 2^129`,
  );
  await expectVerdict(page, 'hybrid-proof', {
    text: 'ALL FIVE ADJACENT HOPS CLASSIFIED',
    state: 'pass',
  });

  await page.locator('#hybrid-oracle-run').click();
  const oracles = await readClaim(page, 'hybrid-oracles');
  expect(oracles.value).toBe('true');
  const keyHex = await page.locator('[data-field="oracle-key"]').textContent() ?? '';
  const inputHex = await page.locator('[data-field="oracle-input"]').textContent() ?? '';
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(keyHex, 'hex'), null);
  cipher.setAutoPadding(false);
  const independentAes = Buffer.concat([
    cipher.update(Buffer.from(inputHex, 'hex')),
    cipher.final(),
  ]).toString('hex');
  await expect(page.locator('[data-oracle="aes"] [data-field="output"]')).toHaveText(independentAes);
  for (const id of ['aes', 'permutation', 'function']) {
    const row = page.locator(`[data-oracle="${id}"]`);
    await expect(row.locator('[data-field="repeat"]')).toHaveText('yes');
    await expect(row.locator('[data-field="clone"]')).toHaveText('yes');
    await expect(row.locator('[data-field="distinct"]')).toHaveText('2');
    expect(await row.locator('[data-field="output"]').textContent()).toMatch(/^[0-9a-f]{32}$/);
  }
  await expect(page.locator('[data-field="function-collision"]')).toHaveText('allowed after 2 draws');
  await expect(page.locator('[data-field="permutation-collision"]')).toHaveText(
    'rejected; unused block accepted after 3 draws',
  );
});

test('exposed predicate and Goldreich-Levin reconstruction match independent arithmetic', async ({ page }) => {
  await openTab(page, 'Hybrid proof');
  await expect(page.locator('#hardcore-run')).toBeEnabled();

  const easy = await readClaim(page, 'easy-predicate');
  const publicR = claimField(easy, 'Public r');
  expect(publicR).toBe('10011010');
  expect(claimField(easy, 'Predicate r₀')).toBe(publicR[0]);
  expect(claimField(easy, 'Public predictor')).toBe(publicR[0]);
  expect(claimField(easy, 'Complete bounded audit')).toBe('256 / 256');
  const encoded = Buffer.concat([
    Buffer.from(HARDCORE_DOMAIN, 'utf8'),
    Buffer.from([0, HARDCORE_BITS.length]),
    Buffer.from([...HARDCORE_BITS].map(Number)),
  ]);
  const independentImage = createHash('sha256').update(encoded).digest('hex');
  expect(claimField(easy, 'Domain-separated bounded f(x)')).toBe(independentImage);
  expect(easy.value).toBe(publicR[0]);

  await page.locator('#hardcore-run').click();
  await expect(page.locator('#hardcore-status')).toContainText('Fresh uniform reconstruction run', {
    timeout: 90_000,
  });
  const recovery = await readClaim(page, 'hardcore-recovery');
  const correct = (2 ** HARDCORE_BITS.length) - 1;
  const total = 2 ** HARDCORE_BITS.length;
  const probability = correct / total;
  const epsilon = probability - 0.5;
  const advantage = (2 * probability) - 1;
  const ell = Math.ceil(Math.log2((HARDCORE_BITS.length / (epsilon * epsilon)) + 1));
  const subsets = (2 ** ell) - 1;
  expect(claimField(recovery, 'Public y')).toBe(independentImage);
  expect(claimField(recovery, 'Exact predictor success p')).toBe(`${correct} / ${total}`);
  expect(Number(claimField(recovery, 'Excess ε = p − 1/2'))).toBe(epsilon);
  expect(Number(claimField(recovery, 'Normalized advantage 2p − 1 = 2ε'))).toBe(advantage);
  expect(Number(recovery.value)).toBe(advantage);
  expect(claimField(recovery, 'Sample count ℓ')).toBe(String(ell));
  expect(claimField(recovery, 'Nonempty subset XORs')).toBe(String(subsets));
  expect(claimField(recovery, 'σ guesses')).toBe(String(2 ** ell));
  const queriesPerAttempt = HARDCORE_BITS.length * subsets;
  const attempts = Number(claimField(recovery, 'Independent attempts used'));
  expect(claimField(recovery, 'Predictor queries per attempt')).toBe(String(queriesPerAttempt));
  expect(claimField(recovery, 'Total predictor queries used')).toBe(String(attempts * queriesPerAttempt));
  const samples = claimField(recovery, 'Final-attempt uniform sample vectors').split(', ');
  expect(samples).toHaveLength(ell);
  for (const sample of samples) expect(sample).toMatch(/^[01]{8}$/);
  const verified = claimField(recovery, 'Independently verified candidates').split(', ');
  expect(verified).toContain(HARDCORE_BITS);
  for (const candidate of verified) {
    const candidatePayload = Buffer.concat([
      Buffer.from(HARDCORE_DOMAIN, 'utf8'),
      Buffer.from([0, candidate.length]),
      Buffer.from([...candidate].map(Number)),
    ]);
    expect(createHash('sha256').update(candidatePayload).digest('hex')).toBe(independentImage);
  }
  await expectVerdict(page, 'hardcore-proof', {
    text: 'VERIFIED PREIMAGE FOUND',
    state: 'pass',
  });
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

/* ── Exhibit 08: target collision resistance (S09) ────────────────────── */

test('target-collision definitions distinguish the three notions and the signed pair', async ({ page }) => {
  await boot(page);
  const intro = ((await page.locator('.plain-intro').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  expect(intro).toContain("In this lab's guessing-game exhibits");
  expect(intro).toContain('normalized guessing advantage, 2p − 1');
  expect(intro).toContain('target-collision exhibit is instead a search game with no hidden coin');
  expect(intro).toContain("raw win probability p");
  expect(intro).not.toContain('A challenger hides one random bit inside a cryptographic task');
  const scope = ((await page.locator('.scope-columns').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  expect(scope).toContain('In the hidden-bit guessing exhibits, the challenger bit always comes from');
  expect(scope).toContain('the target-collision search game has no challenger bit');
  await openTab(page, 'Target collisions');
  const panel = page.locator('#panel-tcr');
  const keyBoundary = ((await panel.locator('#tcr-key ~ .field-hint').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  expect(keyBoundary).toContain('deterministic transcript fixtures, not uniform trials');
  expect(keyBoundary).toContain('scripted target-first adversary receives it only after committing its target');
  // The three notions, each with its own order of play and target supplier.
  const definitions = await readClaim(page, 'tcr-definitions');
  for (const notion of ['Collision resistance', 'Second preimage', 'Target collision']) {
    await expect(panel.locator('.definition-table th[scope="row"]', { hasText: notion })).toBeVisible();
  }
  expect(definitions.text).toContain('key and uniformly sampled challenge first');
  await expect(panel).toContainText('key first, then both inputs');
  await expect(panel).toContainText('uniformly sampled challenge');
  await expect(panel).toContainText('target first, then the key, then the partner');
  await expect(panel).toContainText('record every accepted or refused move that the selected strategy actually attempts');

  // The signed (key, digest) pair, outsider statement and malicious-signer
  // boundary are one learner-visible claim.
  const signature = await readClaim(page, 'tcr-signature-boundary');
  expect(signature.text).toContain('signs the pair');
  expect(signature.text).toContain('outsider-forgery statement');
  expect(signature.text).toContain('does not establish non-repudiation against a malicious signer');
  expect(signature.text).toContain('chooses s first may find a collision');

  // The no-extrapolation boundary is visible in the guard rails, not a
  // footnote, and distinguishes wins from target survival.
  await panel.locator('.guard-rails > summary').click();
  const model = await readClaim(page, 'tcr-model-boundary');
  expect(model.text).toContain('8-bit input and an 8-bit output');
  expect(model.text).toContain('not a UOWHF construction or an asymptotic separation proof');
  expect(model.text).toContain('wins for 2 of 256 keys');
  expect(model.text).toContain('survives for 254 of 256');
  expect(model.text).toContain('say nothing about SHA-256');
  await expect(panel).toContainText('No browser run of an 8-bit toy establishes or measures that');

  // Primary-publication links are pinned exactly; the previously used DOIs
  // resolve to unrelated papers.
  await panel.locator('.sources > summary').click();
  const sources = await readClaim(page, 'tcr-sources');
  expect(sources.text).toContain('Universal One-Way Hash Functions and Their Cryptographic Applications');
  await expect(panel.locator('a', { hasText: 'Universal One-Way Hash Functions' })).toHaveAttribute(
    'href',
    'https://dl.acm.org/doi/10.1145/73007.73011',
  );
  await expect(panel.locator('a', { hasText: 'One-Way Functions are Necessary' })).toHaveAttribute(
    'href',
    'https://dl.acm.org/doi/10.1145/100216.100269',
  );
});

test('target-collision results retire when the configuration moves', async ({ page }) => {
  await boot(page);
  await openTab(page, 'Target collisions');
  await page.locator('#tcr-key').selectOption('00');
  await page.locator('#tcr-play').click();
  await expectVerdict(page, 'tcr-game', { text: 'TARGET COLLISION', state: 'alarm' });
  await page.locator('#cr-play').click();
  await expectVerdict(page, 'cr-game', { text: 'COLLISION', state: 'alarm' });

  await page.locator('#tcr-trials').fill('64');
  await page.locator('#tcr-trials').blur();
  await page.locator('#tcr-sample-run').click();
  const freshSample = await readClaim(page, 'tcr-sample');
  expect(freshSample.text).toContain('Target-first wins');

  // A replay fixture controls only the two single-game transcripts. The
  // sample draws fresh uniform keys internally and must remain visible.
  await page.locator('#tcr-key').selectOption('10');
  await expectVerdict(page, 'tcr-game', { text: 'RESULT RETIRED', state: 'neutral' });
  await expectVerdict(page, 'cr-game', { text: 'RESULT RETIRED', state: 'neutral' });
  expect((await readClaim(page, 'tcr-sample')).text).toBe(freshSample.text);
  await expect(page.locator('#tcr-status')).toContainText('uniform-key sample is unchanged');

  // Conversely, changing only the sample budget preserves both replayed
  // machine transcripts and their verdicts.
  await page.locator('#tcr-key').selectOption('00');
  await page.locator('#tcr-play').click();
  await page.locator('#cr-play').click();
  const targetTranscript = (await readClaim(page, 'tcr-transcript')).text;
  const collisionTranscript = (await readClaim(page, 'cr-transcript')).text;
  await page.locator('#tcr-trials').fill('128');
  await page.locator('#tcr-trials').blur();
  await expect(page.locator('#tcr-sample')).toContainText('Sample retired');
  await expectVerdict(page, 'tcr-game', { text: 'TARGET COLLISION', state: 'alarm' });
  await expectVerdict(page, 'cr-game', { text: 'COLLISION', state: 'alarm' });
  expect((await readClaim(page, 'tcr-transcript')).text).toBe(targetTranscript);
  expect((await readClaim(page, 'cr-transcript')).text).toBe(collisionTranscript);
  await expect(page.locator('#tcr-status')).toContainText('game transcripts are unchanged');

  await page.locator('#tcr-family').selectOption('nibble-fold');
  await expect(page.locator('#tcr-status')).toContainText('retired');
  await expectVerdict(page, 'tcr-game', { text: 'RESULT RETIRED', state: 'neutral' });
  await expectVerdict(page, 'cr-game', { text: 'RESULT RETIRED', state: 'neutral' });
  await expect(page.locator('#tcr-sample')).toContainText('Sample retired');

  // A fresh run under the new settings clears the retirement. The fold
  // family's key-first game is won by the structure-blind scan, not by
  // plant-shift — whose pair is not a fold collision — so switch to the scan.
  await page.locator('#tcr-strategy').selectOption('scan-pairs');
  await page.locator('#cr-play').click();
  await expectVerdict(page, 'cr-game', { text: 'COLLISION', state: 'alarm' });
});

test('target-collision sampler refuses budgets outside its teaching bound', async ({ page }) => {
  await boot(page);
  await openTab(page, 'Target collisions');
  await page.locator('#tcr-trials').fill('5');
  await page.locator('#tcr-trials').blur();
  await page.locator('#tcr-sample-run').click();
  await expect(page.locator('#tcr-status')).toContainText('Trials must be an integer from 32 through 2,048');
  const claim = await readClaim(page, 'tcr-sample');
  expect(claim.text).toContain('No sample run yet');
});
