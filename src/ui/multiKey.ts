import { multiKeyBudget, runMultiKeyGame } from '../game/multiKey';
import { formatNumber, query } from './dom';

export function initMultiKey(): void {
  const panel = query<HTMLElement>('#panel-multi-key');
  panel.innerHTML = `
    <div class="experiment-header"><div>
      <p class="section-index">MULTI-KEY TOY · RARE-SIGNAL GAME</p>
      <h2>One hidden bit, several independent keys</h2>
      <p>The challenger uses one hidden bit across separate user instances. Each query has an independent, publicly marked chance ε of revealing that bit. The adversary reads all signals; if none appears it guesses randomly. This is an abstract game with no encryption or real key material.</p>
    </div><span class="experiment-number">EXHIBIT 06</span></div>
    <div class="control-deck">
      <div class="field"><label for="multi-users">Independent user instances</label><input id="multi-users" type="number" min="1" max="8" step="1" value="3"/></div>
      <div class="field"><label for="multi-queries">Queries per user</label><input id="multi-queries" type="number" min="1" max="8" step="1" value="4"/></div>
      <div class="field"><label for="multi-chance">Reveal chance per query (%)</label><input id="multi-chance" type="number" min="0" max="100" step="1" value="5"/></div>
      <div class="button-row is-vertical"><button id="multi-run" class="action-btn primary" type="button">Run one game</button></div>
    </div>
    <p id="multi-status" class="retirement-note" role="status" aria-live="polite">Choose a configuration and run one game.</p>
    <div id="multi-budget" class="result-block" data-claim="multi-budget" data-value="">
      <h3>Exact model and a conservative ceiling</h3><p>Waiting for valid inputs.</p>
    </div>
    <details class="guard-rails"><summary>What does Qε mean here?</summary>
      <p>Q is the total number of independent leak opportunities across users; ε is a specified per-opportunity probability, not a measured advantage against AES. For this <em>tagged-leak toy</em>, advantage equals the chance of at least one signal: 1−(1−ε)^Q. The union bound says that chance is at most min(1,Qε). A general multi-user security proof needs its own game, resources, assumptions and reduction. Do not multiply a single-key bound by queries again if those queries were already counted in it.</p>
      <p>Primary research: <a href="https://cseweb.ucsd.edu/~mihir/papers/musu.pdf">Bellare, Boldyreva and Micali, <em>Public-Key Encryption in a Multi-User Setting</em></a>; <a href="https://eprint.iacr.org/2018/136">Bose, Hoang and Tessaro, <em>Revisiting AES-GCM-SIV: Multi-user Security, Faster Key Derivation, and Better Bounds</em></a>. Real schemes can have tighter bounds than this teaching ceiling.</p>
    </details>`;
  const users = query<HTMLInputElement>('#multi-users', panel);
  const queries = query<HTMLInputElement>('#multi-queries', panel);
  const chance = query<HTMLInputElement>('#multi-chance', panel);
  const status = query<HTMLElement>('#multi-status', panel);
  const budget = query<HTMLElement>('#multi-budget', panel);

  const compute = () => multiKeyBudget({
    users: Number(users.value), queriesPerUser: Number(queries.value), epsilon: Number(chance.value) / 100,
  });
  const paint = (fresh = false): void => {
    try {
      const config = { users: Number(users.value), queriesPerUser: Number(queries.value), epsilon: Number(chance.value) / 100 };
      const result = compute();
      budget.dataset.value = String(result.unionBound);
      budget.innerHTML = `<h3>Exact model and a conservative ceiling</h3>
        <dl class="value-list"><div class="value-row"><dt>Total opportunities Q</dt><dd>${result.totalQueries}</dd></div>
        <div class="value-row"><dt>Exact toy advantage</dt><dd>${formatNumber(result.exactAdvantage)}</dd></div>
        <div class="value-row"><dt>Union ceiling min(1,Qε)</dt><dd>${formatNumber(result.unionBound)}</dd></div></dl>`;
      if (fresh) {
        const trial = runMultiKeyGame(config);
        budget.innerHTML += `<p>One game: the challenger chose ${trial.challengeBit}; the adversary guessed ${trial.guess} and ${trial.won ? 'won' : 'lost'}. Tagged signals by user: ${trial.revealedByUser.join(', ')}.</p>`;
        status.textContent = 'Fresh toy game run. The formula above is exact for the model; one game is only an illustration.';
      } else status.textContent = 'Configuration changed; previous sampled game retired. Run a fresh game.';
    } catch (error) {
      budget.dataset.value = '';
      budget.innerHTML = '<h3>Exact model and a conservative ceiling</h3><p>Choose valid bounded inputs.</p>';
      status.textContent = error instanceof Error ? error.message : 'Invalid input.';
    }
  };
  for (const control of [users, queries, chance]) control.addEventListener('input', () => paint());
  query<HTMLButtonElement>('#multi-run', panel).addEventListener('click', () => paint(true));
  paint();
}
