import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D6 — a mention is not an assertion, one level down.
 *
 * The rule this file exists to serve used to be a SOURCE-TEXT scan: the
 * coverage test read verdicts.spec.ts and required the string
 * `expectVerdict(page, '<id>'` to appear inside the body of the test a mutation
 * record names. That enforces a MENTION, and three independent auditors
 * defeated it three different ways across this lane's eight labs:
 *
 *   1. comment the call out — the text survives inside the comment, the
 *      assertion does not, and a live state flip ships green;
 *   2. keep the call and make it tautological — feed it values read off the
 *      page in the same test, so it compares the page with itself;
 *   3. satisfy it from elsewhere in the file — the scan is body-granular at
 *      best and file-granular at worst, so an unrelated call keeps it green
 *      while the killing assertion is rewritten away.
 *
 * All three are the same defect the rest of this lane's brief is about: a
 * denominator taken from what the source SAYS ran rather than from what DID
 * run. So the shared marker helpers now write down the `(test title, marker)`
 * pair at the moment they execute, and `e2e/global-teardown.ts` reads those
 * back after the whole run and fails it if a recorded mutation's pair is
 * missing.
 *
 * Why a FILE and not a module-level Set: Playwright runs tests in separate
 * worker processes, so a Set in this module aggregates one worker's view and
 * silently under-reports every other worker's. A run-scoped append-only sink is
 * the only shape that survives the process boundary.
 *
 * Why it cannot be satisfied by a stale file: the sink lives under
 * `test-results/`, which Playwright deletes before `globalSetup` runs (verified,
 * not assumed), and `globalSetup` then truncates it again. Both have to fail
 * for yesterday's observations to answer today's question.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Run-scoped, append-only, one JSON object per line. */
export const SINK = fileURLToPath(new URL('../test-results/marker-observations.ndjson', import.meta.url));

export interface Observation {
  /** `ran` — a test finished. `asserted` — a marker helper executed. */
  readonly kind: 'ran' | 'asserted';
  /** The test's title, exactly as Playwright reports it. */
  readonly test: string;
  /** Its spec file, relative to the repo root. */
  readonly spec: string;
  /**
   * Playwright's retry index. A retried test appends a second, independent
   * sequence of lines; without this the two would be read as one test calling
   * the helper twice as often, which is the difference between a pinned
   * sequence matching and not.
   */
  readonly attempt: number;
  /** `ran` only: the outcome Playwright recorded for the test. */
  readonly status?: string;
  /** `asserted` only: which shared helper ran. */
  readonly helper?: 'expectVerdict' | 'expectNoVerdict' | 'readClaim';
  /** `asserted` only: the marker id the helper was called with. */
  readonly marker?: string;
  /** `asserted` only: which call this was, for this marker, in this attempt. */
  readonly index?: number;
  /** `asserted` only: the expectation the CALLER passed, for expectVerdict. */
  readonly text?: string;
  readonly state?: string;
}

export function specPath(file: string): string {
  return relative(ROOT, file).split('\\').join('/');
}

export function resetSink(): void {
  mkdirSync(dirname(SINK), { recursive: true });
  writeFileSync(SINK, '');
}

export function record(entry: Observation): void {
  mkdirSync(dirname(SINK), { recursive: true });
  appendFileSync(SINK, `${JSON.stringify(entry)}\n`);
}

export function readSink(): Observation[] | null {
  if (!existsSync(SINK)) return null;
  return readFileSync(SINK, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Observation);
}

/**
 * This module deliberately imports NOTHING from `@playwright/test`. It is read
 * by `global-teardown.ts`, which runs in the main process where a
 * `test.afterEach(...)` at module scope would throw. The hook that records
 * which tests ran lives in `verdict-audit.ts` instead — a module only ever
 * loaded by a spec file.
 */
