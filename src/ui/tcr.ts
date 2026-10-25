/**
 * Exhibit 08 — Target collision resistance as an order-of-play game (S09).
 *
 * Rendering only. Every number on screen comes from src/game/tcr.ts, which
 * computes it from the real (toy) families; the transcripts are the machine's
 * own accept/refuse decisions, not a description of them. The exhibit reuses
 * E-K-04's interaction vocabulary — acts, control decks, result blocks, guard
 * rails and retirement notes — without borrowing any of its proof credit.
 */

import {
  exactAnalysis,
  familyFacts,
  playCrGame,
  playTcrGame,
  sampleGames,
  winRateInterval,
  type CrGameRecord,
  type TcrFamilyId,
  type TcrGameRecord,
  type TcrStrategyId,
} from '../game/tcr';
import { randomBytes } from '../schemes/utils';
import { escapeHtml, formatNumber, query } from './dom';

interface TcrView {
  family: TcrFamilyId;
  strategy: TcrStrategyId;
  keyMode: string;
  retired: boolean;
  tcr: TcrGameRecord | null;
  cr: CrGameRecord | null;
  sample: { order: 'target-before-key' | 'collision-after-key'; wins: number; trials: number }[] | null;
}

function hexByte(value: number): string {
  return `0x${value.toString(16).padStart(2, '0').toUpperCase()}`;
}

function randomByte(): number {
  return randomBytes(1)[0]! & 0xff;
}

const STRATEGY_LABELS: Readonly<Record<TcrStrategyId, { label: string; note: string }>> = {
  'plant-shift': {
    label: 'Plant-shift — knows the planted pair',
    note: 'Commits the planted point 0xF0 target-first; key-first it shifts {0xF0, 0x0F} past the input mask.',
  },
  'scan-pairs': {
    label: 'Scan — structure-blind',
    note: 'Searches the domain with no knowledge of the planted pair: pairs key-first, partners target-first.',
  },
  'spray-multi': {
    label: 'Spray — the collision game’s native plan',
    note: 'Tries to commit two targets up front. The target-before-key machine commits exactly one; the refusal stays on tape.',
  },
};

export function initTcr(): void {
  const panel = query<HTMLElement>('#panel-tcr');
  panel.innerHTML = `
    <div class="experiment-header">
      <div>
        <p class="section-index">TARGET COLLISION RESISTANCE · ORDER OF PLAY · S09</p>
        <h2>The same family, two orders of play</h2>
        <p>A keyed family H<sub>s</sub>(x) = h(x ⊕ s) is played as two different games. Target-first, the adversary commits x before the key exists; key-first, it sees s and then picks both inputs. The machines below enforce each order as a state machine and refuse every out-of-order move on the transcript.</p>
      </div>
      <span class="experiment-number">EXHIBIT 08</span>
    </div>

    <section class="proof-act" aria-labelledby="tcr-order-title">
      <div class="proof-act-heading">
        <div><p class="section-index">ACT A · THE TWO MACHINES</p><h3 id="tcr-order-title">Play both orders, move by move</h3></div>
        <p>Every move is adjudicated by its machine: accepted moves advance the position, refused moves stay on the transcript with their reason. The refusals are the lesson, not an error.</p>
      </div>
      <div class="control-deck">
        <div class="field">
          <label for="tcr-family">Hash family</label>
          <select id="tcr-family">
            <option value="planted-pair">Planted pair — one collision at a known place</option>
            <option value="nibble-fold">Nibble fold — fifteen partners everywhere</option>
          </select>
          <span class="field-hint" id="tcr-family-note"></span>
        </div>
        <div class="field">
          <label for="tcr-strategy">Adversary strategy</label>
          <select id="tcr-strategy">
            <option value="plant-shift">Plant-shift</option>
            <option value="scan-pairs">Scan</option>
            <option value="spray-multi">Spray</option>
          </select>
          <span class="field-hint" id="tcr-strategy-note"></span>
        </div>
        <div class="field">
          <label for="tcr-key">Key draw</label>
          <select id="tcr-key">
            <option value="random">Uniform 8-bit key</option>
            <option value="00">Replay key 0x00</option>
            <option value="10">Replay key 0x10</option>
            <option value="ff">Replay key 0xFF</option>
          </select>
          <span class="field-hint">Replay keys make the game reproducible; 0x00 and 0xFF are the two keys that beat a 0xF0 target on the planted family.</span>
        </div>
      </div>
      <p id="tcr-status" class="retirement-note" role="status" aria-live="polite">Choose a family, a strategy and a key, then play each order once.</p>

      <div class="proof-grid">
        <div class="machine-column">
          <h4>Target-before-key</h4>
          <p class="machine-order">Legal order: commit x → draw s → submit x′. The machine refuses a second target, a target after the key, and a partner equal to x.</p>
          <div class="button-row"><button id="tcr-play" class="action-btn primary" type="button">Play target-first</button></div>
          <div id="tcr-transcript" class="result-block ledger" data-claim="tcr-transcript">
            <h3>Machine transcript</h3><p>No game played yet.</p>
          </div>
          <div id="tcr-verdict" class="verdict" data-verdict="tcr-game" data-tone="neutral" role="status" aria-live="polite">
            <div><strong>READY</strong><p>One target may be committed before the key exists.</p></div>
          </div>
        </div>
        <div class="machine-column">
          <h4>Collision-after-key</h4>
          <p class="machine-order">Legal order: publish s → choose x → submit x′. Choosing x before the key is published is refused, and so is a partner equal to x.</p>
          <div class="button-row"><button id="cr-play" class="action-btn primary" type="button">Play key-first</button></div>
          <div id="cr-transcript" class="result-block ledger" data-claim="cr-transcript">
            <h3>Machine transcript</h3><p>No game played yet.</p>
          </div>
          <div id="cr-verdict" class="verdict" data-verdict="cr-game" data-tone="neutral" role="status" aria-live="polite">
            <div><strong>READY</strong><p>The key is published before any input is chosen.</p></div>
          </div>
        </div>
      </div>
    </section>

    <section class="proof-act" aria-labelledby="tcr-separation-title">
      <div class="proof-act-heading">
        <div><p class="section-index">ACT B · THE MEASURED SEPARATION</p><h3 id="tcr-separation-title">Exact by exhaustion, then a sample</h3></div>
        <p>The exact chances below are computed over the entire key space — all 256 keys, and for target-first over every committed target — not estimated. The sampler then plays real games with uniform keys and brackets its win rates with Wilson 95% intervals.</p>
      </div>
      <div class="control-deck">
        <div class="field">
          <label for="tcr-trials">Games per order</label>
          <input id="tcr-trials" type="number" min="32" max="2048" step="1" value="512" inputmode="numeric" />
          <span class="field-hint">A teaching budget: enough to bracket a 1-in-128 chance, never a security claim.</span>
        </div>
        <div class="button-row"><button id="tcr-sample-run" class="action-btn" type="button">Sample both orders</button></div>
      </div>
      <div class="proof-grid">
        <div id="tcr-separation" class="result-block" data-claim="tcr-separation" data-value="">
          <h3>Exact analysis</h3><p>Waiting for a configuration.</p>
        </div>
        <div id="tcr-sample" class="result-block" data-claim="tcr-sample" data-value="">
          <h3>Sampled games</h3><p>No sample run yet.</p>
        </div>
      </div>
    </section>

    <section class="proof-act" aria-labelledby="tcr-definitions-title">
      <div class="proof-act-heading">
        <div><p class="section-index">ACT C · THE THREE NOTIONS AND THE SIGNED PAIR</p><h3 id="tcr-definitions-title">Which game is which</h3></div>
        <p>Collision resistance, second-preimage resistance and target collision resistance are three different games over the same family. The first is the strongest: any adversary that wins either of the other two has produced a collision. Target collision resistance is strictly weaker — this exhibit's planted family is the witness.</p>
      </div>
      <div class="definition-table">
        <table>
          <caption class="sr-only">The three collision-style notions, their orders of play and this exhibit's measured chances.</caption>
          <thead><tr><th scope="col">Notion</th><th scope="col">Order of play</th><th scope="col">Who supplies the target</th></tr></thead>
          <tbody>
            <tr><th scope="row">Collision resistance</th><td>key first, then both inputs</td><td>the adversary picks x and x′ after the key</td></tr>
            <tr><th scope="row">Second preimage</th><td>key and challenge first, then the partner</td><td>the challenger hands over x with the key already public</td></tr>
            <tr><th scope="row">Target collision (UOWHF)</th><td>target first, then the key, then the partner</td><td>the adversary commits x before any key exists</td></tr>
          </tbody>
        </table>
      </div>
      <div class="result-block">
        <h3>The signed (key, digest) pair</h3>
        <p>Hash-then-sign with a keyed family signs the pair (s, H<sub>s</sub>(x)) together, so a signature is bound to both the hash key and the digest. The forgery statement is a target collision: find x′ ≠ x with H<sub>s</sub>(x′) = H<sub>s</sub>(x), and the old signature verifies for the new message. When the message is committed before the signing session draws its hash key — the ordinary case for a document that already exists — the forger faces exactly the target-before-key order. That order-of-play observation is why Naor and Yung proposed universal one-way hashing for signatures.</p>
      </div>
    </section>

    <details class="guard-rails">
      <summary>Teaching boundaries</summary>
      <div class="guard-grid">
        <p><strong>Exhaustible by design:</strong> an 8-bit domain has 256 inputs and 256 keys, so every exact number here is a complete count, not an estimate. That is the point of the toy; it is also why none of these numbers say anything about SHA-256, whose domain and key spaces are not exhaustible.</p>
        <p><strong>No asymptotic claim:</strong> UOWHF security is a property of a family indexed by a security parameter against probabilistic polynomial-time adversaries (Rompel showed one-way functions suffice). No browser run of an 8-bit toy establishes or measures that.</p>
        <p><strong>Strategy-specific results:</strong> the plant-shift and spray strategies exploit the planted pair of the planted family; on the nibble-fold family the same submissions lose the key-first game because {0xF0, 0x0F} is not a collision of the fold. The structure-blind scan wins key-first on both. The exhibit displays the strategy it measured.</p>
        <p><strong>Win rate, not guessing advantage:</strong> a collision game has no hidden coin, so the natural statistic is the win probability itself. The lab's guessing games report 2p − 1; this exhibit reports p and its Wilson interval, and conflating the two would misstate both.</p>
        <p><strong>One family per game:</strong> the negative-control family is a second small family, not the lesson's main family; the roadmap's one-family requirement is the planted pair, which runs under both orders above.</p>
        <p><strong>Related but different exhibits:</strong> the PRP/PRF exhibit counts collisions to distinguish a permutation from a function — a different notion with its own bound. Hash Zoo teaches fixed-key preimage and collision notions; nothing there is keyed or order-of-play.</p>
      </div>
    </details>
    <details class="sources">
      <summary>Sources</summary>
      <p>Naor, M. and Yung, M., <a href="https://dl.acm.org/doi/10.1145/73007.73013"><em>Universal One-Way Hash Functions and Their Cryptographic Applications</em></a>, STOC 1989 — the order-of-play definition and the signature motivation. Rompel, J., <a href="https://dl.acm.org/doi/10.1145/100216.100273"><em>One-Way Functions are Necessary and Sufficient for Secure Signatures</em></a>, STOC 1990 — target collision resistance from any one-way function. The encyclopedia's <a href="https://doi.org/10.1007/978-3-030-71522-9_624">UOWHF entry (pp. 6634–6637)</a> surveys both. Fixed-key hash notions: <a href="https://systemslibrarian.github.io/crypto-lab-hash-zoo/">Hash Zoo</a>.</p>
    </details>
  `;

  const view: TcrView = {
    family: 'planted-pair',
    strategy: 'plant-shift',
    keyMode: 'random',
    retired: false,
    tcr: null,
    cr: null,
    sample: null,
  };

  const familySelect = query<HTMLSelectElement>('#tcr-family', panel);
  const strategySelect = query<HTMLSelectElement>('#tcr-strategy', panel);
  const keySelect = query<HTMLSelectElement>('#tcr-key', panel);
  const trialsInput = query<HTMLInputElement>('#tcr-trials', panel);
  const status = query<HTMLElement>('#tcr-status', panel);

  const drawKey = (): number => {
    if (view.keyMode === 'random') return randomByte();
    return Number.parseInt(view.keyMode, 16);
  };

  const retire = (message: string): void => {
    view.tcr = null;
    view.cr = null;
    view.sample = null;
    view.retired = true;
    status.textContent = message;
  };

  const renderGames = (): void => {
    const tcrBlock = query<HTMLElement>('#tcr-transcript', panel);
    const tcrVerdict = query<HTMLElement>('#tcr-verdict', panel);
    if (view.retired) {
      tcrBlock.innerHTML = '<h3>Machine transcript</h3><p>No game played yet.</p>';
      tcrVerdict.dataset.tone = 'neutral';
      tcrVerdict.innerHTML = '<div><strong>RESULT RETIRED</strong><p>The configuration moved; play the target-first game again under the new settings.</p></div>';
    } else if (view.tcr === null) {
      tcrBlock.innerHTML = '<h3>Machine transcript</h3><p>No game played yet.</p>';
      tcrVerdict.dataset.tone = 'neutral';
      tcrVerdict.innerHTML = '<div><strong>READY</strong><p>One target may be committed before the key exists.</p></div>';
    } else {
      const record = view.tcr;
      const moves = record.transcript
        .map(
          (entry) =>
            `<div class="tcr-move${entry.accepted ? '' : ' is-refused'}"><span class="tcr-move-name">${escapeHtml(entry.move)}</span> <code>${entry.value === null ? 'none' : hexByte(entry.value)}</code> — ${escapeHtml(entry.reason)}</div>`,
        )
        .join('');
      tcrBlock.innerHTML = `
        <h3>Machine transcript</h3>
        <dl class="value-list">
          <div class="value-row"><dt>Committed target</dt><dd>${hexByte(record.target)}</dd></div>
          <div class="value-row"><dt>Key drawn after</dt><dd>${hexByte(record.key)}</dd></div>
          <div class="value-row"><dt>Target digest</dt><dd>${hexByte(record.targetHash)}</dd></div>
          <div class="value-row"><dt>Partner</dt><dd>${record.partner === null ? 'none found' : hexByte(record.partner)}</dd></div>
          <div class="value-row"><dt>Partner digest</dt><dd>${record.partnerHash === null ? '—' : hexByte(record.partnerHash)}</dd></div>
        </dl>
        ${moves}`;
      if (record.won) {
        tcrVerdict.dataset.tone = 'alarm';
        tcrVerdict.innerHTML = `<div><strong>TARGET COLLISION</strong><p>The partner hashes equal under the drawn key: the committed target did not survive this family's target-before-key game.</p></div>`;
      } else {
        tcrVerdict.dataset.tone = 'pass';
        tcrVerdict.innerHTML = `<div><strong>NO TARGET COLLISION</strong><p>No partner matched the committed target's digest under the drawn key. The definition held this game.</p></div>`;
      }
    }

    const crBlock = query<HTMLElement>('#cr-transcript', panel);
    const crVerdict = query<HTMLElement>('#cr-verdict', panel);
    if (view.retired) {
      crBlock.innerHTML = '<h3>Machine transcript</h3><p>No game played yet.</p>';
      crVerdict.dataset.tone = 'neutral';
      crVerdict.innerHTML = '<div><strong>RESULT RETIRED</strong><p>The configuration moved; play the key-first game again under the new settings.</p></div>';
    } else if (view.cr === null) {
      crBlock.innerHTML = '<h3>Machine transcript</h3><p>No game played yet.</p>';
      crVerdict.dataset.tone = 'neutral';
      crVerdict.innerHTML = '<div><strong>READY</strong><p>The key is published before any input is chosen.</p></div>';
    } else {
      const record = view.cr;
      const moves = record.transcript
        .map(
          (entry) =>
            `<div class="tcr-move${entry.accepted ? '' : ' is-refused'}"><span class="tcr-move-name">${escapeHtml(entry.move)}</span> <code>${entry.value === null ? 'none' : hexByte(entry.value)}</code> — ${escapeHtml(entry.reason)}</div>`,
        )
        .join('');
      crBlock.innerHTML = `
        <h3>Machine transcript</h3>
        <dl class="value-list">
          <div class="value-row"><dt>Published key</dt><dd>${hexByte(record.key)}</dd></div>
          <div class="value-row"><dt>Chosen x</dt><dd>${hexByte(record.x)}</dd></div>
          <div class="value-row"><dt>Digest of x</dt><dd>${hexByte(record.xHash)}</dd></div>
          <div class="value-row"><dt>Partner</dt><dd>${record.partner === null ? 'none' : hexByte(record.partner)}</dd></div>
          <div class="value-row"><dt>Partner digest</dt><dd>${record.partnerHash === null ? '—' : hexByte(record.partnerHash)}</dd></div>
        </dl>
        ${moves}`;
      if (record.won) {
        crVerdict.dataset.tone = 'alarm';
        crVerdict.innerHTML = `<div><strong>COLLISION</strong><p>Two distinct inputs hash equal under the published key: the family's collision-after-key game is broken by this strategy.</p></div>`;
      } else {
        crVerdict.dataset.tone = 'pass';
        crVerdict.innerHTML = `<div><strong>NO COLLISION</strong><p>The submitted partner did not match the chosen x under this key. The definition held this game.</p></div>`;
      }
    }
  };

  const renderAnalysis = (): void => {
    const separation = query<HTMLElement>('#tcr-separation', panel);
    const analysis = exactAnalysis(view.family, view.strategy);
    separation.dataset.value = String(analysis.tcrWorstTargetWinChance);
    separation.innerHTML = `
      <h3>Exact analysis</h3>
      <dl class="value-list">
        <div class="value-row"><dt>Target-before-key chance</dt><dd>${formatNumber(analysis.tcrWorstTargetWinChance)}</dd></div>
        <div class="value-row"><dt>Collision-after-key chance</dt><dd>${formatNumber(analysis.crWinChance)}</dd></div>
        <div class="value-row"><dt>Second-preimage chance</dt><dd>${formatNumber(analysis.sprWinChance)}</dd></div>
        <div class="value-row"><dt>Keys beating the worst target</dt><dd>${analysis.worstTargetKeys.length} of 256</dd></div>
      </dl>
      <p>${escapeHtml(familyFacts(view.family).description)}</p>`;
  };

  const renderSample = (): void => {
    const sampleBlock = query<HTMLElement>('#tcr-sample', panel);
    if (view.sample === null) {
      sampleBlock.dataset.value = '';
      sampleBlock.innerHTML = '<h3>Sampled games</h3><p>No sample run yet.</p>';
      return;
    }
    const rows = view.sample
      .map((run) => {
        const interval = winRateInterval(run.wins, run.trials);
        return `
          <div class="value-row">
            <dt>${run.order === 'target-before-key' ? 'Target-first wins' : 'Key-first wins'}</dt>
            <dd>${run.wins} of ${run.trials} (rate ${formatNumber(interval.rate)}, 95% ${formatNumber(interval.low)} to ${formatNumber(interval.high)})</dd>
          </div>`;
      })
      .join('');
    const targetFirst = view.sample.find((run) => run.order === 'target-before-key');
    sampleBlock.dataset.value = targetFirst ? String(targetFirst.wins / targetFirst.trials) : '';
    sampleBlock.innerHTML = `<h3>Sampled games</h3><dl class="value-list">${rows}</dl>`;
  };

  const renderNotes = (): void => {
    query<HTMLElement>('#tcr-family-note', panel).textContent = familyFacts(view.family).description;
    query<HTMLElement>('#tcr-strategy-note', panel).textContent = STRATEGY_LABELS[view.strategy].note;
  };

  const renderAll = (): void => {
    renderNotes();
    renderGames();
    renderAnalysis();
    renderSample();
  };

  familySelect.addEventListener('change', () => {
    view.family = familySelect.value as TcrFamilyId;
    retire('Family changed; previous games and samples retired. Play each order again.');
    renderAll();
  });
  strategySelect.addEventListener('change', () => {
    view.strategy = strategySelect.value as TcrStrategyId;
    retire('Strategy changed; previous games and samples retired. Play each order again.');
    renderAll();
  });
  keySelect.addEventListener('change', () => {
    view.keyMode = keySelect.value;
    retire('Key mode changed; previous games retired. Play each order again.');
    renderAll();
  });
  trialsInput.addEventListener('change', () => {
    retire('Sample budget changed; previous samples retired. Sample both orders again.');
    renderAll();
  });

  query<HTMLButtonElement>('#tcr-play', panel).addEventListener('click', () => {
    view.retired = false;
    view.tcr = playTcrGame(view.family, view.strategy, drawKey);
    status.textContent = 'Fresh target-first game played with the machine adjudicating every move.';
    renderGames();
  });
  query<HTMLButtonElement>('#cr-play', panel).addEventListener('click', () => {
    view.retired = false;
    view.cr = playCrGame(view.family, view.strategy, drawKey);
    status.textContent = 'Fresh key-first game played with the machine adjudicating every move.';
    renderGames();
  });

  query<HTMLButtonElement>('#tcr-sample-run', panel).addEventListener('click', () => {
    try {
      const trials = Number(trialsInput.value);
      view.retired = false;
      view.sample = [
        {
          order: 'target-before-key',
          ...sampleGames(view.family, 'target-before-key', view.strategy, trials, randomByte),
        },
        {
          order: 'collision-after-key',
          ...sampleGames(view.family, 'collision-after-key', view.strategy, trials, randomByte),
        },
      ];
      status.textContent = `Fresh sample: ${trials} games per order with uniform keys. The exact numbers beside them are the complete counts.`;
      renderSample();
    } catch (error) {
      view.sample = null;
      status.textContent = error instanceof Error ? error.message : 'Invalid sample budget.';
      renderSample();
    }
  });

  renderAll();
}
