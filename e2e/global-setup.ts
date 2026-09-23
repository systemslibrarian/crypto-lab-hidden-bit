import { resetSink } from './observations';

/**
 * Clear the runtime-observation sink before anything runs, so a file left by an
 * earlier run cannot answer this run's coverage question.
 *
 * Playwright already deletes `test-results/` before this hook runs — verified
 * on this repo's pinned version rather than assumed — so this is the second of
 * two independent clearings. Both have to fail for a stale observation to be
 * counted, and the teardown treats a MISSING sink as a failure rather than as
 * nothing to check, because "the file the checker reads was not there" is the
 * one state that would otherwise make every rule below silently vacuous.
 */
export default async function globalSetup(): Promise<void> {
  resetSink();
}
