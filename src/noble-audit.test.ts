/* What "audited" covers for the Noble packages this lab ships.
 *
 * The page and the README both said the ElGamal, ECDSA, Ed25519 and AES-ECB
 * paths "use audited Noble packages" / "the audited Noble packages", with no
 * version. Each library records its own audit history, and both are behind the
 * pin here:
 *
 *   @noble/curves  — "at version 2.3.0, in Aug 2026, by [Trail of Bits]"
 *   @noble/ciphers — "at version 1.0.0, in Sep 2024, independently, by [cure53]"
 *
 * and this lab pins ^2.4.0 of each. Both sides are read — the lab's wording and
 * the installed libraries' own READMEs — so an upgrade that changes an audit
 * record, or an edit that drops the versions, fails here.
 */
import { describe, expect, it } from 'vitest';

import curvesReadme from '../node_modules/@noble/curves/README.md?raw';
import ciphersReadme from '../node_modules/@noble/ciphers/README.md?raw';
import pageSource from '../index.html?raw';
import readmeSource from '../README.md?raw';
import pkg from '../package.json';

const flat = (text: string) => text.replace(/\s+/g, ' ');

describe('the Noble audit claims', () => {
  it('pins versions later than either library has audited', () => {
    expect(pkg.dependencies['@noble/curves']).toBe('^2.4.0');
    expect(pkg.dependencies['@noble/ciphers']).toBe('^2.4.0');

    expect(curvesReadme).toMatch(/at version 2\.3\.0, in Aug 2026, by \[Trail of Bits\]/);
    expect(curvesReadme).not.toMatch(/at version 2\.4\.\d+, in [A-Z]/);

    expect(ciphersReadme).toMatch(/at version 1\.0\.0, in Sep 2024, independently, by \[cure53\]/);
    expect(ciphersReadme).not.toMatch(/at version 2\.\d+\.\d+, in [A-Z]/);
  });

  it('never calls the shipped packages simply "audited"', () => {
    for (const [name, text] of [
      ['index.html', flat(pageSource)],
      ['README.md', flat(readmeSource)],
    ] as const) {
      expect(text, `${name}`).not.toContain('use audited Noble packages');
      expect(text, `${name}`).not.toContain('the audited Noble packages');
    }
  });

  it('names both audited versions wherever the packages are described', () => {
    for (const [name, text] of [
      ['index.html', flat(pageSource)],
      ['README.md', flat(readmeSource)],
    ] as const) {
      expect(text, `${name} names the curves audit`).toMatch(/2\.3\.0/);
      expect(text, `${name} names the ciphers audit`).toMatch(/1\.0\.0/);
      expect(text, `${name} names the pin`).toMatch(/\^2\.4\.0/);
    }
  });
});
