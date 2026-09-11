import '@fontsource-variable/newsreader/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './style.css';
import { runKnownAnswerTests } from './kats';
import { initCca } from './ui/cca';
import { query } from './ui/dom';
import { initCpa } from './ui/cpa';
import { initForgery } from './ui/forgery';
import { hydrateIcons } from './ui/icons';
import { initReduction } from './ui/reduction';
import { initSwitching } from './ui/switching';

function initTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const activate = (tab: HTMLButtonElement, focus = false): void => {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panelId = candidate.getAttribute('aria-controls');
      if (panelId) query<HTMLElement>(`#${panelId}`).hidden = !selected;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let target = index;
      if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      activate(tabs[target]!, true);
    });
  });
}

function renderKatStatus(): void {
  const strip = query<HTMLElement>('#kat-strip');
  const summary = query<HTMLElement>('#kat-summary');
  const results = runKnownAnswerTests();
  const passed = results.filter((result) => result.passed).length;
  strip.dataset.state = passed === results.length ? 'pass' : 'fail';
  strip.querySelector('.kat-mark')!.innerHTML = `<i data-lucide="${passed === results.length ? 'check-circle-2' : 'x-circle'}"></i>`;
  strip.querySelector('strong')!.textContent = passed === results.length ? 'Instruments agree' : 'Known-answer mismatch';
  summary.textContent = `${passed}/${results.length} published vector cases pass: FIPS 197 AES, RFC 6979 ECDSA, RFC 8032 Ed25519.`;
}

initTabs();
renderKatStatus();
hydrateIcons();
void initCpa();
initCca();
initForgery();
initSwitching();
initReduction();