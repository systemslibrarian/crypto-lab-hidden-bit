import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const strategyFiles = readdirSync(directory)
  .filter((filename) => filename.endsWith('.ts'))
  .filter((filename) => !filename.endsWith('.test.ts'))
  .filter((filename) => filename !== 'index.ts');

describe('adversary isolation', () => {
  it.each(strategyFiles)('%s imports only public contracts or public curve arithmetic', (filename) => {
    const source = readFileSync(join(directory, filename), 'utf8');
    const imports = Array.from(source.matchAll(/from\s+['"]([^'"]+)['"]/g), (match) => match[1]!);
    expect(imports.every((path) => path === '../game/types' || path.startsWith('@noble/curves/'))).toBe(true);
    expect(imports.some((path) => path.startsWith('../schemes/') || path.startsWith('../reduction/'))).toBe(false);
  });

  it.each(strategyFiles)('%s cannot name non-public state', (filename) => {
    const source = readFileSync(join(directory, filename), 'utf8');
    expect(source).not.toMatch(/privateScalar|secretKey|oaepPrivate|pssPrivate|challengerBit|hiddenBit|textbookSign|getRsaMaterial/);
  });
});