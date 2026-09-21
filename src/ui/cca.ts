import { runElGamalCca, runRsaOaepCca, type CcaExperimentResult } from '../game/cca';
import { escapeHtml, formatNumber, query } from './dom';
import { hydrateIcons } from './icons';

function markup(): string {
  return `
    <div class="experiment-header">
      <div>
        <p class="section-index">IND-CCA2 · ADAPTIVE DECRYPTION ORACLE</p>
        <h2>Change the ciphertext, then ask</h2>
        <p>The oracle refuses the exact challenge bytes, but answers every other valid query. ElGamal's group structure lets one tiny change carry the hidden message through that boundary; OAEP's decoding rejects the same tactic.</p>
      </div>
      <span class="experiment-number">EXHIBIT 02</span>
    </div>
    <div class="control-deck">
      <div class="field">
        <label for="cca-scheme">Scheme</label>
        <select id="cca-scheme" data-testid="cca-scheme">
          <option value="rsa-oaep-cca">RSA-OAEP</option>
          <option value="elgamal-cca">ElGamal / ristretto255 (BROKEN under CCA2)</option>
        </select>
        <span class="field-hint">A randomized construction is the arrival default.</span>
      </div>
      <div class="field">
        <label for="cca-trials">Trials</label>
        <input id="cca-trials" data-testid="cca-trials" type="number" min="10" max="1000" step="10" value="100" inputmode="numeric" />
        <span class="field-hint">The decryption oracle runs once per trial.</span>
      </div>
      <div class="field">
        <label>Adversary</label>
        <div class="actor-readout" id="cca-adversary-label">Flip one OAEP ciphertext bit</div>
      </div>
      <div class="button-row is-vertical">
        <button id="cca-run" class="action-btn primary" type="button"><i data-lucide="play"></i>Run oracle game</button>
      </div>
    </div>
    <p id="cca-retirement" class="retirement-note" role="status" aria-live="polite">No CCA2 result yet.</p>
    <div class="result-grid">
      <section class="result-block" aria-labelledby="cca-boundary-title">
        <h3 id="cca-boundary-title">Oracle boundary</h3>
        <div id="cca-refusal" class="verdict" data-verdict="cca-boundary" data-tone="neutral">
          <i data-lucide="circle-dot"></i><div><strong>NOT QUERIED YET</strong><p>The challenge rejection is checked by exact byte comparison.</p></div>
        </div>
        <ol id="cca-trace" class="trace-list" role="list">
          <li role="listitem" data-step="1">Receive the challenge ciphertext.</li>
          <li role="listitem" data-step="2">Submit a different ciphertext.</li>
          <li role="listitem" data-step="3">Use the answer to guess the bit.</li>
        </ol>
      </section>
      <section class="result-block" aria-labelledby="cca-result-title">
        <h3 id="cca-result-title">Measured result</h3>
        <div class="ledger" data-claim="cca-ledger">
          <div><span>Wins</span><strong id="cca-wins" data-testid="cca-wins">0</strong></div>
          <div><span>Losses</span><strong id="cca-losses" data-testid="cca-losses">0</strong></div>
          <div><span>Errors</span><strong id="cca-errors" data-testid="cca-errors">0</strong></div>
          <div><span>Trials</span><strong id="cca-total" data-testid="cca-total">0</strong></div>
        </div>
        <div class="metric-label"><span>ADVANTAGE</span><span id="cca-interval" data-claim="cca-interval">95% interval: —</span></div>
        <div id="cca-advantage" class="metric-value" data-claim="cca-advantage" data-testid="cca-advantage" data-value="0">0.000</div>
        <div id="cca-verdict" class="verdict" data-verdict="cca" data-tone="neutral" role="status" aria-live="polite">
          <i data-lucide="circle-dot"></i><div><strong>READY</strong><p>Run the real oracle before reading a result.</p></div>
        </div>
      </section>
    </div>
    <details class="guard-rails">
      <summary>Why the exact challenge is forbidden</summary>
      <div class="guard-grid">
        <p title="Decrypting the challenge would return mb directly."><strong>Exact bytes:</strong> refused as the trivial win, and the refusal is shown.</p>
        <p title="CCA2 allows adaptive queries both before and after the challenge."><strong>Modified bytes:</strong> accepted by the interface; decoding may still fail.</p>
        <p title="The ElGamal message space is a fixed set of hash-to-group labels."><strong>Unknown label:</strong> refused rather than decoded into invented text.</p>
      </div>
    </details>
  `;
}

export function initCca(): void {
  const panel = query<HTMLElement>('#panel-cca');
  panel.innerHTML = markup();
  hydrateIcons(panel);
  const scheme = query<HTMLSelectElement>('#cca-scheme', panel);
  const trials = query<HTMLInputElement>('#cca-trials', panel);
  const run = query<HTMLButtonElement>('#cca-run', panel);
  const retirement = query<HTMLElement>('#cca-retirement', panel);
  let hasResult = false;
  let resultConfig = '';

  const config = (): string => `${scheme.value}|${trials.value}`;
  const resetResult = (): void => {
    for (const id of ['cca-wins', 'cca-losses', 'cca-errors', 'cca-total']) {
      query<HTMLElement>(`#${id}`, panel).textContent = '0';
    }
    const advantage = query<HTMLElement>('#cca-advantage', panel);
    advantage.textContent = '0.000';
    advantage.dataset.value = '0';
    query<HTMLElement>('#cca-interval', panel).textContent = '95% interval: —';
    const refusal = query<HTMLElement>('#cca-refusal', panel);
    refusal.dataset.tone = 'neutral';
    refusal.innerHTML = '<i data-lucide="circle-dot"></i><div><strong>NOT QUERIED YET</strong><p>The challenge rejection is checked by exact byte comparison.</p></div>';
    query<HTMLElement>('#cca-trace', panel).innerHTML = `
      <li role="listitem" data-step="1">Receive the challenge ciphertext.</li>
      <li role="listitem" data-step="2">Submit a different ciphertext.</li>
      <li role="listitem" data-step="3">Use the answer to guess the bit.</li>`;
    const verdict = query<HTMLElement>('#cca-verdict', panel);
    verdict.dataset.tone = 'neutral';
    verdict.innerHTML = '<i data-lucide="circle-dot"></i><div><strong>RESULT RETIRED</strong><p>Run the new configuration before comparing it.</p></div>';
    hydrateIcons(panel);
  };
  const retire = (): void => {
    if (!hasResult || config() === resultConfig) return;
    hasResult = false;
    retirement.dataset.active = 'true';
    retirement.textContent = 'Previous CCA2 result retired because an experiment input changed.';
    resetResult();
  };

  const syncScheme = (): void => {
    query<HTMLElement>('#cca-adversary-label', panel).textContent =
      scheme.value === 'elgamal-cca' ? 'Add one group element, decrypt, subtract it' : 'Flip one OAEP ciphertext bit';
  };

  const render = (result: CcaExperimentResult): void => {
    query<HTMLElement>('#cca-wins', panel).textContent = String(result.wins);
    query<HTMLElement>('#cca-losses', panel).textContent = String(result.losses);
    query<HTMLElement>('#cca-errors', panel).textContent = String(result.errors);
    query<HTMLElement>('#cca-total', panel).textContent = String(result.trials);
    const advantage = query<HTMLElement>('#cca-advantage', panel);
    advantage.textContent = formatNumber(result.advantage);
    advantage.dataset.value = String(result.advantage);
    query<HTMLElement>('#cca-interval', panel).textContent = `95% interval: ${formatNumber(result.interval[0])} to ${formatNumber(result.interval[1])}`;
    query<HTMLElement>('#cca-trace', panel).innerHTML = result.trace
      .map((event, index) => `<li role="listitem" data-step="${index + 1}">${escapeHtml(event)}</li>`)
      .join('');
    const refusal = query<HTMLElement>('#cca-refusal', panel);
    refusal.dataset.tone = result.exactChallengeRejected ? 'pass' : 'alarm';
    refusal.innerHTML = result.exactChallengeRejected
      ? '<i data-lucide="check-circle-2"></i><div><strong>EXACT CHALLENGE REFUSED</strong><p>The byte-equal query never reached decryption.</p></div>'
      : '<i data-lucide="shield-alert"></i><div><strong>BOUNDARY FAILURE</strong><p>The exact challenge was not refused.</p></div>';
    const verdict = query<HTMLElement>('#cca-verdict', panel);
    if (result.interval[0] > 0) {
      verdict.dataset.tone = 'alarm';
      verdict.innerHTML = `<i data-lucide="shield-alert"></i><div><strong>BROKEN: ADVANTAGE ${formatNumber(result.advantage)}</strong><p>The modified-ciphertext query carried the hidden message through the oracle.</p></div>`;
    } else {
      verdict.dataset.tone = 'neutral';
      verdict.innerHTML = '<i data-lucide="circle-dot"></i><div><strong>NO ADVANTAGE FOUND BY THIS ADVERSARY</strong><p>OAEP rejected the modified ciphertext uniformly. This result belongs only to this tactic and run.</p></div>';
    }
    hydrateIcons(panel);
  };

  scheme.addEventListener('change', () => { retire(); syncScheme(); });
  trials.addEventListener('change', retire);
  run.addEventListener('click', async () => {
    const count = Number(trials.value);
    if (!Number.isInteger(count) || count < 10 || count > 1_000) {
      retirement.dataset.active = 'true';
      retirement.textContent = 'Refused: trials must be an integer from 10 through 1,000.';
      return;
    }
    run.disabled = true;
    run.innerHTML = '<i data-lucide="loader-circle"></i>Running';
    hydrateIcons(run);
    retirement.dataset.active = 'false';
    retirement.textContent = 'Querying the real decryption boundary...';
    try {
      const result = scheme.value === 'elgamal-cca' ? await runElGamalCca(count) : await runRsaOaepCca(count);
      render(result);
      hasResult = true;
      resultConfig = config();
      retirement.textContent = `Fresh CCA2 result: ${count.toLocaleString()} trials.`;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown oracle failure';
      retirement.dataset.active = 'true';
      retirement.textContent = `Experiment aborted: ${message}`;
    } finally {
      run.disabled = false;
      run.innerHTML = '<i data-lucide="play"></i>Run oracle game';
      hydrateIcons(run);
    }
  });
  syncScheme();
}