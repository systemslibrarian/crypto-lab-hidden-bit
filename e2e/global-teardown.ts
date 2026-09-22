import type { FullConfig } from '@playwright/test';
import { REGISTRY, family, recordNames, requiredHelper, type MutationRecord } from './mutation-registry';
import { SINK, readSink } from './observations';

/**
 * D6 — the coverage rule asks what RAN, not what the source says ran.
 *
 * Every shared marker helper writes its `(test title, marker id)` pair to a
 * run-scoped sink at the moment it executes. This hook reads those back after
 * the last test and fails the run when a mutation record's pair is missing from
 * them. It runs in the main process, after every worker has finished, so the
 * ordering is guaranteed rather than incidental, and a throw here fails the
 * run — verified on this repo's pinned Playwright, not assumed.
 *
 * ── What it enforces, and the scope each rule is honest about ──────────────
 *
 * S1  The sink exists. A missing sink means globalSetup did not run, which
 *     means every rule below would pass over nothing. That is the
 *     checker-that-could-not-see shape, so it is a failure, not a skip.
 *
 * S2  For every mutation record whose killing test RAN AND PASSED in this run,
 *     that test executed the record's required helper on the record's marker.
 *     This is the rule that replaces the source-text scan: a commented-out call
 *     leaves text but no line here, and a call in a DIFFERENT test of the same
 *     file produces a line under a different title.
 *
 * S3  Where the record pins `asserts`, the `(text, state)` pairs that test
 *     passed to `expectVerdict` are exactly the pinned ones, IN ORDER. See
 *     mutation-registry.ts for why the pin is what closes the tautological call
 *     that S2 alone cannot see, and why order rather than membership.
 *
 * S4  On an UNFILTERED run of a spec file, every record naming that file ran at
 *     all. Without this, deleting a killing test outright would leave nothing
 *     to observe and nothing to complain — the denominator quietly shrinking,
 *     which is the defect one layer down from the one S2 fixes.
 *
 * ── Why the scoping in S2 and S4 is not a loophole ────────────────────────
 *
 * mutations/run.mjs runs ONE test at a time through `--grep`, and the runs that
 * matter most are the ones where that test FAILS, because that is what a kill
 * is. A rule that demanded all 27 records on every invocation would fail every
 * mutation run and every single-test debugging run, and would be switched off
 * within a day. So a record is judged only when its own test ran; and when a
 * whole spec file ran unfiltered, S4 requires all of that file's records to
 * have run. `npm run test:verdicts` therefore judges verdicts.spec.ts in full,
 * and `npm run test:a11y` judges both spec files in full.
 */

interface Ran {
  readonly test: string;
  readonly spec: string;
  readonly attempt: number;
  readonly status: string;
}

/**
 * Was this run narrowed to a subset of the tests in the files it loaded?
 *
 * S4 is the only rule that needs to know, and it needs to know for one reason:
 * mutations/run.mjs drives ONE test at a time through `--grep`, and a rule that
 * demanded every record's test on every invocation would fail every mutation
 * run and be switched off within a day.
 *
 * `config.grep` is NOT the answer, and the way it is wrong matters: on this
 * repo's pinned Playwright, `--grep "..."` leaves `config.grep` at its default
 * `/.*` /` and applies the filter as a CLI-level test filter instead. Reading it
 * reported every `--grep`'d run as unfiltered — S4 then fired on all nineteen
 * records whose test that run never asked for. `config.argv` carries the real
 * command line, so that is what is read, with `config.grep` still honoured for
 * a grep set programmatically in the config file.
 *
 * When argv is unavailable the answer is NOT FILTERED — deliberately the strict
 * side. A future Playwright that stops exposing it makes the mutation runs go
 * red and say why; the other default would make S4 silently vacuous on every
 * run, which is the failure shape this whole file exists to refuse.
 */
function isFiltered(config: FullConfig | undefined): boolean {
  const grep = config?.grep;
  const sources = Array.isArray(grep) ? grep.map((one) => one.source) : grep ? [grep.source] : [];
  if (sources.some((source) => source !== '.*' && source !== '')) return true;

  const argv = (config as { argv?: unknown } | undefined)?.argv;
  if (!Array.isArray(argv)) return false;
  const flags = ['-g', '--grep', '--grep-invert', '--gi', '--shard', '--last-failed', '--only-changed'];
  return argv
    .slice(2)
    .map(String)
    .some((arg) => flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)) || /:\d+$/.test(arg));
}

function describe(entry: MutationRecord): string {
  return `${entry.id} (marker "${entry.marker}", ${family(entry)}, ${entry.spec} › "${entry.grep}")`;
}

export default async function globalTeardown(config?: FullConfig): Promise<void> {
  const observations = readSink();
  if (observations === null) {
    throw new Error(
      `runtime marker coverage: the observation sink ${SINK} does not exist, so nothing about this run was ` +
        'checked. globalSetup is what creates it; a config that no longer names it disables every rule in ' +
        'e2e/global-teardown.ts without failing anything.',
    );
  }

  const ran: Ran[] = observations
    .filter((entry) => entry.kind === 'ran')
    .map((entry) => ({
      test: entry.test,
      spec: entry.spec,
      attempt: entry.attempt ?? 0,
      status: entry.status ?? 'unknown',
    }));
  const asserted = observations.filter((entry) => entry.kind === 'asserted');
  const specsThatRan = new Set(ran.map((entry) => entry.spec));
  const filtered = isFiltered(config);

  const failures: string[] = [];

  for (const entry of REGISTRY.mutations) {
    const matches = ran.filter((one) => recordNames(entry, one.spec, one.test));

    if (matches.length === 0) {
      // S4 — an unfiltered run of the record's own spec file must have run it.
      if (!filtered && specsThatRan.has(entry.spec)) {
        failures.push(
          `${describe(entry)}: ${entry.spec} ran in full and no test whose title contains "${entry.grep}" ran ` +
            'with it. A recorded mutation whose killing test no longer exists is covered by nothing.',
        );
      }
      continue;
    }

    // A test that failed is already red; its helper may legitimately not have
    // been reached. Judging it again here would turn every mutation run into
    // two failures and make the kill harder to attribute, not easier.
    const passed = matches.filter((one) => one.status === 'passed');
    if (passed.length === 0) continue;

    const helper = requiredHelper(entry);
    for (const { test: title, attempt } of passed) {
      const calls = asserted
        .filter(
          (one) =>
            one.test === title &&
            one.spec === entry.spec &&
            (one.attempt ?? 0) === attempt &&
            one.marker === entry.marker &&
            one.helper === helper,
        )
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      // S2 — the pair, observed at runtime.
      if (calls.length === 0) {
        failures.push(
          `${describe(entry)}: "${title}" passed without ever executing ${helper}(page, '${entry.marker}'). ` +
            'Its recorded kill was validated by something that did not run: the call is commented out, renamed, ' +
            'or lives in another test of the same file.',
        );
        continue;
      }

      // S3 — the pinned expectations, in ORDER. The order is what a set
      // comparison misses: a tautological test under a branch-swapping mutation
      // hands back the same pairs the other way round.
      if (entry.asserts === undefined) continue;
      const observed = JSON.stringify(calls.map((one) => [one.text ?? '', one.state ?? '']));
      const expected = JSON.stringify(entry.asserts.map((one) => [one.text, one.state]));
      if (observed !== expected) {
        failures.push(
          `${describe(entry)}: "${title}" passed ${observed} to expectVerdict, but the record pins ${expected}. ` +
            'Each pinned pair is a branch the killing test is recorded as covering, in the order it covers them; ' +
            're-pin the record if that changed on purpose, because an unpinned expectation is how a page-derived, ' +
            'tautological one arrives.',
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `runtime marker coverage failed for ${failures.length} recorded mutation(s):\n  - ${failures.join('\n  - ')}\n` +
        '\nThese are RUNTIME observations, not a scan of spec source. A mention of a helper call cannot satisfy ' +
        'them; only executing it can.',
    );
  }
}
