/* The parameters the switching curve's claims are measured at, in one place.
 *
 * Two specs drive that exhibit: `verdicts.spec.ts` binds each row to its own run,
 * and `claims.spec.ts` checks each row's bound against the birthday formula. They
 * are different questions about the same rendered table, and they have to ask them
 * of the same curve — on 2026-09-22 they did not, one running q = 32 at 2,000
 * trials and the other q = 20 at 200, which is how a tolerance wide enough to admit
 * nearly anything survived in the second while the first was being tightened.
 *
 * Why these values, from the measurement rather than from taste: at 200 trials the
 * rendered tolerance is 0.381 — wider than the whole 0.004–0.380 spread the curve
 * covers at n = 8 — so every row sits inside every other row's tolerance and a
 * replicated curve is indistinguishable by construction, whatever the oracle says.
 * At 2,000 the width is 0.121 against sampling noise of about 0.022: five standard
 * deviations of headroom for an honest run, and far too narrow for a row copied
 * from a different q. q = 32 rather than 16 so that two rows carry that separation
 * rather than one.
 *
 * Changing a value here changes both specs together, which is the point.
 */
export const SWITCHING_BITS = '8';
export const SWITCHING_QUERIES = '32';
export const SWITCHING_TRIALS = 2_000;
