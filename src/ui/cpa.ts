import { adversaries } from '../adversaries';
import { estimateAdvantage } from '../game/advantage';
import { runCpaExperiment } from '../game/challenger';
import type { CpaAdversary, CpaScheme, ExperimentResult } from '../game/types';
import { createSchemeRegistry } from '../schemes';
import { escapeHtml, formatNumber, query } from './dom';
import { hydrateIcons } from './icons';

const SCHEME_ORDER = [
  'rsa-oaep',
  'elgamal',
  'rsa-textbook',
  'aes-gcm',
  'aes-ctr',
  'aes-cbc-chained',
  'aes-ecb',
];

const EMPTY_RESULT: ExperimentResult = {
  wins: 0,
  losses: 0,
  errors: 0,
  trials: 0,
  stopped: false,
};

function option(scheme: CpaScheme): string {
  return `<option value="${scheme.id}">${escapeHtml(scheme.label)}${scheme.broken ? ' (BROKEN)' : ''}</option>`;
}

function adversaryOptions(schemeId: string): string {
  const ids = schemeId === 'aes-cbc-chained' ? ['random', 'reencrypt', 'beast'] : ['random', 'reencrypt'];
  return ids
    .map((id) => {
      const strategy = adversaries.get(id)!;
      return `<option value="${id}">${escapeHtml(strategy.label)}</option>`;
    })
    .join('');
}

function panelMarkup(schemes: Map<string, CpaScheme>): string {
  return `
    <div class="experiment-header">
      <div>
        <p class="section-index">IND-CPA · CHOSEN-PLAINTEXT GAME</p>
        <h2>A coin the adversary cannot see</h2>
        <p>Choose two equal-length messages. The challenger samples <code>b</code>, encrypts <code>m_b</code>, and exposes only the public encryption oracle. A useful pattern pushes <code>2 · wins / trials - 1</code> toward one.</p>
      </div>
      <span class="experiment-number">EXHIBIT 01</span>
    </div>
    <div class="control-deck">
      <div class="field">
        <label for="cpa-scheme">Scheme</label>
        <select id="cpa-scheme" data-testid="cpa-scheme">${SCHEME_ORDER.map((id) => option(schemes.get(id)!)).join('')}</select>
        <span id="cpa-scheme-detail" class="field-hint"></span>
      </div>
      <div class="field">
        <label for="cpa-adversary">Adversary</label>
        <select id="cpa-adversary" data-testid="cpa-adversary">${adversaryOptions('rsa-oaep')}</select>
        <span class="field-hint">Strategy sees messages, ciphertext, and the public oracle only.</span>
      </div>
      <div class="field">
        <label for="cpa-trials">Trials</label>
        <input id="cpa-trials" data-testid="cpa-trials" type="number" min="10" max="5000" step="10" value="200" inputmode="numeric" />
        <span class="field-hint">10–5,000; below 10 is refused.</span>
      </div>
      <div class="button-row is-vertical">
        <button id="cpa-run" class="action-btn primary" type="button"><i data-lucide="play"></i>Run</button>
        <button id="cpa-step" class="action-btn" type="button"><i data-lucide="step-forward"></i>Step one</button>
        <button id="cpa-stop" class="action-btn" type="button" disabled><i data-lucide="square"></i>Stop</button>
      </div>
    </div>
    <p id="cpa-retirement" class="retirement-note" role="status" aria-live="polite">No result yet. Changing a control after a run retires its verdict.</p>

    <div class="game-stage" role="group" aria-label="Hidden-bit experiment stage">
      <section class="actor" aria-labelledby="challenger-title">
        <div class="actor-label"><span>CHALLENGER</span><span id="cpa-scheme-badge">RSA-OAEP</span></div>
        <h3 id="challenger-title">Seal the coin</h3>
        <div class="coin-wrap"><div id="cpa-coin" class="coin" role="img" data-open="false" aria-label="Hidden bit is sealed">?</div></div>
        <div id="cpa-ciphertext" class="actor-readout">Waiting to encrypt one of two equal-length messages.</div>
      </section>
      <div class="oracle-lane" aria-hidden="true">
        <span>m0, m1</span><div class="oracle-line"></div>
        <span>Enc(mb)</span><div class="oracle-line return"></div>
        <span>guess</span>
      </div>
      <section class="actor" aria-labelledby="adversary-title">
        <div class="actor-label"><span>ADVERSARY</span><span>PUBLIC VIEW</span></div>
        <h3 id="adversary-title">Find a pattern</h3>
        <div id="cpa-guess" class="actor-readout">The adversary has not guessed yet.</div>
        <ol id="cpa-trace" class="trace-list" role="list">
          <li role="listitem" data-step="1">The bit stays behind the oracle boundary.</li>
          <li role="listitem" data-step="2">Only a real ciphertext crosses the stage.</li>
          <li role="listitem" data-step="3">Open the coin after the guess.</li>
        </ol>
      </section>
    </div>

    <div class="metrics-grid">
      <section class="advantage-panel" aria-labelledby="advantage-title">
        <div class="metric-label"><span id="advantage-title">MEASURED ADVANTAGE</span><span id="cpa-interval">Wilson 95% interval: —</span></div>
        <div id="cpa-advantage" class="metric-value" data-testid="cpa-advantage" data-value="0">0.000</div>
        <div class="advantage-track" role="meter" aria-label="Measured adversary advantage" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0">
          <div id="cpa-advantage-fill" class="advantage-fill"></div>
        </div>
        <div class="advantage-scale"><span>0 · no measured edge</span><span>1 · every guess right</span></div>
        <div id="cpa-verdict" class="verdict" data-verdict="cpa" data-tone="neutral" role="status" aria-live="polite">
          <i data-lucide="circle-dot"></i><div><strong>READY FOR AN ADVERSARY</strong><p>A verdict belongs to one named strategy, scheme, and run.</p></div>
        </div>
      </section>
      <section class="ledger-panel" aria-labelledby="ledger-title">
        <div class="metric-label"><span id="ledger-title">TRIAL LEDGER</span><span>wins + losses + errors = trials</span></div>
        <div class="ledger">
          <div><span>Wins</span><strong id="cpa-wins" data-testid="cpa-wins">0</strong></div>
          <div><span>Losses</span><strong id="cpa-losses" data-testid="cpa-losses">0</strong></div>
          <div><span>Errors</span><strong id="cpa-errors" data-testid="cpa-errors">0</strong></div>
          <div><span>Trials</span><strong id="cpa-total" data-testid="cpa-total">0</strong></div>
        </div>
        <div class="histogram" role="img" aria-label="Win and loss histogram">
          <span>Win</span><div class="hist-track"><div id="cpa-win-bar" class="hist-fill wins"></div></div><span id="cpa-win-rate">0%</span>
          <span>Loss</span><div class="hist-track"><div id="cpa-loss-bar" class="hist-fill"></div></div><span id="cpa-loss-rate">0%</span>
        </div>
        <div id="cpa-tape" class="trial-tape" role="img" aria-label="Most recent trial outcomes"></div>
      </section>
    </div>

    <section id="cbc-negative" class="negative-fixture" data-testid="cbc-negative" hidden>
      <h3 id="cbc-negative-title" data-verdict="cpa-negative">A flat line is not a verdict</h3>
      <p><strong>A measured advantage near zero shows that these adversaries failed; it is not evidence that the scheme is IND-CPA secure.</strong> Chained-IV CBC is broken even when random guessing and re-encryption both miss the defect.</p>
      <div class="fixture-checks" role="group" aria-label="Negative claim evidence">
        <span id="fixture-random" class="fixture-chip">Random guess run</span>
        <span id="fixture-reencrypt" class="fixture-chip">Re-encrypt run</span>
        <span class="fixture-chip" data-done="true">3/3 KATs pass</span>
      </div>
    </section>

    <details class="guard-rails">
      <summary>Game guard rails and edge cases</summary>
      <div class="guard-grid">
        <p title="If m0 equals m1, no strategy can learn which index was chosen."><strong>m0 = m1:</strong> refused; advantage is undefined.</p>
        <p title="IND-CPA does not promise to hide the plaintext length."><strong>Unequal lengths:</strong> refused before the coin is sampled.</p>
        <p title="A failed cryptographic operation cannot be counted as a win or loss."><strong>Oracle exception:</strong> aborts the loop, records one error, and names the cause.</p>
        <p title="A tiny sample has an interval too wide to interpret."><strong>Fewer than 10 trials:</strong> only Step one may do this, and no estimate is claimed.</p>
        <p title="Raw RSA is defined only for representatives below the modulus."><strong>Textbook RSA m ≥ n:</strong> refused before exponentiation.</p>
        <p title="Deliberately vulnerable modes are teaching fixtures, never defaults."><strong>BROKEN modes:</strong> labelled in the picker and never selected on arrival.</p>
      </div>
    </details>
  `;
}

export async function initCpa(): Promise<void> {
  const panel = query<HTMLElement>('#panel-cpa');
  panel.innerHTML = '<div class="panel-loading"><div><i data-lucide="loader-circle"></i><p>Generating the shared RSA-2048 key and preparing real scheme oracles...</p></div></div>';
  hydrateIcons(panel);

  try {
    const schemes = await createSchemeRegistry();
    panel.innerHTML = panelMarkup(schemes);
    hydrateIcons(panel);

    const schemeSelect = query<HTMLSelectElement>('#cpa-scheme', panel);
    const adversarySelect = query<HTMLSelectElement>('#cpa-adversary', panel);
    const trialsInput = query<HTMLInputElement>('#cpa-trials', panel);
    const runButton = query<HTMLButtonElement>('#cpa-run', panel);
    const stepButton = query<HTMLButtonElement>('#cpa-step', panel);
    const stopButton = query<HTMLButtonElement>('#cpa-stop', panel);
    const retirement = query<HTMLElement>('#cpa-retirement', panel);
    const negative = query<HTMLElement>('#cbc-negative', panel);
    const flatlines = new Set<string>();
    const history: boolean[] = [];
    let result: ExperimentResult = { ...EMPTY_RESULT };
    let resultConfig = '';
    let controller: AbortController | undefined;

    const configKey = (): string => `${schemeSelect.value}|${adversarySelect.value}|${trialsInput.value}`;
    const currentScheme = (): CpaScheme => schemes.get(schemeSelect.value)!;
    const currentAdversary = (): CpaAdversary => adversaries.get(adversarySelect.value)!;

    const renderNegativeFixture = (): void => {
      negative.hidden = schemeSelect.value !== 'aes-cbc-chained';
      query<HTMLElement>('#fixture-random', panel).dataset.done = String(flatlines.has('random'));
      query<HTMLElement>('#fixture-reencrypt', panel).dataset.done = String(flatlines.has('reencrypt'));
      query<HTMLElement>('#cbc-negative-title', panel).textContent =
        flatlines.has('random') && flatlines.has('reencrypt')
          ? 'NO ADVANTAGE FOUND BY THESE ADVERSARIES — AND THE SCHEME IS BROKEN'
          : 'A flat line is not a verdict';
    };

    const renderResult = (next: ExperimentResult): void => {
      result = next;
      query<HTMLElement>('#cpa-wins', panel).textContent = String(next.wins);
      query<HTMLElement>('#cpa-losses', panel).textContent = String(next.losses);
      query<HTMLElement>('#cpa-errors', panel).textContent = String(next.errors);
      query<HTMLElement>('#cpa-total', panel).textContent = String(next.trials);
      const denominator = Math.max(1, next.wins + next.losses);
      const winRate = (100 * next.wins) / denominator;
      const lossRate = (100 * next.losses) / denominator;
      query<HTMLElement>('#cpa-win-bar', panel).style.width = `${winRate}%`;
      query<HTMLElement>('#cpa-loss-bar', panel).style.width = `${lossRate}%`;
      query<HTMLElement>('#cpa-win-rate', panel).textContent = `${Math.round(winRate)}%`;
      query<HTMLElement>('#cpa-loss-rate', panel).textContent = `${Math.round(lossRate)}%`;
      query<HTMLElement>('#cpa-tape', panel).innerHTML = history
        .slice(-60)
        .map((won) => `<span class="trial-cell" data-won="${won}" title="${won ? 'win' : 'loss'}">${won ? 'W' : 'L'}</span>`)
        .join('');

      const coin = query<HTMLElement>('#cpa-coin', panel);
      if (next.trace) {
        coin.textContent = String(next.trace.bit);
        coin.dataset.open = 'true';
        coin.setAttribute('aria-label', `Hidden bit opened as ${next.trace.bit}`);
        query<HTMLElement>('#cpa-ciphertext', panel).textContent = `Ciphertext begins ${next.trace.ciphertext}...`;
        query<HTMLElement>('#cpa-guess', panel).textContent = `Guess ${next.trace.guess}; coin ${next.trace.bit}; ${next.trace.won ? 'win' : 'loss'}.`;
        query<HTMLElement>('#cpa-trace', panel).innerHTML = next.trace.events
          .map((event, index) => `<li role="listitem" data-step="${index + 1}">${escapeHtml(event)}</li>`)
          .join('');
      }

      const advantageElement = query<HTMLElement>('#cpa-advantage', panel);
      const intervalElement = query<HTMLElement>('#cpa-interval', panel);
      const fill = query<HTMLElement>('#cpa-advantage-fill', panel);
      const meter = fill.parentElement!;
      const verdict = query<HTMLElement>('#cpa-verdict', panel);
      if (next.error) {
        verdict.dataset.tone = 'alarm';
        verdict.innerHTML = `<i data-lucide="shield-alert"></i><div><strong>TRIAL LOOP ABORTED</strong><p>${escapeHtml(next.error)} The failed attempt is recorded as an error, never a win or loss.</p></div>`;
        hydrateIcons(verdict);
        return;
      }
      if (next.trials === 0) {
        advantageElement.textContent = '0.000';
        advantageElement.dataset.value = '0';
        intervalElement.textContent = 'Wilson 95% interval: —';
        fill.style.width = '0%';
        fill.dataset.tone = 'neutral';
        meter.setAttribute('aria-valuenow', '0');
        return;
      }
      const estimate = estimateAdvantage(next.wins, next.trials);
      advantageElement.textContent = formatNumber(estimate.estimate);
      advantageElement.dataset.value = String(estimate.estimate);
      intervalElement.textContent = `Wilson 95% interval: ${formatNumber(estimate.low)} to ${formatNumber(estimate.high)}`;
      const barValue = Math.max(0, Math.min(1, estimate.estimate));
      fill.style.width = `${barValue * 100}%`;
      meter.setAttribute('aria-valuenow', String(barValue));

      if (next.trials < 10) {
        verdict.dataset.tone = 'warning';
        fill.dataset.tone = 'neutral';
        verdict.innerHTML = '<i data-lucide="step-forward"></i><div><strong>ONE TRIAL, NOT AN ESTIMATE</strong><p>The trace shows mechanism. Ten or more trials are required before interpreting an interval.</p></div>';
      } else if (estimate.low > 0) {
        verdict.dataset.tone = 'alarm';
        fill.dataset.tone = 'alarm';
        verdict.innerHTML = `<i data-lucide="shield-alert"></i><div><strong>BROKEN: ADVANTAGE ${formatNumber(estimate.estimate)} · 95% CI [${formatNumber(estimate.low)}, ${formatNumber(estimate.high)}]</strong><p>This named adversary found a repeatable distinguishing pattern.</p></div>`;
      } else {
        verdict.dataset.tone = 'neutral';
        fill.dataset.tone = 'neutral';
        verdict.innerHTML = '<i data-lucide="circle-dot"></i><div><strong>NO ADVANTAGE FOUND BY THESE ADVERSARIES</strong><p>A confidence interval crossing zero says this run found no edge. It does not establish a universal property.</p></div>';
      }
      hydrateIcons(verdict);
      if (
        schemeSelect.value === 'aes-cbc-chained' &&
        ['random', 'reencrypt'].includes(adversarySelect.value) &&
        Math.abs(estimate.estimate) <= 0.2
      ) {
        flatlines.add(adversarySelect.value);
      }
      renderNegativeFixture();
    };

    const setBusy = (busy: boolean): void => {
      runButton.disabled = busy;
      stepButton.disabled = busy;
      stopButton.disabled = !busy;
      schemeSelect.disabled = busy;
      adversarySelect.disabled = busy;
      trialsInput.disabled = busy;
    };

    const resetVisibleResult = (message: string): void => {
      result = { ...EMPTY_RESULT };
      history.splice(0);
      const coin = query<HTMLElement>('#cpa-coin', panel);
      coin.textContent = '?';
      coin.dataset.open = 'false';
      coin.setAttribute('aria-label', 'Hidden bit is sealed');
      query<HTMLElement>('#cpa-ciphertext', panel).textContent = 'Waiting to encrypt one of two equal-length messages.';
      query<HTMLElement>('#cpa-guess', panel).textContent = 'The adversary has not guessed yet.';
      renderResult(result);
      const verdict = query<HTMLElement>('#cpa-verdict', panel);
      verdict.dataset.tone = 'neutral';
      verdict.innerHTML = '<i data-lucide="circle-dot"></i><div><strong>READY FOR AN ADVERSARY</strong><p>A verdict belongs to one named strategy, scheme, and run.</p></div>';
      retirement.textContent = message;
      retirement.dataset.active = 'true';
      hydrateIcons(verdict);
    };

    const retireIfChanged = (): void => {
      if (result.trials === 0 || configKey() === resultConfig) return;
      resetVisibleResult('Previous result retired because an experiment input changed. Run the new configuration to earn a new verdict.');
    };

    const syncScheme = (): void => {
      const scheme = currentScheme();
      const previousAdversary = adversarySelect.value;
      adversarySelect.innerHTML = adversaryOptions(scheme.id);
      if (Array.from(adversarySelect.options).some(({ value }) => value === previousAdversary)) {
        adversarySelect.value = previousAdversary;
      }
      query<HTMLElement>('#cpa-scheme-detail', panel).textContent = scheme.detail;
      query<HTMLElement>('#cpa-scheme-badge', panel).textContent = `${scheme.label}${scheme.broken ? ' · BROKEN' : ''}`;
      renderNegativeFixture();
    };

    const execute = async (trials: number): Promise<void> => {
      if (trials !== 1 && (!Number.isInteger(trials) || trials < 10 || trials > 5_000)) {
        retirement.textContent = 'Refused: trials must be an integer from 10 through 5,000.';
        retirement.dataset.active = 'true';
        return;
      }
      controller = new AbortController();
      resultConfig = configKey();
      history.splice(0);
      resetVisibleResult(trials === 1 ? 'Stepping one real trial.' : `Running ${trials.toLocaleString()} real trials.`);
      resultConfig = configKey();
      setBusy(true);
      const progressEvery = Math.max(1, Math.floor(trials / 40));
      const final = await runCpaExperiment({
        trials,
        scheme: currentScheme(),
        adversary: currentAdversary(),
        signal: controller.signal,
        onProgress: async (progress) => {
          history.push(progress.trace?.won ?? false);
          if (progress.trials % progressEvery === 0 || progress.trials === trials) {
            renderResult(progress);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        },
      });
      renderResult(final);
      retirement.textContent = final.stopped
        ? `Stopped after ${final.trials.toLocaleString()} trials; this partial result remains labelled.`
        : `Fresh result: ${final.trials.toLocaleString()} trials under ${currentScheme().label} and ${currentAdversary().label}.`;
      retirement.dataset.active = String(final.stopped);
      setBusy(false);
    };

    schemeSelect.addEventListener('change', () => {
      retireIfChanged();
      syncScheme();
    });
    adversarySelect.addEventListener('change', retireIfChanged);
    trialsInput.addEventListener('change', retireIfChanged);
    runButton.addEventListener('click', () => void execute(Number(trialsInput.value)));
    stepButton.addEventListener('click', () => void execute(1));
    stopButton.addEventListener('click', () => controller?.abort());

    syncScheme();
    renderResult(result);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Unknown initialization failure';
    panel.innerHTML = `<div class="verdict" data-verdict="cpa-init" data-tone="alarm"><i data-lucide="shield-alert"></i><div><strong>CRYPTO ENGINE DID NOT INITIALIZE</strong><p>${escapeHtml(message)}</p></div></div>`;
    hydrateIcons(panel);
  }
}