import { runForgery, type ForgeryResult, type ForgeryScheme } from '../game/forgery';
import { escapeHtml, query } from './dom';
import { hydrateIcons } from './icons';

function markup(): string {
  return `
    <div class="experiment-header">
      <div>
        <p class="section-index">EUF-CMA · CHOSEN-MESSAGE SIGNING ORACLE</p>
        <h2>Ask for signatures, then make a new one</h2>
        <p>The adversary may request signatures before presenting a candidate. Raw RSA's algebra creates signatures on unqueried messages. ECDSA's high-S twin is subtler: it is new signature bytes on a queried message, so ordinary unforgeability and strong unforgeability give different answers.</p>
      </div>
      <span class="experiment-number">EXHIBIT 03</span>
    </div>
    <div class="control-deck">
      <div class="field">
        <label for="forgery-scheme">Scheme and tactic</label>
        <select id="forgery-scheme" data-testid="forgery-scheme">
          <option value="rsa-pss">RSA-PSS · alter signature</option>
          <option value="ed25519">Ed25519 · alter signature</option>
          <option value="ecdsa-malleation">ECDSA secp256k1 · (r, n - s) twin</option>
          <option value="rsa-multiplicative">Textbook RSA · multiplicative forgery (BROKEN)</option>
          <option value="rsa-blinding">Textbook RSA · blinding forgery (BROKEN)</option>
        </select>
        <span class="field-hint">RSA-PSS is the randomized default; broken raw RSA is explicit.</span>
      </div>
      <div class="field">
        <label>Oracle contract</label>
        <div class="actor-readout">Sign chosen messages; verify one candidate.</div>
      </div>
      <div class="field">
        <label>Freshness rule</label>
        <div class="actor-readout">EUF: message unqueried. SUF: signature bytes new.</div>
      </div>
      <div class="button-row is-vertical">
        <button id="forgery-run" class="action-btn primary" type="button"><i data-lucide="key-round"></i>Ask and forge</button>
      </div>
    </div>
    <p id="forgery-retirement" class="retirement-note" role="status" aria-live="polite">No signature-oracle result yet.</p>
    <div class="result-grid">
      <section class="result-block">
        <h3>Oracle transcript</h3>
        <ol class="trace-list" role="list">
          <li role="listitem" data-step="1">Choose the message or algebraic representative.</li>
          <li role="listitem" data-step="2">Receive genuine signature bytes from the named primitive.</li>
          <li role="listitem" data-step="3">Submit a candidate the oracle did not return.</li>
        </ol>
        <dl id="forgery-values" class="value-list" data-claim="forgery-transcript"><div class="value-row"><dt>State</dt><dd>Waiting for a candidate.</dd></div></dl>
      </section>
      <section class="result-block">
        <h3>Verifier outcomes</h3>
        <div id="forgery-verdict" class="verdict" data-verdict="forgery" data-tone="neutral" role="status" aria-live="polite">
          <i data-lucide="circle-dot"></i><div><strong>READY</strong><p>The candidate will be checked by the real verifier.</p></div>
        </div>
        <div id="ecdsa-twin" hidden>
          <div id="plain-verifier" class="verdict" data-verdict="forgery-plain" data-tone="neutral" data-testid="plain-verifier"></div>
          <div id="low-s-verifier" class="verdict" data-verdict="forgery-lows" data-tone="neutral" data-testid="low-s-verifier"></div>
        </div>
      </section>
    </div>
    <details class="guard-rails">
      <summary>Forgery guard rails and definition boundary</summary>
      <div class="guard-grid">
        <p title="EUF-CMA requires a message the signing oracle never signed."><strong>Already-queried message:</strong> not an EUF-CMA forgery, even with new signature bytes.</p>
        <p title="Strong unforgeability also forbids a different valid signature for an old message."><strong>SUF-CMA:</strong> the ECDSA high-S twin crosses this stronger boundary.</p>
        <p title="Noble's verifier rejects high-S signatures unless lowS:false is requested."><strong>Two ECDSA verifiers:</strong> plain is explicit; low-S is the library default.</p>
      </div>
    </details>
  `;
}

function renderValues(result: ForgeryResult, root: HTMLElement): void {
  query<HTMLElement>('#forgery-values', root).innerHTML = Object.entries(result.values)
    .map(([key, value]) => `<div class="value-row"><dt>${escapeHtml(key)}</dt><dd data-field="${escapeHtml(key)}">${escapeHtml(value)}</dd></div>`)
    .join('');
}

export function initForgery(): void {
  const panel = query<HTMLElement>('#panel-forgery');
  panel.innerHTML = markup();
  hydrateIcons(panel);
  const scheme = query<HTMLSelectElement>('#forgery-scheme', panel);
  const run = query<HTMLButtonElement>('#forgery-run', panel);
  const retirement = query<HTMLElement>('#forgery-retirement', panel);
  let resultScheme = '';

  scheme.addEventListener('change', () => {
    if (!resultScheme || resultScheme === scheme.value) return;
    resultScheme = '';
    retirement.dataset.active = 'true';
    retirement.textContent = 'Previous signature result retired because the scheme changed.';
    query<HTMLElement>('#ecdsa-twin', panel).hidden = true;
    query<HTMLElement>('#forgery-values', panel).innerHTML = '<div class="value-row"><dt>State</dt><dd>Previous transcript retired.</dd></div>';
    const verdict = query<HTMLElement>('#forgery-verdict', panel);
    verdict.dataset.tone = 'neutral';
    verdict.innerHTML = '<i data-lucide="circle-dot"></i><div><strong>RESULT RETIRED</strong><p>Ask the newly selected oracle before reading a verdict.</p></div>';
    hydrateIcons(verdict);
  });

  run.addEventListener('click', async () => {
    run.disabled = true;
    run.innerHTML = '<i data-lucide="loader-circle"></i>Computing';
    hydrateIcons(run);
    retirement.dataset.active = 'false';
    retirement.textContent = 'Calling the real signing and verification operations...';
    try {
      const result = await runForgery(scheme.value as ForgeryScheme);
      resultScheme = scheme.value;
      renderValues(result, panel);
      const verdict = query<HTMLElement>('#forgery-verdict', panel);
      const twin = query<HTMLElement>('#ecdsa-twin', panel);
      twin.hidden = result.scheme !== 'ecdsa-malleation';
      if (result.alarm) {
        verdict.dataset.tone = 'alarm';
        verdict.innerHTML = `<i data-lucide="shield-alert"></i><div><strong>${escapeHtml(result.verdict)}</strong><p>${escapeHtml(result.explanation)}</p></div>`;
      } else {
        verdict.dataset.tone = 'pass';
        verdict.innerHTML = `<i data-lucide="check-circle-2"></i><div><strong>${escapeHtml(result.verdict)}</strong><p>${escapeHtml(result.explanation)}</p></div>`;
      }
      if (result.scheme === 'ecdsa-malleation' && result.verifiers) {
        // Both banners branch on what the real verifiers returned for this run.
        // They previously restated the expected outcome as a literal, which made
        // the exhibit's headline a claim about the source rather than evidence
        // from the run: forcing verifyEcdsaPlain to enforce low-S left the page
        // rendering "PLAIN VERIFIER: ACCEPTED" beside a computed "rejected".
        const plain = query<HTMLElement>('#plain-verifier', panel);
        plain.dataset.tone = result.verifiers.plain ? 'alarm' : 'pass';
        plain.innerHTML = result.verifiers.plain
          ? '<i data-lucide="shield-alert"></i><div><strong>PLAIN VERIFIER: ACCEPTED</strong><p>VERIFIES — AND IS A NEW SIGNATURE ON A QUERIED MESSAGE. SUF-CMA fails here.</p></div>'
          : '<i data-lucide="check-circle-2"></i><div><strong>PLAIN VERIFIER: REJECTED</strong><p>This run did not reproduce the malleation: the plain verifier refused the (r, n - s) twin.</p></div>';
        const lowS = query<HTMLElement>('#low-s-verifier', panel);
        lowS.dataset.tone = result.verifiers.lowS ? 'alarm' : 'pass';
        lowS.innerHTML = result.verifiers.lowS
          ? '<i data-lucide="shield-alert"></i><div><strong>LOW-S VERIFIER: ACCEPTED</strong><p>Unexpected: the canonical verifier admitted a signature whose s is above n / 2.</p></div>'
          : '<i data-lucide="check-circle-2"></i><div><strong>LOW-S VERIFIER: REJECTED</strong><p>The library default permits only the canonical low half of s.</p></div>';
      }
      retirement.textContent = 'Fresh result from the selected signing oracle and verifier.';
      hydrateIcons(panel);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown signature failure';
      retirement.dataset.active = 'true';
      retirement.textContent = `Experiment aborted: ${message}`;
    } finally {
      run.disabled = false;
      run.innerHTML = '<i data-lucide="key-round"></i>Ask and forge';
      hydrateIcons(run);
    }
  });
}