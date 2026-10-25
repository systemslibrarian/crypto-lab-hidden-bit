import {
  AES_HYBRID_IDS,
  createAesHybridLedger,
  type HybridContribution,
  type HybridId,
} from '../proofs/hybridLedger';
import {
  LazyIdealPermutation128,
  LazyRandomFunction128,
  MemoizedAes128Oracle,
  type ByteOracle128,
} from '../proofs/oracles';
import {
  bitVectorKey,
  evaluateExposedFunction,
  exposedFirstBit,
  innerProductMod2,
  type Bit,
  type BitVector,
} from '../proofs/hardcore';
import {
  reconstructGoldreichLevin,
  type GoldreichLevinResult,
} from '../proofs/goldreichLevin';
import { escapeHtml, query } from './dom';
import { hydrateIcons } from './icons';

const DIMENSION = 8;
const SECRET_X = Uint8Array.of(1, 0, 1, 1, 0, 1, 1, 0);
const EASY_R = Uint8Array.of(1, 0, 0, 1, 1, 0, 1, 0);
const AES_KEY = Uint8Array.from({ length: 16 }, (_, index) => index);
const AES_INPUT_A = Uint8Array.of(
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
);
const AES_INPUT_B = AES_INPUT_A.map((byte, index) => index === 15 ? byte ^ 1 : byte);
const HASH_DOMAIN = new TextEncoder().encode('crypto-lab-hidden-bit:E-K-04:bounded-sha256:v1');

function markup(): string {
  return `
    <div class="experiment-header">
      <div>
        <p class="section-index">HYBRIDS · HARD-CORE PREDICATES · VERIFIED RECONSTRUCTION</p>
        <h2>Move one game at a time</h2>
        <p>Walk from real AES-128 to an ideal random function through adjacent games, then see why one-wayness alone can expose an input bit and why Goldreich–Levin identifies the different predicate ⟨x,r⟩ as hard-core under its theorem assumptions. The theorem does not make r₀ hidden.</p>
      </div>
      <span class="experiment-number">EXHIBIT 07</span>
    </div>

    <section class="proof-act" aria-labelledby="hybrid-act-title">
      <div class="proof-act-heading">
        <div><p class="section-index">ACT A · ADJACENT HYBRIDS</p><h3 id="hybrid-act-title">Account for every change</h3></div>
        <p>Exact rewrites contribute zero. Replacing AES by an ideal permutation contributes a symbolic PRP term. Removing collision rejection contributes a bounded bad event for q distinct inputs.</p>
      </div>
      <div class="control-deck proof-controls">
        <div class="field">
          <label for="hybrid-queries">Distinct oracle inputs q</label>
          <input id="hybrid-queries" type="number" min="2" max="4096" step="1" value="48" inputmode="numeric" />
          <span class="field-hint">Repeated calls do not create new birthday opportunities.</span>
        </div>
        <div class="button-row">
          <button id="hybrid-next" class="action-btn primary" type="button"><i data-lucide="step-forward"></i>Advance one hop</button>
          <button id="hybrid-reset" class="action-btn" type="button"><i data-lucide="rotate-ccw"></i>Reset to H0</button>
          <button id="hybrid-oracle-run" class="action-btn" type="button"><i data-lucide="flask-conical"></i>Run oracle checks</button>
        </div>
      </div>
      <p id="hybrid-status" class="retirement-note" role="status" aria-live="polite">The ledger starts at H0. Advance only to the next adjacent game.</p>
      <div class="proof-grid">
        <div id="hybrid-ledger" class="result-block" data-claim="hybrid-ledger"></div>
        <div id="hybrid-oracles" class="result-block" data-claim="hybrid-oracles">
          <h3>Executable oracle boundary</h3>
          <p>Run the checks to compare real AES with lazy ideal-oracle caching and a deterministic forced-collision policy fixture.</p>
        </div>
      </div>
      <div id="hybrid-proof-verdict" class="verdict" data-verdict="hybrid-proof" data-tone="neutral" role="status" aria-live="polite"></div>
    </section>

    <section class="proof-act" aria-labelledby="predicate-act-title">
      <div class="proof-act-heading">
        <div><p class="section-index">ACT B · ONE-WAY DOES NOT MEAN EVERY BIT IS HIDDEN</p><h3 id="predicate-act-title">Publish an easy predicate</h3></div>
        <p>Conditionally, if f is one-way then F(x,r) = (f(x),r) remains one-way. Yet the input predicate r₀ is copied into the public output and is predicted perfectly without inverting f.</p>
      </div>
      <div id="easy-predicate" class="result-block" data-claim="easy-predicate">
        <h3>Bounded fixture initializing</h3><p>Computing the domain-separated image and the public predicate check.</p>
      </div>
    </section>

    <section class="proof-act" aria-labelledby="hardcore-act-title">
      <div class="proof-act-heading">
        <div><p class="section-index">ACT C · GOLDREICH–LEVIN</p><h3 id="hardcore-act-title">Turn biased prediction into a verified preimage list</h3></div>
        <p>The public value is G(x,r) = (f(x),r), while the candidate bit is ⟨x,r⟩ mod 2. A stipulated predictor is wrong only on the all-zero r, so its exact finite success probability and advantage can be audited before the reconstruction runs.</p>
      </div>
      <div class="proof-actions">
        <button id="hardcore-run" class="action-btn primary" type="button" disabled><i data-lucide="play"></i>Draw uniform samples and reconstruct</button>
        <p id="hardcore-status" role="status" aria-live="polite">Waiting for the bounded public image.</p>
      </div>
      <div id="hardcore-recovery" class="result-block" data-claim="hardcore-recovery">
        <h3>Rackoff-style bounded reconstruction</h3>
        <p>For each guessed σ vector and nonempty subset S, form s<sub>S</sub> and σ<sub>S</sub>, then vote v<sub>i,S</sub> = P(y, s<sub>S</sub> ⊕ e<sub>i</sub>) ⊕ σ<sub>S</sub>. A majority reconstructs each candidate bit.</p>
        <p>Distinct nonempty subset XORs are pairwise independent; ℓ = ⌈log₂(n/ε² + 1)⌉ makes 2<sup>ℓ</sup> − 1 ≥ n/ε² for the majority and union-bound argument.</p>
      </div>
      <div id="hardcore-proof-verdict" class="verdict" data-verdict="hardcore-proof" data-tone="neutral" role="status" aria-live="polite">
        <i data-lucide="circle-dot"></i><div><strong>READY AFTER HASH SETUP</strong><p>The decoder will receive only y, predictor access and an independent preimage verifier—not x.</p></div>
      </div>
    </section>

    <details class="guard-rails">
      <summary>Proof and teaching boundaries</summary>
      <div class="guard-grid">
        <p><strong>Symbolic assumption:</strong> no sample assigns a measured number to AES PRP security.</p>
        <p><strong>Randomness:</strong> the theorem samples uniform bit vectors; reconstruction has legitimate failure probability.</p>
        <p><strong>Bounded fixture:</strong> eight-bit inputs are exhaustible and do not instantiate an asymptotic one-way function.</p>
        <p><strong>Security parameter:</strong> the theorem concerns a family f<sub>n</sub> that is one-way against probabilistic polynomial-time algorithms and a predictor with non-negligible advantage in n; this n = 8 fixture establishes neither premise.</p>
        <p><strong>Predictor premise:</strong> the artificial oracle is stipulated for one fixed x and ignores y. Its exact bias is exhaustively audited here, not learned from samples or claimed as a SHA-256 attack.</p>
        <p><strong>List recovery:</strong> candidates are deduplicated and checked with f(candidate) = y; uniqueness is not assumed.</p>
        <p><strong>Fixed versus average x:</strong> this run reconstructs one fixed fixture; the theorem's reduction also averages over random x.</p>
        <p><strong>Work caps:</strong> the browser limits dimension, subset XORs and votes for teaching; those are not theorem limits.</p>
      </div>
    </details>
    <details class="sources">
      <summary>Primary proof sources</summary>
      <p>Goldreich and Levin, <a href="https://www.wisdom.weizmann.ac.il/~/oded/gl.html">A Hard-Core Predicate for all One-Way Functions</a>; Goldreich, <a href="https://www.wisdom.weizmann.ac.il/~oded/PDF/mcppp-v2.pdf">Appendix C.2 and the Rackoff-style reconstruction</a>; Bellare and Rogaway, <a href="https://eprint.iacr.org/2004/331">code-based game playing</a>; Shoup, <a href="https://eprint.iacr.org/2004/332">Sequences of Games</a>; and Rosulek, <a href="https://joyofcryptography.com/provsec/#sec.three-hop">the adjacent three-hop maneuver</a>.</p>
    </details>`;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  crypto.getRandomValues(output);
  return output;
}

function randomBits(length: number): BitVector {
  return randomBytes(length).map((byte) => byte & 1);
}

function bitsFromInteger(value: number): BitVector {
  return Uint8Array.from({ length: DIMENSION }, (_, index) => (value >>> (DIMENSION - index - 1)) & 1);
}

async function boundedSha256(bits: BitVector): Promise<string> {
  const payload = new Uint8Array(HASH_DOMAIN.length + 2 + bits.length);
  payload.set(HASH_DOMAIN);
  payload[HASH_DOMAIN.length] = (bits.length >>> 8) & 0xff;
  payload[HASH_DOMAIN.length + 1] = bits.length & 0xff;
  payload.set(bits, HASH_DOMAIN.length + 2);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)));
}

function contributionText(contribution: HybridContribution): string {
  if (contribution.type === 'zero') return contribution.expression;
  if (contribution.type === 'symbolic-assumption') return contribution.symbol;
  return contribution.expression;
}

function runOracle(oracle: ByteOracle128): {
  readonly output: Uint8Array;
  readonly repeatStable: boolean;
  readonly cloneSafe: boolean;
  readonly distinct: number;
} {
  const output = oracle.query(AES_INPUT_A);
  const repeated = oracle.query(AES_INPUT_A);
  const repeatStable = sameBytes(output, repeated);
  output[0] = output[0]! ^ 0xff;
  const afterCallerMutation = oracle.query(AES_INPUT_A);
  const cloneSafe = sameBytes(repeated, afterCallerMutation);
  oracle.query(AES_INPUT_B);
  return { output: afterCallerMutation, repeatStable, cloneSafe, distinct: oracle.distinctQueryCount };
}

function queuedBlocks(blocks: readonly Uint8Array[]): {
  readonly source: (length: number) => Uint8Array;
  readonly draws: () => number;
} {
  let index = 0;
  return {
    source: (length) => {
      if (length !== 16) throw new Error('The forced-collision fixture serves 128-bit blocks only.');
      const block = blocks[index];
      if (block === undefined) throw new Error('The forced-collision fixture exhausted its queue.');
      index += 1;
      return block.slice();
    },
    draws: () => index,
  };
}

function runForcedCollisionBoundary(): {
  readonly functionCollides: boolean;
  readonly functionDraws: number;
  readonly permutationRejects: boolean;
  readonly permutationDraws: number;
} {
  const collision = new Uint8Array(16).fill(0x44);
  const unused = new Uint8Array(16).fill(0x55);
  const functionQueue = queuedBlocks([collision, collision]);
  const permutationQueue = queuedBlocks([collision, collision, unused]);
  const fn = new LazyRandomFunction128(functionQueue.source);
  const permutation = new LazyIdealPermutation128(permutationQueue.source);
  const functionCollides = sameBytes(fn.query(AES_INPUT_A), fn.query(AES_INPUT_B));
  const permutationRejects = !sameBytes(permutation.query(AES_INPUT_A), permutation.query(AES_INPUT_B));
  return {
    functionCollides,
    functionDraws: functionQueue.draws(),
    permutationRejects,
    permutationDraws: permutationQueue.draws(),
  };
}

function stipulatedPredictor(r: BitVector): Bit {
  const truth = innerProductMod2(SECRET_X, r);
  const allZero = r.every((bit) => bit === 0);
  return allZero ? (truth ^ 1) as Bit : truth;
}

export async function initHybridProof(): Promise<void> {
  const panel = query<HTMLElement>('#panel-hybrid-proof');
  panel.innerHTML = markup();
  hydrateIcons(panel);

  const queryInput = query<HTMLInputElement>('#hybrid-queries', panel);
  const nextButton = query<HTMLButtonElement>('#hybrid-next', panel);
  const resetButton = query<HTMLButtonElement>('#hybrid-reset', panel);
  const oracleButton = query<HTMLButtonElement>('#hybrid-oracle-run', panel);
  const ledgerElement = query<HTMLElement>('#hybrid-ledger', panel);
  const oracleElement = query<HTMLElement>('#hybrid-oracles', panel);
  const hybridStatus = query<HTMLElement>('#hybrid-status', panel);
  const hybridVerdict = query<HTMLElement>('#hybrid-proof-verdict', panel);
  const easyElement = query<HTMLElement>('#easy-predicate', panel);
  const recoveryElement = query<HTMLElement>('#hardcore-recovery', panel);
  const recoveryVerdict = query<HTMLElement>('#hardcore-proof-verdict', panel);
  const recoveryStatus = query<HTMLElement>('#hardcore-status', panel);
  const recoveryButton = query<HTMLButtonElement>('#hardcore-run', panel);
  let hybridIndex = 0;
  let publicImage = '';

  const queryCount = (): number => {
    const value = Number(queryInput.value);
    if (!Number.isSafeInteger(value) || value < 2 || value > 4_096) {
      throw new Error('q must be an integer from 2 through 4,096.');
    }
    return value;
  };

  const renderLedger = (): void => {
    try {
      const through = AES_HYBRID_IDS[hybridIndex] as HybridId;
      const ledger = createAesHybridLedger(queryCount(), through);
      const rows = ledger.transitions.map((transition, index) => {
        const node = ledger.nodes[index + 1]!;
        const kind = transition.kind === 'exact'
          ? 'exact rewrite'
          : transition.kind === 'assumption'
            ? 'computational assumption'
            : 'identical until bad';
        return `<li class="hybrid-step" data-kind="${transition.kind}" data-from="${transition.from}" data-to="${transition.to}">
          <div><span>${transition.from} → ${transition.to}</span><strong>${escapeHtml(transition.title)}</strong></div>
          <p>${escapeHtml(transition.change)}</p>
          <dl><div><dt>Class</dt><dd>${kind}</dd></div><div><dt>Bound term</dt><dd data-field="hybrid-term">${escapeHtml(contributionText(transition.contribution))}</dd></div></dl>
          <small>${escapeHtml(node.oracle)} ${escapeHtml(transition.justification)}</small>
        </li>`;
      }).join('');
      ledgerElement.dataset.value = ledger.cumulative.expression;
      ledgerElement.innerHTML = `<h3>Guided ledger through ${ledger.through}</h3>
        <p>Start at H0: ${escapeHtml(ledger.nodes[0]!.oracle)}</p>
        <ol class="hybrid-list">${rows || '<li class="hybrid-step is-current"><strong>H0 · direct AES-128</strong><p>No hop has been taken.</p></li>'}</ol>
        <dl class="value-list">
          <div class="value-row"><dt>Distinct inputs q</dt><dd data-field="hybrid-q">${ledger.queries}</dd></div>
          <div class="value-row"><dt>Current endpoint</dt><dd data-field="hybrid-through">${ledger.through}</dd></div>
          <div class="value-row"><dt>Cumulative bound</dt><dd data-field="hybrid-bound">${escapeHtml(ledger.cumulative.expression)}</dd></div>
        </dl>`;

      const complete = ledger.through === 'H5';
      nextButton.disabled = complete;
      hybridVerdict.dataset.tone = complete ? 'pass' : 'neutral';
      hybridVerdict.innerHTML = complete
        ? '<i data-lucide="check-circle-2"></i><div><strong>ALL FIVE ADJACENT HOPS CLASSIFIED</strong><p>The cumulative expression contains one symbolic AES-PRP term and the 128-bit switching bad-event ceiling.</p></div>'
        : `<i data-lucide="circle-dot"></i><div><strong>${hybridIndex === 0 ? 'START AT H0' : 'ADJACENT PATH IN PROGRESS'}</strong><p>Only the next canonical hop is available; endpoint jumps are not accepted.</p></div>`;
      hydrateIcons(hybridVerdict);
    } catch (error) {
      nextButton.disabled = true;
      ledgerElement.dataset.value = '';
      ledgerElement.innerHTML = '<h3>Guided ledger</h3><p>Choose a valid distinct-query count.</p>';
      hybridVerdict.dataset.tone = 'warning';
      hybridVerdict.innerHTML = '<i data-lucide="shield-alert"></i><div><strong>INPUT REFUSED</strong><p>The proof ledger was not advanced.</p></div>';
      hybridStatus.textContent = error instanceof Error ? error.message : 'Invalid query count.';
      hydrateIcons(hybridVerdict);
    }
  };

  nextButton.addEventListener('click', () => {
    if (hybridIndex < AES_HYBRID_IDS.length - 1) hybridIndex += 1;
    hybridStatus.textContent = hybridIndex === AES_HYBRID_IDS.length - 1
      ? 'All adjacent hops are now visible.'
      : `Advanced to ${AES_HYBRID_IDS[hybridIndex]}; the next button still moves only one game.`;
    renderLedger();
  });
  resetButton.addEventListener('click', () => {
    hybridIndex = 0;
    hybridStatus.textContent = 'Ledger reset to H0.';
    renderLedger();
  });
  queryInput.addEventListener('input', () => {
    hybridIndex = 0;
    hybridStatus.textContent = 'Changing q retired the previous bound and reset the path to H0.';
    renderLedger();
  });

  oracleButton.addEventListener('click', () => {
    const results = [
      { id: 'aes', label: 'Real memoized AES-128', result: runOracle(new MemoizedAes128Oracle(AES_KEY)) },
      { id: 'permutation', label: 'Lazy ideal permutation', result: runOracle(new LazyIdealPermutation128(randomBytes)) },
      { id: 'function', label: 'Lazy random function', result: runOracle(new LazyRandomFunction128(randomBytes)) },
    ];
    const forced = runForcedCollisionBoundary();
    const allStable = results.every(({ result }) =>
      result.repeatStable && result.cloneSafe && result.distinct === 2)
      && forced.functionCollides && forced.functionDraws === 2
      && forced.permutationRejects && forced.permutationDraws === 3;
    oracleElement.dataset.value = String(allStable);
    oracleElement.innerHTML = `<h3>Executable oracle boundary</h3>
      <dl class="value-list">
        <div class="value-row"><dt>AES key</dt><dd data-field="oracle-key">${toHex(AES_KEY)}</dd></div>
        <div class="value-row"><dt>First input</dt><dd data-field="oracle-input">${toHex(AES_INPUT_A)}</dd></div>
      </dl>
      <div class="table-scroll" role="region" aria-label="Oracle cache checks" tabindex="0"><table>
        <thead><tr><th>Oracle</th><th>First output</th><th>Repeat stable</th><th>Caller-mutation safe</th><th>Distinct inputs</th></tr></thead>
        <tbody>${results.map(({ id, label, result }) => `<tr data-oracle="${id}"><td>${label}</td><td data-field="output">${toHex(result.output)}</td><td data-field="repeat">${result.repeatStable ? 'yes' : 'no'}</td><td data-field="clone">${result.cloneSafe ? 'yes' : 'no'}</td><td data-field="distinct">${result.distinct}</td></tr>`).join('')}</tbody>
      </table></div>
      <dl class="value-list" data-field="forced-collision">
        <div class="value-row"><dt>Forced random-function collision</dt><dd data-field="function-collision">${forced.functionCollides ? `allowed after ${forced.functionDraws} draws` : 'not observed'}</dd></div>
        <div class="value-row"><dt>Forced permutation collision</dt><dd data-field="permutation-collision">${forced.permutationRejects ? `rejected; unused block accepted after ${forced.permutationDraws} draws` : 'not rejected'}</dd></div>
      </dl>
      <p>The forced-collision queue is a deterministic policy check, not a sample from either ideal distribution.</p>
      <p data-field="oracle-summary">${allStable ? 'All three oracles memoized repeats, protected their caches and counted two distinct inputs; the forced collision was allowed by the function and rejected by the permutation.' : 'At least one oracle violated its declared cache or collision boundary.'}</p>`;
    hybridStatus.textContent = 'Fresh real-AES and ideal-oracle checks complete.';
  });

  renderLedger();

  try {
    const exposed = evaluateExposedFunction(boundedSha256, SECRET_X, EASY_R);
    publicImage = await exposed.image;
    const predicted = exposedFirstBit(exposed);
    let exposedChecks = 0;
    for (let value = 0; value < 2 ** DIMENSION; value += 1) {
      const r = bitsFromInteger(value);
      const candidate = evaluateExposedFunction(() => publicImage, SECRET_X, r);
      if (exposedFirstBit(candidate) === r[0]) exposedChecks += 1;
    }
    easyElement.dataset.value = String(predicted);
    easyElement.innerHTML = `<h3>F(x,r) publishes r beside f(x)</h3>
      <dl class="value-list">
        <div class="value-row"><dt>Domain-separated bounded f(x)</dt><dd data-field="easy-image">${publicImage}</dd></div>
        <div class="value-row"><dt>Public r</dt><dd data-field="easy-r">${bitVectorKey(exposed.r)}</dd></div>
        <div class="value-row"><dt>Predicate r₀</dt><dd data-field="easy-predicate-bit">${exposed.r[0]}</dd></div>
        <div class="value-row"><dt>Public predictor</dt><dd data-field="easy-prediction">${predicted}</dd></div>
        <div class="value-row"><dt>Complete bounded audit</dt><dd data-field="easy-checks">${exposedChecks} / ${2 ** DIMENSION}</dd></div>
      </dl>
      <p>If f is one-way, exposing independent r does not reveal x—but it does reveal this input predicate. The eight-bit SHA-256 fixture is exhaustible and is not evidence that f is one-way.</p>`;
    recoveryButton.disabled = false;
    recoveryStatus.textContent = 'The bounded public image is ready.';
    hydrateIcons(recoveryVerdict);
  } catch (error) {
    easyElement.innerHTML = '<h3>Bounded fixture unavailable</h3><p>The browser hash operation did not complete.</p>';
    recoveryStatus.textContent = error instanceof Error ? error.message : 'Hash setup failed.';
  }

  recoveryButton.addEventListener('click', async () => {
    recoveryButton.disabled = true;
    recoveryStatus.textContent = 'Sampling and reconstructing candidates...';
    try {
      let predictorCorrect = 0;
      for (let value = 0; value < 2 ** DIMENSION; value += 1) {
        const r = bitsFromInteger(value);
        if (stipulatedPredictor(r) === innerProductMod2(SECRET_X, r)) predictorCorrect += 1;
      }
      const successProbability = predictorCorrect / (2 ** DIMENSION);
      const epsilon = successProbability - 0.5;
      const normalizedAdvantage = (2 * successProbability) - 1;
      const input = {
        y: publicImage,
        n: DIMENSION,
        epsilon,
        predictor: (_y: string, r: BitVector) => stipulatedPredictor(r),
        verifyPreimage: async (candidate: BitVector, y: string) => await boundedSha256(candidate) === y,
        sampleUniform: randomBits,
      };
      let attempts = 1;
      let result: GoldreichLevinResult = await reconstructGoldreichLevin(input);
      if (result.status !== 'recovered') {
        attempts += 1;
        result = await reconstructGoldreichLevin(input);
      }
      const verified = result.verifiedCandidates.map(bitVectorKey);
      const totalPredictorQueries = attempts * result.predictorQueries;
      recoveryElement.dataset.value = normalizedAdvantage.toString();
      recoveryElement.innerHTML = `<h3>Rackoff-style bounded reconstruction</h3>
        <dl class="value-list">
          <div class="value-row"><dt>Public y</dt><dd data-field="hardcore-image">${publicImage}</dd></div>
          <div class="value-row"><dt>Exact predictor success p</dt><dd data-field="hardcore-p">${predictorCorrect} / ${2 ** DIMENSION}</dd></div>
          <div class="value-row"><dt>Excess ε = p − 1/2</dt><dd data-field="hardcore-epsilon">${epsilon}</dd></div>
          <div class="value-row"><dt>Normalized advantage 2p − 1 = 2ε</dt><dd data-field="hardcore-advantage">${normalizedAdvantage}</dd></div>
          <div class="value-row"><dt>Sample count ℓ</dt><dd data-field="hardcore-ell">${result.ell}</dd></div>
          <div class="value-row"><dt>Nonempty subset XORs</dt><dd data-field="hardcore-subsets">${result.subsetCount}</dd></div>
          <div class="value-row"><dt>σ guesses</dt><dd data-field="hardcore-sigma">${result.sigmaGuesses}</dd></div>
          <div class="value-row"><dt>Predictor queries per attempt</dt><dd data-field="hardcore-queries">${result.predictorQueries}</dd></div>
          <div class="value-row"><dt>Total predictor queries used</dt><dd data-field="hardcore-total-queries">${totalPredictorQueries}</dd></div>
          <div class="value-row"><dt>Distinct reconstructed candidates</dt><dd data-field="hardcore-candidates">${result.uniqueCandidates.length}</dd></div>
          <div class="value-row"><dt>Independently verified candidates</dt><dd data-field="hardcore-verified">${verified.length ? verified.join(', ') : 'none'}</dd></div>
          <div class="value-row"><dt>Independent attempts used</dt><dd data-field="hardcore-attempts">${attempts}</dd></div>
          <div class="value-row"><dt>Final-attempt uniform sample vectors</dt><dd data-field="hardcore-samples">${result.samples.map(bitVectorKey).join(', ')}</dd></div>
        </dl>
        <p>For each guess, σ<sub>S</sub> is the parity of the guessed σ<sub>j</sub> values in nonempty S; v<sub>i,S</sub> = P(y, s<sub>S</sub> ⊕ e<sub>i</sub>) ⊕ σ<sub>S</sub> votes for x<sub>i</sub>. Distinct subset XORs are pairwise independent, and 2<sup>ℓ</sup> − 1 ≥ n/ε² supports the majority/union-bound argument. The artificial predictor fixture is wrong only at all-zero r and is defined for this fixed x; it is not a SHA-256 attack. The decoder never receives x. It deduplicates the resulting list, then accepts candidates only after recomputing f(candidate) = y. At most one fresh retry is made after an honest miss, and the total work above includes it.</p>`;

      const recovered = result.status === 'recovered';
      recoveryVerdict.dataset.tone = recovered ? 'pass' : 'warning';
      recoveryVerdict.innerHTML = recovered
        ? `<i data-lucide="check-circle-2"></i><div><strong>VERIFIED PREIMAGE FOUND</strong><p>At least one reconstructed candidate independently maps to the public y. This bounded run does not prove one-wayness or unique recovery.</p></div>`
        : '<i data-lucide="shield-alert"></i><div><strong>THIS SAMPLE MISSED</strong><p>The theorem-shaped procedure is probabilistic; this honest failure is not evidence against the theorem.</p></div>';
      recoveryStatus.textContent = 'Fresh uniform reconstruction run complete.';
      hydrateIcons(recoveryVerdict);
    } catch (error) {
      recoveryVerdict.dataset.tone = 'warning';
      recoveryVerdict.innerHTML = '<i data-lucide="shield-alert"></i><div><strong>RUN DID NOT COMPLETE</strong><p>No reconstruction claim is made for this run.</p></div>';
      recoveryStatus.textContent = error instanceof Error ? error.message : 'Reconstruction failed.';
      hydrateIcons(recoveryVerdict);
    } finally {
      recoveryButton.disabled = false;
    }
  });
}
