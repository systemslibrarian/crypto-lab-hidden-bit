import type { Page } from '@playwright/test';

/**
 * Verdict coverage is derived from the RENDERED PAGE, never from a hand-kept
 * list. A list of exhibits is a self-report; the DOM is evidence.
 *
 * Two invariants, deliberately pointing in opposite directions:
 *
 *   1. every `[data-verdict]` marker the page renders has a mutation covering
 *      it (checked in verdicts.spec.ts against mutations/registry.json), and
 *   2. no verdict is rendered OUTSIDE a marker — not by its styling (the
 *      `.verdict` class) and not by its words.
 *
 * (1) alone is gameable: drop the marker and the verdict stops needing a
 * mutation. (2) is what closes that door, and it is what catches a careless
 * builder pasting a raw banner in six months.
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

export interface UnmarkedVerdict {
  readonly reason: 'styling' | 'words';
  readonly text: string;
  readonly html: string;
  readonly where: string;
}

/** Every marker id currently rendered on the page, deduplicated and sorted. */
export async function renderedMarkers(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      new Set(
        Array.from(document.querySelectorAll<HTMLElement>('[data-verdict]')).map(
          (element) => element.dataset.verdict ?? '',
        ),
      ),
    )
      .filter(Boolean)
      .sort(),
  );
}

/**
 * Verdicts rendered outside any marker, by styling or by words.
 *
 * The word scan reads each element's OWN direct text nodes rather than its
 * `textContent`, so an ancestor is never blamed for what a descendant says and
 * a bare `<div>REJECTED</div>` is still caught.
 */
export async function unmarkedVerdicts(page: Page): Promise<UnmarkedVerdict[]> {
  return page.evaluate((words) => {
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
    const ownText = (element: Element): string =>
      Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .trim();

    const findings: {
      reason: 'styling' | 'words';
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
    return findings;
  }, VERDICT_WORDS);
}

export function formatUnmarked(findings: UnmarkedVerdict[]): string {
  return findings
    .map(
      (finding, index) =>
        `  ${index + 1}. [${finding.reason}] ${finding.where}\n     ${finding.text}\n     ${finding.html}`,
    )
    .join('\n');
}
