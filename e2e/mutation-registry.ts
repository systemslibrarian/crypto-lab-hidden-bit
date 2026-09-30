import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * One reading of `mutations/registry.json`, shared by everything that judges it:
 * the coverage tests in `verdicts.spec.ts`, the in-test pin check in
 * `verdict-audit.ts`, and the runtime-pair check in `global-teardown.ts`.
 *
 * Shared rather than parsed three times because a record's shape is exactly the
 * kind of thing that drifts when three files each keep their own idea of it,
 * and a checker reading a field the writer stopped emitting is the silent-clean
 * failure this whole lane is about.
 */
export interface MutationRecord {
  readonly marker: string;
  readonly id: string;
  readonly family?: 'verdict' | 'claim';
  readonly spec: string;
  readonly grep: string;
  readonly rendersOnlyUnderMutation?: boolean;
  /**
   * The expectations the killing test MUST pass to `expectVerdict` for this
   * marker — every one of them, and nothing else.
   *
   * This is what closes escape 2. A pair-only rule records that the helper ran;
   * it cannot tell a real expectation from one the test read off the page a
   * line earlier, because both execute. Pinning the expected text and state
   * here means the argument has to come from somewhere other than the marker
   * under test: under the recorded mutation a page-derived argument becomes the
   * MUTATED text, stops matching this pin, and the helper fails inside the
   * marker's own test — which is where a kill has to land.
   *
   * Verdict records only. A `data-claim` oracle's expectation is a value
   * recomputed from the run (a Wilson interval, an exact collision
   * probability), not a literal, so there is nothing honest to pin; see the
   * limit stated in README.md.
   */
  readonly asserts?: readonly { readonly text: string; readonly state: string }[];
}

export interface Registry {
  readonly port: number;
  readonly mutations: readonly MutationRecord[];
}

export const REGISTRY = JSON.parse(
  readFileSync(fileURLToPath(new URL('../mutations/registry.json', import.meta.url)), 'utf8'),
) as Registry;

export function family(entry: MutationRecord): 'verdict' | 'claim' {
  return entry.family ?? 'verdict';
}

/** The shared helper a record's killing test has to go through. */
export function requiredHelper(entry: MutationRecord): 'expectVerdict' | 'expectNoVerdict' | 'readClaim' {
  if (family(entry) === 'claim') return 'readClaim';
  return entry.rendersOnlyUnderMutation ? 'expectNoVerdict' : 'expectVerdict';
}

/** Does this record name this test? Same rule the mutation runner's --grep uses. */
export function recordNames(entry: MutationRecord, spec: string, title: string): boolean {
  return spec === entry.spec && title.includes(entry.grep);
}
