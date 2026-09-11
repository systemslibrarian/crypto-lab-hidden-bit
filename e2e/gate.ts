import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText, formatNonTextFailures } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const NARROW = { width: 380, height: 800 };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
}

export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `horizontal overflow in ${label}`).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const failures = await page.evaluate(() => {
    const focusable = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .filter((element) => {
        const style = getComputedStyle(element);
        return ['auto', 'scroll'].includes(style.overflowX) || ['auto', 'scroll'].includes(style.overflowY);
      })
      .filter((element) => element.tabIndex < 0 && !element.querySelector(focusable))
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
  });
  expect(failures, `scrolling regions without a keyboard route in ${label}`).toEqual([]);
}

async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const failures = await page.evaluate(() => {
    const selector = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => element.tabIndex >= 0 && element.checkVisibility?.({ checkVisibilityCSS: true }))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        let opacity = 1;
        for (let node: Element | null = element; node; node = node.parentElement) {
          opacity *= Number.parseFloat(getComputedStyle(node).opacity);
        }
        return opacity === 0 || box.width === 0 || box.height === 0;
      })
      .map((element) => `${element.tagName.toLowerCase()}#${element.id}.${element.className}`);
  });
  expect(failures, `focus targets that paint nothing in ${label}`).toEqual([]);
}

async function expectHiddenReallyHidden(page: Page, label: string): Promise<void> {
  const failures = await page.locator('[hidden]').evaluateAll((elements) =>
    elements
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => (element as HTMLElement).id || (element as HTMLElement).className),
  );
  expect(failures, `[hidden] elements painted in ${label}`).toEqual([]);
}

export async function boot(page: Page): Promise<void> {
  page.setDefaultTimeout(30_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#kat-strip')).toHaveAttribute('data-state', 'pass');
  await expect(page.locator('#cpa-scheme')).toBeEnabled();
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('header[role="banner"]')).toHaveCount(1);
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);
  await expect(page.locator('#theme-toggle, #themeToggle, .theme-toggle, [data-theme-toggle]')).toHaveCount(0);
}

export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules(['landmark-no-duplicate-banner', 'landmark-unique', 'landmark-one-main', 'landmark-complementary-is-top-level'])
    .analyze();
  const violations = [...wcag.violations, ...landmarks.violations].map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')).slice(0, 8),
  }));
  expect(violations, `axe violations in ${label}`).toEqual([]);
  const incomplete = [...wcag.incomplete, ...landmarks.incomplete]
    .filter((result) => result.id !== 'color-contrast')
    .map((result) => ({ id: result.id, nodes: result.nodes.map((node) => node.target.join(' ')).slice(0, 8) }));
  expect(incomplete, `unexplained axe incomplete results in ${label}`).toEqual([]);
  expect(formatContrastFailures(await auditContrast(page)), `measured text contrast in ${label}`).toEqual([]);
  expect(formatNonTextFailures(await auditNonText(page)), `measured non-text contrast in ${label}`).toEqual([]);
  expect(Object.keys(NONTEXT_BASELINE), 'non-text baseline is a ratchet, not an exemption').toEqual([]);
  await expectNoHorizontalOverflow(page, label);
  await expectScrollersReachable(page, label);
  await expectNoInvisibleFocusTargets(page, label);
  await expectHiddenReallyHidden(page, label);
}

async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const panelId = await tab.getAttribute('aria-controls');
  await expect(page.locator(`#${panelId}`)).toBeVisible();
}

export async function driveAllStates(page: Page, viewport: string): Promise<void> {
  await scan(page, `${viewport} / arrival`);
  await page.keyboard.press('Tab');
  await expect(page.locator('.cl-skip-link')).toBeFocused();
  await scan(page, `${viewport} / skip link focused`);

  await page.locator('#cpa-scheme').selectOption('rsa-textbook');
  await page.locator('#cpa-adversary').selectOption('reencrypt');
  await page.locator('#cpa-trials').fill('10');
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Fresh result');
  await scan(page, `${viewport} / deterministic IND-CPA break`);

  await page.locator('#cpa-scheme').selectOption('aes-cbc-chained');
  await page.locator('#cpa-adversary').selectOption('beast');
  await page.locator('#cpa-trials').fill('10');
  await page.locator('#cpa-run').click();
  await expect(page.locator('#cpa-retirement')).toContainText('Fresh result');
  await scan(page, `${viewport} / CBC predictor and negative claim`);

  await page.locator('#panel-cpa .guard-rails > summary').click();
  await scan(page, `${viewport} / CPA guard rails open`);

  await openTab(page, 'CCA2 oracle');
  await page.locator('#cca-scheme').selectOption('elgamal-cca');
  await page.locator('#cca-trials').fill('10');
  await page.locator('#cca-run').click();
  await expect(page.locator('#cca-retirement')).toContainText('Fresh CCA2 result');
  await scan(page, `${viewport} / CCA exact refusal and ElGamal alarm`);

  await openTab(page, 'Signature oracle');
  await page.locator('#forgery-scheme').selectOption('ecdsa-malleation');
  await page.locator('#forgery-run').click();
  await expect(page.locator('#forgery-retirement')).toContainText('Fresh result');
  await scan(page, `${viewport} / ECDSA twin verdict`);

  await openTab(page, 'PRP / PRF');
  await page.locator('#switch-bits').fill('8');
  await page.locator('#switch-queries').fill('8');
  await page.locator('#switch-trials').fill('100');
  await page.locator('#switch-run').click();
  await expect(page.locator('#switch-status')).toContainText('Fresh switching curve');
  await scan(page, `${viewport} / switching chart and table`);

  await openTab(page, 'DDH reduction');
  await page.locator('#reduction-trials').fill('20');
  await page.locator('#reduction-run').click();
  await expect(page.locator('#reduction-status')).toContainText('Fresh reduction run');
  await scan(page, `${viewport} / live DDH wrapper`);

  await page.locator('.definition-table > summary').click();
  await page.locator('.sources > summary').click();
  await page.locator('#reduction-run').focus();
  await scan(page, `${viewport} / disclosures open and action focused`);
}