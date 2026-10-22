import { buildTree, derivePath, firstBit, GGM_DEMO_DEPTH, parseSeedHex, seedHex, type GeneratorMode } from '../prf/ggm';
import { query } from './dom';

const EXAMPLE_SEED = '00112233445566778899aabbccddeeff';

function treeMarkup(root: Uint8Array, mode: GeneratorMode, selected: string): string {
  const levels = buildTree(root, mode);
  return levels.map((level) => `
    <div class="ggm-level" role="group" style="--ggm-count:${level.length}" aria-label="Depth ${level[0]!.path.length}">
      ${level.map((node) => {
        const path = node.path || 'root';
        const hex = seedHex(node.seed);
        const selectedRoute = selected.startsWith(node.path);
        return `<button type="button" class="ggm-node" data-ggm-path="${node.path}"
          data-route="${selectedRoute}" aria-pressed="${selectedRoute}"
          aria-label="${mode === 'aes' ? 'AES' : 'Repeated'} tree path ${path}, ${node.path.length === GGM_DEMO_DEPTH ? `leaf bit ${firstBit(node.seed)}, ` : ''}state ${hex}">
          <strong>${path}</strong><small>0x${hex.slice(0, 8)}…</small>
          ${node.path.length === GGM_DEMO_DEPTH ? `<em>leaf bit: ${firstBit(node.seed)}</em>` : ''}
        </button>`;
      }).join('')}
    </div>`).join('');
}

function markup(): string {
  return `
    <section id="ggm-extension" class="ggm-extension" aria-labelledby="ggm-title">
      <div class="experiment-header">
        <div>
          <p class="section-index">PRG → PRF · GOLDREICH–GOLDWASSER–MICALI</p>
          <h2 id="ggm-title">Follow a bit path through a tree</h2>
          <p>At each node, a length-doubling generator splits a 128-bit state into left <code>G₀(s)</code> and right <code>G₁(s)</code>. Each 0 takes the left child and each 1 the right. Compare an AES-based candidate with <code>G(s) = s ∥ s</code>, which copies the state into both children.</p>
        </div>
      </div>
      <div class="ggm-controls">
        <p>Use the fixed classroom seed or draw a new one; click any node to inspect its route. Both trees start from the same visible root.</p>
        <button id="ggm-randomize" class="action-btn" type="button">Draw fresh seed</button>
      </div>
      <div id="ggm-comparison" data-claim="ggm-tree">
        <p class="ggm-root" id="ggm-root"></p>
        <div class="ggm-columns">
          <section class="result-block" aria-labelledby="ggm-aes-title">
            <h3 id="ggm-aes-title">AES-based expansion</h3>
            <p><code>G(s) = AESₛ(0¹²⁸) ∥ AESₛ(0¹²⁷1)</code>. Under the AES-128 pseudorandom-permutation assumption, this is a length-doubling PRG candidate.</p>
            <div id="ggm-aes-tree" class="ggm-tree" role="region" aria-label="AES GGM tree; scroll horizontally for all leaves" tabindex="0"></div>
            <p id="ggm-aes-result" class="ggm-result"></p>
          </section>
          <section class="result-block" aria-labelledby="ggm-repeat-title">
            <h3 id="ggm-repeat-title">Broken expansion: repeat the seed</h3>
            <p><code>G(s) = s ∥ s</code>. Left and right are identical; every leaf state and output bit repeats for the same root.</p>
            <div id="ggm-repeat-tree" class="ggm-tree" role="region" aria-label="Repeated-seed GGM tree; scroll horizontally for all leaves" tabindex="0"></div>
            <p id="ggm-repeat-result" class="ggm-result"></p>
          </section>
        </div>
        <p class="ggm-sources">Sources:
          <a href="https://www.wisdom.weizmann.ac.il/~/oded/ggm.html">Goldreich, Goldwasser, and Micali, <cite>How to Construct Random Functions</cite> (JACM 1986)</a>;
          <a href="https://www.routledge.com/Introduction-to-Modern-Cryptography-Revised-Third-Edition/Katz-Lindell/p/book/9781032496795">Katz and Lindell, <cite>Introduction to Modern Cryptography</cite>, revised third edition (2025), §8.5</a>.
        </p>
      </div>
      <p class="ggm-limit">The full GGM function takes 128 input bits; this three-level tree only displays eight paths. Here the output is the first bit of the 128-bit leaf state. The root is shown to the visitor, so this page is not a secret-key PRF test. Different-looking leaves in one run do not prove pseudorandomness; the security claim needs a secure underlying PRG and an appropriate secret seed.</p>
    </section>
  `;
}

export function initGgm(): void {
  const panel = query<HTMLElement>('#panel-switching');
  panel.insertAdjacentHTML('beforeend', markup());
  const exhibit = query<HTMLElement>('#ggm-extension', panel);
  let seed = parseSeedHex(EXAMPLE_SEED);
  let selected = '010';

  const render = (): void => {
    query<HTMLElement>('#ggm-root', exhibit).textContent = `Visible root seed: 0x${seedHex(seed)}`;
    for (const mode of ['aes', 'repeat'] as const) {
      query<HTMLElement>(`#ggm-${mode}-tree`, exhibit).innerHTML = treeMarkup(seed, mode, selected);
      const state = derivePath(seed, selected, mode);
      query<HTMLElement>(`#ggm-${mode}-result`, exhibit).textContent =
        `Selected path ${selected || 'root'}: state 0x${seedHex(state)}` +
        (selected.length === GGM_DEMO_DEPTH ? `; leaf bit ${firstBit(state)}` : '; choose a leaf for its output bit.');
    }
  };

  exhibit.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const node = target.closest<HTMLButtonElement>('.ggm-node');
    if (!node || !exhibit.contains(node)) return;
    selected = node.dataset.ggmPath ?? '';
    render();
  });
  query<HTMLButtonElement>('#ggm-randomize', exhibit).addEventListener('click', () => {
    seed = crypto.getRandomValues(new Uint8Array(16));
    render();
  });
  render();
}
