import { runDdhReduction, type ReductionAdversary } from '../reduction/ddh';
import { formatNumber, nextFrame, query } from './dom';
import { hydrateIcons } from './icons';

function markup(): string {
  return `
    <div class="experiment-header">
      <div>
        <p class="section-index">REDUCTION · ELGAMAL IND-CPA FROM DDH</p>
        <h2>Put the adversary inside another algorithm</h2>
        <p>A near-zero measurement cannot establish a definition. A reduction makes the security claim: wrapper B embeds a DDH tuple into A's ElGamal challenge, so an edge for A becomes a DDH distinguishing edge for B.</p>
      </div>
      <span class="experiment-number">EXHIBIT 05</span>
    </div>
    <div class="control-deck">
      <div class="field">
        <label for="reduction-adversary">IND-CPA adversary A</label>
        <select id="reduction-adversary" data-testid="reduction-adversary">
          <option value="random">Random guess</option>
          <option value="reencrypt">Re-encrypt and compare</option>
        </select>
        <span class="field-hint">The same public-oracle strategies from exhibit 01.</span>
      </div>
      <div class="field">
        <label for="reduction-trials">Balanced trials</label>
        <input id="reduction-trials" data-testid="reduction-trials" type="number" min="20" max="5000" step="20" value="200" inputmode="numeric" />
        <span class="field-hint">Must be even: half DDH tuples, half random tuples.</span>
      </div>
      <div class="field">
        <label>Convention</label>
        <div class="actor-readout">Adv(B) = |Pr[B=1|DH] − Pr[B=1|random]| = Adv(A) / 2</div>
      </div>
      <div class="button-row is-vertical">
        <button id="reduction-run" class="action-btn primary" type="button"><i data-lucide="wrap-text"></i>Wrap A in B</button>
      </div>
    </div>
    <p id="reduction-status" class="retirement-note" role="status" aria-live="polite">No reduction run yet.</p>
    <div class="reduction-pipeline" role="group" aria-label="DDH reduction pipeline">
      <section class="reduction-node"><span>INPUT TO B</span><h3>(G, aG, bG, T)</h3><p>T is either abG or an independent group point. B does not know which.</p></section>
      <div class="pipeline-arrow" aria-hidden="true">→</div>
      <section class="reduction-node"><span>WRAPPER B</span><h3>(aG, Mb + T)</h3><p>B makes the tuple look exactly like an ElGamal challenge when T = abG.</p></section>
      <div class="pipeline-arrow" aria-hidden="true">→</div>
      <section class="reduction-node"><span>ADVERSARY A</span><h3>Guess b</h3><p>If A is right, B says “DDH”; otherwise B says “random.”</p></section>
    </div>
    <div class="result-grid">
      <section class="result-block">
        <h3>A inside the IND-CPA game</h3>
        <div id="reduction-a" class="metric-value" data-claim="reduction-a" data-testid="reduction-a" data-value="0">0.000</div>
        <p>Measured absolute IND-CPA advantage from real ristretto255 ElGamal trials.</p>
      </section>
      <section class="result-block">
        <h3>B inside the DDH game</h3>
        <div id="reduction-b" class="metric-value" data-claim="reduction-b" data-testid="reduction-b" data-value="0">0.000</div>
        <dl class="value-list" data-claim="reduction-relation">
          <div class="value-row"><dt>A / 2</dt><dd id="reduction-expected" data-testid="reduction-expected">0.000</dd></div>
          <div class="value-row"><dt>Displayed tolerance</dt><dd id="reduction-tolerance" data-testid="reduction-tolerance">± 0.000</dd></div>
        </dl>
      </section>
    </div>
    <div id="reduction-verdict" class="verdict" data-verdict="reduction" data-tone="neutral" role="status" aria-live="polite">
      <i data-lucide="circle-dot"></i><div><strong>READY</strong><p>Run B to compare its measured DDH edge with half of A's measured IND-CPA edge.</p></div>
    </div>
    <details class="guard-rails">
      <summary>What the reduction does and does not claim</summary>
      <div class="guard-grid">
        <p title="A DDH tuple becomes an ElGamal-shaped challenge without revealing which distribution it came from."><strong>Black-box use:</strong> B calls A through the same public interface.</p>
        <p title="Sampling introduces uncertainty around both estimates."><strong>Displayed factor:</strong> checked with a conservative tolerance assembled from the component Wilson intervals.</p>
        <p title="The implication is conditional on DDH hardness in the chosen group."><strong>Not absolute safety:</strong> the reduction transfers an attack; it does not measure every adversary.</p>
      </div>
    </details>
  `;
}

export function initReduction(): void {
  const panel = query<HTMLElement>('#panel-reduction');
  panel.innerHTML = markup();
  hydrateIcons(panel);
  const adversary = query<HTMLSelectElement>('#reduction-adversary', panel);
  const trials = query<HTMLInputElement>('#reduction-trials', panel);
  const run = query<HTMLButtonElement>('#reduction-run', panel);
  const status = query<HTMLElement>('#reduction-status', panel);
  let resultConfig = '';

  const config = (): string => `${adversary.value}|${trials.value}`;
  const retireIfChanged = (): void => {
    if (!resultConfig || resultConfig === config()) return;
    resultConfig = '';
    for (const id of ['reduction-a', 'reduction-b']) {
      const value = query<HTMLElement>(`#${id}`, panel);
      value.textContent = '0.000';
      value.dataset.value = '0';
    }
    query<HTMLElement>('#reduction-expected', panel).textContent = '0.000';
    query<HTMLElement>('#reduction-tolerance', panel).textContent = '± 0.000';
    const verdict = query<HTMLElement>('#reduction-verdict', panel);
    verdict.dataset.tone = 'neutral';
    verdict.innerHTML = '<i data-lucide="circle-dot"></i><div><strong>RESULT RETIRED</strong><p>Run B around the new configuration before comparing factors.</p></div>';
    status.dataset.active = 'true';
    status.textContent = 'Previous reduction result retired because an experiment input changed.';
    hydrateIcons(verdict);
  };

  adversary.addEventListener('change', retireIfChanged);
  trials.addEventListener('change', retireIfChanged);

  run.addEventListener('click', async () => {
    const count = Number(trials.value);
    if (!Number.isInteger(count) || count < 20 || count > 5_000 || count % 2 !== 0) {
      status.dataset.active = 'true';
      status.textContent = 'Refused: trials must be an even integer from 20 through 5,000.';
      return;
    }
    run.disabled = true;
    status.dataset.active = 'false';
    status.textContent = 'Embedding DDH tuples and running A inside B...';
    await nextFrame();
    try {
      const result = await runDdhReduction(count, adversary.value as ReductionAdversary);
      const a = query<HTMLElement>('#reduction-a', panel);
      const b = query<HTMLElement>('#reduction-b', panel);
      a.textContent = formatNumber(result.aAdvantage);
      a.dataset.value = String(result.aAdvantage);
      b.textContent = formatNumber(result.bAdvantage);
      b.dataset.value = String(result.bAdvantage);
      query<HTMLElement>('#reduction-expected', panel).textContent = formatNumber(result.expectedB);
      query<HTMLElement>('#reduction-tolerance', panel).textContent = `± ${formatNumber(result.relationTolerance)}`;
      const verdict = query<HTMLElement>('#reduction-verdict', panel);
      if (result.relationHolds) {
        verdict.dataset.tone = 'pass';
        verdict.innerHTML = '<i data-lucide="check-circle-2"></i><div><strong>THE WRAPPER PRESERVES THE EXPECTED FACTOR</strong><p>B’s measured DDH advantage lies within the displayed conservative tolerance around A / 2.</p></div>';
      } else {
        verdict.dataset.tone = 'alarm';
        verdict.innerHTML = '<i data-lucide="shield-alert"></i><div><strong>RELATION OUTSIDE THE DISPLAYED INTERVAL</strong><p>Repeat with more trials; persistent disagreement indicates an embedding or accounting defect.</p></div>';
      }
      status.textContent = `Fresh reduction run: ${count.toLocaleString()} IND-CPA trials and ${count.toLocaleString()} balanced DDH samples.`;
      resultConfig = config();
      hydrateIcons(verdict);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown reduction failure';
      status.dataset.active = 'true';
      status.textContent = `Reduction aborted: ${message}`;
    } finally {
      run.disabled = false;
    }
  });
}