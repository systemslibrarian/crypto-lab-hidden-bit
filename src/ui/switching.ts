import {
  MAX_SWITCHING_QUERIES,
  MAX_SWITCHING_WORK,
  runSwitchingPoint,
  scaledBound128,
  type SwitchingPoint,
} from '../prf/switching';
import { escapeHtml, formatNumber, nextFrame, query } from './dom';
import { hydrateIcons } from './icons';

function markup(): string {
  return `
    <div class="experiment-header">
      <div>
        <p class="section-index">PRP / PRF SWITCHING LEMMA · LAZY SAMPLING</p>
        <h2>Collisions reveal the function</h2>
        <p>An ideal permutation never repeats an output; an ideal function may. Query distinct inputs, guess “function” after the first collision, and compare the measured distinguishing advantage with <code>q(q − 1) / 2^(n + 1)</code>.</p>
      </div>
      <span class="experiment-number">EXHIBIT 04</span>
    </div>
    <div class="control-deck">
      <div class="field">
        <label for="switch-bits">Output bits n</label>
        <input id="switch-bits" data-testid="switch-bits" type="number" min="8" max="20" step="1" value="12" inputmode="numeric" />
        <span class="field-hint">Selectable from 8 through 20.</span>
      </div>
      <div class="field">
        <label for="switch-queries">Largest query count q</label>
        <input id="switch-queries" data-testid="switch-queries" type="number" min="2" max="4096" step="1" value="48" inputmode="numeric" />
        <span id="switch-q-hint" class="field-hint">Must not exceed min(2^n, 4,096).</span>
      </div>
      <div class="field">
        <label for="switch-trials">Trials per point</label>
        <input id="switch-trials" data-testid="switch-trials" type="number" min="100" max="5000" step="100" value="400" inputmode="numeric" />
        <span class="field-hint">More trials narrow sampling noise.</span>
      </div>
      <div class="button-row is-vertical">
        <button id="switch-run" class="action-btn primary" type="button"><i data-lucide="gauge"></i>Measure curve</button>
      </div>
    </div>
    <p id="switch-status" class="retirement-note" role="status" aria-live="polite">No switching experiment yet.</p>
    <div class="result-grid">
      <section class="result-block">
        <h3>Collision-finding adversary</h3>
        <ol class="trace-list" role="list">
          <li role="listitem" data-step="1">Ask q distinct inputs; each answer is sampled only when first requested.</li>
          <li role="listitem" data-step="2">On a repeated output, guess ideal function.</li>
          <li role="listitem" data-step="3">With no collision, guess ideal permutation.</li>
        </ol>
        <div class="verdict" data-tone="neutral">
          <i data-lucide="flask-conical"></i><div><strong>AT n = 128</strong><p id="switch-scaled">For q = 48, the switching bound is 2256 / 2^129.</p></div>
        </div>
      </section>
      <section class="result-block">
        <h3>Bound check</h3>
        <div id="switch-verdict" class="verdict" data-tone="neutral">
          <i data-lucide="circle-dot"></i><div><strong>READY</strong><p>Every measured point will be checked against bound plus its displayed sampling tolerance.</p></div>
        </div>
        <p>The union bound can be loose; a measurement above it beyond sampling tolerance indicates a sampler or accounting defect, not a cryptanalytic discovery.</p>
      </section>
    </div>
    <div class="chart-wrap">
      <svg id="switch-chart" class="switch-chart" role="img" aria-label="No switching measurements yet" viewBox="0 0 640 250"></svg>
      <div class="chart-legend"><span><i class="legend-swatch"></i>Measured advantage</span><span><i class="legend-swatch bound"></i>Switching bound</span></div>
    </div>
    <div class="table-scroll" role="region" aria-label="Switching measurements" tabindex="0">
      <table>
        <thead><tr><th>q</th><th>Wins / trials</th><th>Measured advantage</th><th>Bound</th><th>Wilson 95%</th><th>Alarm tolerance</th></tr></thead>
        <tbody id="switch-rows"><tr><td colspan="6">Run the curve to populate independently checkable values.</td></tr></tbody>
      </table>
    </div>
    <details class="guard-rails">
      <summary>Sampler guard rails</summary>
      <div class="guard-grid">
        <p title="There are only 2^n distinct inputs and outputs."><strong>q &gt; 2^n:</strong> refused before sampling.</p>
        <p title="A repeated query must receive the same lazily sampled answer."><strong>Repeated input:</strong> returns its stored output, never a new draw.</p>
        <p title="The ideal permutation samples without replacement."><strong>Permutation range:</strong> exhaustion is refused rather than wrapped.</p>
      </div>
    </details>
  `;
}

function queryValues(maximum: number): number[] {
  const values: number[] = [];
  for (let value = 2; value < maximum; value *= 2) values.push(value);
  values.push(maximum);
  return Array.from(new Set(values));
}

function renderChart(points: SwitchingPoint[], root: HTMLElement): void {
  const svg = query<SVGSVGElement>('#switch-chart', root);
  const left = 48;
  const right = 620;
  const top = 18;
  const bottom = 214;
  const maximum = Math.max(0.1, ...points.flatMap((point) => [Math.max(0, point.measured), point.bound]));
  const x = (index: number): number => left + (index * (right - left)) / Math.max(1, points.length - 1);
  const y = (value: number): number => bottom - (Math.max(0, value) / maximum) * (bottom - top);
  const measured = points.map((point, index) => `${x(index)},${y(point.measured)}`).join(' ');
  const bound = points.map((point, index) => `${x(index)},${y(point.bound)}`).join(' ');
  const grid = [0, .25, .5, .75, 1]
    .map((fraction) => {
      const lineY = bottom - fraction * (bottom - top);
      return `<line class="chart-grid" x1="${left}" x2="${right}" y1="${lineY}" y2="${lineY}"/><text class="chart-axis" x="4" y="${lineY + 4}">${formatNumber(maximum * fraction, 2)}</text>`;
    })
    .join('');
  const labels = points
    .map((point, index) => `<text class="chart-axis" text-anchor="middle" x="${x(index)}" y="238">${point.queries}</text>`)
    .join('');
  const dots = points
    .map((point, index) => `<circle class="chart-dot-measured" cx="${x(index)}" cy="${y(point.measured)}" r="4"/><circle class="chart-dot-bound" cx="${x(index)}" cy="${y(point.bound)}" r="3"/>`)
    .join('');
  svg.innerHTML = `${grid}<polyline class="chart-bound" points="${bound}"/><polyline class="chart-measured" points="${measured}"/>${dots}${labels}`;
  svg.setAttribute('aria-label', `Measured PRP/PRF advantage and switching bound for ${points.length} query counts from ${points[0]!.queries} to ${points.at(-1)!.queries}.`);
}

export function initSwitching(): void {
  const panel = query<HTMLElement>('#panel-switching');
  panel.innerHTML = markup();
  hydrateIcons(panel);
  const bits = query<HTMLInputElement>('#switch-bits', panel);
  const queries = query<HTMLInputElement>('#switch-queries', panel);
  const trials = query<HTMLInputElement>('#switch-trials', panel);
  const run = query<HTMLButtonElement>('#switch-run', panel);
  const status = query<HTMLElement>('#switch-status', panel);
  let resultConfig = '';

  const config = (): string => `${bits.value}|${queries.value}|${trials.value}`;
  const resetResult = (): void => {
    query<HTMLElement>('#switch-rows', panel).innerHTML = '<tr><td colspan="6">Previous curve retired. Run the new configuration.</td></tr>';
    const chart = query<SVGSVGElement>('#switch-chart', panel);
    chart.innerHTML = '';
    chart.setAttribute('aria-label', 'No current switching measurements');
    const verdict = query<HTMLElement>('#switch-verdict', panel);
    verdict.dataset.tone = 'neutral';
    verdict.innerHTML = '<i data-lucide="circle-dot"></i><div><strong>RESULT RETIRED</strong><p>Measure the new configuration before reading the curve.</p></div>';
    status.dataset.active = 'true';
    status.textContent = 'Previous switching curve retired because an experiment input changed.';
    resultConfig = '';
    hydrateIcons(verdict);
  };

  const retireIfChanged = (): void => {
    if (resultConfig && resultConfig !== config()) resetResult();
  };

  const syncScale = (): void => {
    const q = Number(queries.value);
    query<HTMLElement>('#switch-scaled', panel).textContent = Number.isInteger(q) && q > 0
      ? `For q = ${q}, the n = 128 switching bound is ${scaledBound128(q)}.`
      : 'Choose a positive integer q to scale the formula.';
    const n = Number(bits.value);
    query<HTMLElement>('#switch-q-hint', panel).textContent = Number.isInteger(n) && n >= 8 && n <= 20
        ? `At n = ${n}, q must not exceed ${Math.min(2 ** n, MAX_SWITCHING_QUERIES).toLocaleString()}; each curve is capped at ${MAX_SWITCHING_WORK.toLocaleString()} oracle calls.`
      : 'n must be an integer from 8 through 20.';
  };
      bits.addEventListener('input', () => { retireIfChanged(); syncScale(); });
      queries.addEventListener('input', () => { retireIfChanged(); syncScale(); });
      trials.addEventListener('input', retireIfChanged);

  run.addEventListener('click', async () => {
    const n = Number(bits.value);
    const q = Number(queries.value);
    const count = Number(trials.value);
    if (!Number.isInteger(n) || n < 8 || n > 20) {
      status.dataset.active = 'true';
      status.textContent = 'Refused: n must be an integer from 8 through 20.';
      return;
    }
    if (!Number.isInteger(q) || q < 2 || q > Math.min(2 ** n, MAX_SWITCHING_QUERIES)) {
      status.dataset.active = 'true';
      status.textContent = `Refused: q must be an integer from 2 through ${Math.min(2 ** n, MAX_SWITCHING_QUERIES).toLocaleString()}.`;
      return;
    }
    if (!Number.isInteger(count) || count < 100 || count > 5_000) {
      status.dataset.active = 'true';
      status.textContent = 'Refused: trials per point must be an integer from 100 through 5,000.';
      return;
    }
    const work = queryValues(q).reduce((total, pointQ) => total + pointQ * count, 0);
    if (work > MAX_SWITCHING_WORK) {
      status.dataset.active = 'true';
      status.textContent = `Refused: this curve needs ${work.toLocaleString()} oracle calls; the cap is ${MAX_SWITCHING_WORK.toLocaleString()}.`;
      return;
    }
    run.disabled = true;
    status.dataset.active = 'false';
    status.textContent = 'Sampling ideal permutation and function oracles...';
    await nextFrame();
    try {
      const points: SwitchingPoint[] = [];
      for (const pointQ of queryValues(q)) {
        points.push(runSwitchingPoint(n, pointQ, count));
        status.textContent = `Measured q = ${pointQ.toLocaleString()} of ${q.toLocaleString()}.`;
        await nextFrame();
      }
      query<HTMLElement>('#switch-rows', panel).innerHTML = points
        .map((point) => `
          <tr data-q="${point.queries}" data-bound="${point.bound}" data-measured="${point.measured}" data-tolerance="${point.tolerance}">
            <td>${point.queries}</td><td>${point.wins} / ${point.trials}</td><td>${formatNumber(point.measured, 4)}</td><td>${formatNumber(point.bound, 6)}</td><td>[${formatNumber(point.wilsonLow, 4)}, ${formatNumber(point.wilsonHigh, 4)}]</td><td>± ${formatNumber(point.tolerance, 4)}</td>
          </tr>`)
        .join('');
      renderChart(points, panel);
      const failures = points.filter((point) => !point.withinTolerance);
      const verdict = query<HTMLElement>('#switch-verdict', panel);
      if (failures.length > 0) {
        verdict.dataset.tone = 'alarm';
        verdict.innerHTML = `<i data-lucide="shield-alert"></i><div><strong>SAMPLER CHECK FAILED AT q = ${failures.map(({ queries: value }) => value).join(', ')}</strong><p>Measured advantage exceeded bound plus the displayed tolerance.</p></div>`;
      } else {
        verdict.dataset.tone = 'pass';
        verdict.innerHTML = '<i data-lucide="check-circle-2"></i><div><strong>ALL MEASURED POINTS STAY WITHIN BOUND + TOLERANCE</strong><p>The collision strategy approaches the theoretical curve without crossing its statistical guard.</p></div>';
      }
      status.textContent = `Fresh switching curve: ${points.length} q values, ${count.toLocaleString()} trials each.`;
      resultConfig = config();
      hydrateIcons(verdict);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown sampler failure';
      status.dataset.active = 'true';
      status.textContent = `Experiment aborted: ${escapeHtml(message)}`;
    } finally {
      run.disabled = false;
    }
  });
  syncScale();
}