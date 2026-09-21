import { expect, type Page } from '@playwright/test';

/**
 * Marker coverage is derived from the RENDERED PAGE, never from a hand-kept
 * list. A list of exhibits is a self-report; the DOM is evidence.
 *
 * This lab renders TWO families of marker and they are judged on the same
 * terms:
 *
 *   [data-verdict="<id>"] — a headline that says what happened.
 *   [data-claim="<id>"]   — a measurement the reader is invited to check.
 *
 * Three invariants, deliberately pointing in different directions:
 *
 *   1. every marker of EITHER family that the page renders has a mutation
 *      covering it (checked in verdicts.spec.ts against mutations/registry.json),
 *   2. no verdict is rendered OUTSIDE a marker — not by its styling (the
 *      `.verdict` class) and not by its words, and
 *   3. no MEASUREMENT is rendered outside a marker either: a number painted in
 *      a result region without a marker is exactly as unchecked as a verdict
 *      painted without one, and it is the easier mistake to make, because a
 *      number does not look like a claim.
 *
 * (1) alone is gameable: drop the marker and the verdict stops needing a
 * mutation. (2) and (3) are what close that door, and they are what catches a
 * careless builder pasting a raw banner — or a raw number — in six months.
 */

/**
 * The outcome vocabulary this lab actually renders. Matching is CASE SENSITIVE
 * and the vocabulary is all-caps on purpose: every verdict headline in this lab
 * is all-caps house style, while the surrounding prose that legitimately
 * discusses the same ideas ("refused; advantage is undefined", "Textbook RSA
 * (BROKEN)", "plainVerifier: accepted") is not. That single distinction is what
 * keeps the check free of false positives without weakening it.
 */
const VERDICT_WORDS = [
  'BROKEN: ',
  'AND THE SCHEME IS BROKEN',
  'FORGED: ',
  'REJECTED',
  'ACCEPTED',
  'EXACT CHALLENGE REFUSED',
  'BOUNDARY FAILURE',
  'NO ADVANTAGE FOUND',
  'VERIFIES',
  'SAMPLER CHECK FAILED',
  'STAY WITHIN BOUND',
  'RELATION OUTSIDE',
  'PRESERVES THE EXPECTED FACTOR',
  'TRIAL LOOP ABORTED',
  'ONE TRIAL, NOT AN ESTIMATE',
  'DID NOT INITIALIZE',
  'INSTRUMENTS AGREE',
  'KNOWN-ANSWER MISMATCH',
  'RESULT RETIRED',
  'NOT QUERIED YET',
  'READY',
];

/**
 * The measurement vocabulary, in the same spirit: patterns that in this lab are
 * only ever produced by a computation, never by prose.
 *
 *   readout — the element's WHOLE own text is a number, a percentage, a ratio,
 *             a Wilson interval or a ± tolerance. Every stat tile, table cell,
 *             metric value and chart axis label in this lab has this shape.
 *   decimal — a decimal fraction anywhere in the text. Every one of them in
 *             this lab is a measured or derived quantity; the static prose
 *             carries integers ("10 through 5,000", "q > 2^n") and never a
 *             decimal point.
 *   unit    — the lane brief's fleet-wide digit-plus-unit pattern, carried here
 *             verbatim except that the ONE-CHARACTER units require whitespace
 *             in front. Without that, a random hex transcript ending "…a5b…"
 *             matches `\d\s*B\b` and the rule reports a measurement that is not
 *             one. Multi-character units cannot collide with hex.
 *
 * What this deliberately does NOT catch is an integer embedded in a sentence
 * ("Fresh result: 200 trials under Textbook RSA", "Guess 1; coin 1; win."):
 * those are status and provenance lines, they are asserted by name in
 * claims.spec.ts, and widening the rule to reach them would make it fire on
 * every field hint and guard rail in the page. The boundary is stated here
 * rather than left to be inferred, exactly as the all-caps boundary is above.
 */
const NUMERIC_READOUT =
  /^[±+-]?\s*\[?\s*-?\d[\d,]*(?:\.\d+)?\s*%?(?:\s*[/,]\s*[±+-]?\s*-?\d[\d,]*(?:\.\d+)?\s*%?)*\s*\]?$/;
const DECIMAL_FRACTION = /\d+\.\d+/;
const DIGIT_PLUS_UNIT = /\d[\d,.]*(?:\s*(?:KB|MB|bits?|bytes?|ops?|operations?|ms)|\s+(?:B|s|×|x))\b/i;

/**
 * Where the measurement rule applies: everything inside <main>, which is every
 * exhibit panel and nothing else. The exhibit index chips in the tab bar
 * (`<span>01</span>`) and the footer's scripture citation are numbers that are
 * not measurements and do not live in a result region.
 */
const RESULT_REGION = 'main';

export type MarkerFamily = 'verdict' | 'claim';

export interface UnmarkedVerdict {
  readonly reason: 'styling' | 'words' | 'number';
  readonly text: string;
  readonly html: string;
  readonly where: string;
}

/** Every marker id of one family currently rendered on the page, sorted. */
export async function renderedMarkers(page: Page, family: MarkerFamily = 'verdict'): Promise<string[]> {
  return page.evaluate((name) => {
    const attribute = `data-${name}`;
    return Array.from(
      new Set(
        Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`)).map(
          (element) => element.getAttribute(attribute) ?? '',
        ),
      ),
    )
      .filter(Boolean)
      .sort();
  }, family);
}

/**
 * Fix 1 — a marker's TEXT and its STATE are ONE claim, so one helper asserts
 * both and every recorded kill goes through it.
 *
 * A text-only assertion lets a mutation flip the words while leaving the marker
 * painted as a pass, and the marker goes on claiming success in every way a
 * reader can see except the sentence. This asserts four things together:
 *
 *   1. the marker is rendered, exactly once;
 *   2. its text contains what the caller expects;
 *   3. its state attribute holds the expected value — `data-tone` on the
 *      verdict banners, `data-state` on the KAT strip; a marker carrying
 *      neither is itself the failure, because then it has no state to agree
 *      with its words; and
 *   4. that state attribute is the one the STYLESHEET keys on. Proven, not
 *      assumed: the probe below flips the attribute in place, reads the
 *      computed painting again, and restores it. An attribute nothing paints
 *      is a state the reader cannot see, which is the same defect as no state
 *      at all.
 */
export async function expectVerdict(
  page: Page,
  id: string,
  expected: { readonly text: string | RegExp; readonly state: string },
): Promise<void> {
  const marker = page.locator(`[data-verdict="${id}"]`);
  await expect(marker, `verdict marker "${id}" is not rendered exactly once`).toHaveCount(1);
  await expect(marker, `verdict marker "${id}" rendered the wrong text`).toContainText(expected.text);

  const attribute = await marker.evaluate((element) =>
    element.hasAttribute('data-tone')
      ? 'data-tone'
      : element.hasAttribute('data-state')
        ? 'data-state'
        : '',
  );
  expect(
    attribute,
    `verdict marker "${id}" carries no data-tone or data-state, so its words have no state to agree with`,
  ).not.toBe('');
  await expect(
    marker,
    `verdict marker "${id}" says the right words in the wrong state`,
  ).toHaveAttribute(attribute, expected.state);

  const painted = await marker.evaluate((element, name) => {
    const read = (): string => {
      const style = getComputedStyle(element);
      return `${style.backgroundColor}|${style.borderLeftColor}|${style.color}`;
    };
    const original = element.getAttribute(name);
    const before = read();
    element.setAttribute(name, original === 'alarm' ? 'pass' : 'alarm');
    const after = read();
    if (original === null) element.removeAttribute(name);
    else element.setAttribute(name, original);
    return before !== after;
  }, attribute);
  expect(
    painted,
    `verdict marker "${id}" has a ${attribute} the stylesheet does not paint: its state is invisible to a reader, so text alone would carry the whole claim`,
  ).toBe(true);
}

/**
 * The counterpart for a marker whose claim is its ABSENCE — the engine-failure
 * banner no healthy page renders. Recorded kills for `rendersOnlyUnderMutation`
 * markers go through this instead of expectVerdict.
 */
export async function expectNoVerdict(page: Page, id: string): Promise<void> {
  await expect(
    page.locator(`[data-verdict="${id}"]`),
    `verdict marker "${id}" is declared reachable only under mutation, but the page rendered it`,
  ).toHaveCount(0);
}

export interface Claim {
  /** The marker's whole text, whitespace collapsed. */
  readonly text: string;
  /** Its `data-value`, when it carries one. */
  readonly value: string | null;
  /**
   * Its leaf texts, in document order. A stat tile renders its label and its
   * number as separate elements with no whitespace between them, so the
   * concatenated text says "Wins20Losses0"; reading the leaves keeps the label
   * and the number distinguishable without a spec-side guess about markup.
   */
  readonly leaves: readonly string[];
}

/**
 * Fix 2 — the reader for a measurement marker. Every recorded kill of a
 * `data-claim` marker goes through this, so "the spec mentions the id" can
 * never again stand in for "the spec read the marker".
 *
 * Returns what the marker renders, so the caller can compare it with an
 * INDEPENDENTLY computed expectation rather than with the page's other
 * rendering of the same number.
 */
export async function readClaim(page: Page, id: string): Promise<Claim> {
  const marker = page.locator(`[data-claim="${id}"]`);
  await expect(marker, `claim marker "${id}" is not rendered exactly once`).toHaveCount(1);
  return marker.evaluate((element) => {
    const leaves: string[] = [];
    const walk = (node: Element): void => {
      const own = Array.from(node.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (own) leaves.push(own);
      for (const child of Array.from(node.children)) walk(child);
    };
    walk(element);
    return {
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
      value: element.getAttribute('data-value'),
      leaves,
    };
  });
}

/**
 * The leaf that follows a labelled leaf — "Wins" then its count. Throws rather
 * than returning undefined, because a missing label is a rendering change the
 * caller must see, not a value to compare against nothing.
 */
export function claimField(claim: Claim, label: string): string {
  const index = claim.leaves.indexOf(label);
  expect(index, `claim does not render a "${label}" label; leaves were ${JSON.stringify(claim.leaves)}`).toBeGreaterThanOrEqual(0);
  const value = claim.leaves[index + 1];
  expect(value, `claim renders "${label}" with nothing after it; leaves were ${JSON.stringify(claim.leaves)}`).toBeDefined();
  return value!;
}

/**
 * Verdicts and measurements rendered outside any marker.
 *
 * The scans read each element's OWN direct text nodes rather than its
 * `textContent`, so an ancestor is never blamed for what a descendant says and
 * a bare `<div>REJECTED</div>` — or a bare `<td>0.0412</td>` — is still caught.
 */
export async function unmarkedVerdicts(page: Page): Promise<UnmarkedVerdict[]> {
  return page.evaluate(
    ({ words, region, patterns }) => {
      const readout = new RegExp(patterns.readout);
      const decimal = new RegExp(patterns.decimal);
      const unit = new RegExp(patterns.unit, 'i');
      const describe = (element: Element): string => {
        const id = element.id ? `#${element.id}` : '';
        const cls = element.className && typeof element.className === 'string'
          ? `.${element.className.trim().split(/\s+/).join('.')}`
          : '';
        return `${element.tagName.toLowerCase()}${id}${cls}`;
      };
      const visible = (element: Element): boolean => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return !element.closest('[hidden]');
      };
      const marked = (element: Element): boolean =>
        element.closest('[data-verdict]') !== null || element.closest('[data-claim]') !== null;
      const ownText = (element: Element): string =>
        Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join(' ')
          .trim();

      const findings: {
        reason: 'styling' | 'words' | 'number';
        text: string;
        html: string;
        where: string;
      }[] = [];

      // (a) verdict STYLING outside a marker.
      for (const element of Array.from(document.querySelectorAll('.verdict'))) {
        if (element.closest('[data-verdict]')) continue;
        findings.push({
          reason: 'styling',
          text: (element.textContent ?? '').trim().slice(0, 160),
          html: element.outerHTML.slice(0, 240),
          where: describe(element),
        });
      }

      // (b) verdict WORDS outside a marker.
      for (const element of Array.from(document.querySelectorAll('body *'))) {
        if (element.closest('[data-verdict]')) continue;
        if (!visible(element)) continue;
        const text = ownText(element);
        if (!text) continue;
        const hit = words.find((word) => text.includes(word));
        if (!hit) continue;
        findings.push({
          reason: 'words',
          text: `${hit} :: ${text.slice(0, 160)}`,
          html: element.outerHTML.slice(0, 240),
          where: describe(element),
        });
      }

      // (c) MEASUREMENTS outside a marker, inside the result regions.
      for (const element of Array.from(document.querySelectorAll(`${region} *`))) {
        if (marked(element)) continue;
        if (!visible(element)) continue;
        const text = ownText(element);
        if (!text) continue;
        const hit = readout.test(text)
          ? 'numeric readout'
          : decimal.test(text)
            ? 'decimal fraction'
            : unit.test(text)
              ? 'digit plus unit'
              : '';
        if (!hit) continue;
        findings.push({
          reason: 'number',
          text: `${hit} :: ${text.slice(0, 160)}`,
          html: element.outerHTML.slice(0, 240),
          where: describe(element),
        });
      }
      return findings;
    },
    {
      words: VERDICT_WORDS,
      region: RESULT_REGION,
      patterns: {
        readout: NUMERIC_READOUT.source,
        decimal: DECIMAL_FRACTION.source,
        unit: DIGIT_PLUS_UNIT.source,
      },
    },
  );
}

export function formatUnmarked(findings: UnmarkedVerdict[]): string {
  return findings
    .map(
      (finding, index) =>
        `  ${index + 1}. [${finding.reason}] ${finding.where}\n     ${finding.text}\n     ${finding.html}`,
    )
    .join('\n');
}
