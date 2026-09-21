#!/usr/bin/env node
/**
 * §4.1c mutation driver.
 *
 * Every rendered verdict in this lab has a mutation that forces it false. A
 * mutation counts as a KILL only when ALL THREE of these hold:
 *
 *   1. the UNMUTATED baseline PASSED in the same run — recorded, not assumed;
 *   2. the failure is that verdict's OWN assertion, not a build error, a blank
 *      page, a timeout, or the whole suite going red;
 *   3. the run used a server serving THE MUTATED CODE.
 *
 * (3) is why every run below sets CI=1. playwright.config.ts uses
 * `reuseExistingServer: !process.env.CI`, so CI=1 forces a fresh
 * `npm run build && npm run preview` on this lab's own pinned port (4667,
 * recorded in crypto-lab/tools/playwright-ports.json). A reused server — or a
 * port shared with another lab — would answer from an unmutated checkout and
 * turn a real kill into a survivor, or answer for a different lab entirely and
 * turn a survivor into a false kill.
 *
 * Usage:
 *   node mutations/run.mjs             # every mutation
 *   node mutations/run.mjs <id> [...]  # named mutations only
 *   node mutations/run.mjs --list
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'mutations', 'registry.json'), 'utf8'));

/** Failure shapes that are NOT a kill, however red they look. */
const NOT_A_KILL = [
  { pattern: /error TS\d+|Build failed|Transform failed|Could not resolve/i, label: 'build error' },
  { pattern: /Timeout .* exceeded while running "beforeAll"|webServer.*did not start/i, label: 'server never started' },
  { pattern: /net::ERR_CONNECTION_REFUSED/i, label: 'nothing served on the port' },
];

function run(command, args, env = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function playwright(spec, grep) {
  return run('npx', ['playwright', 'test', spec, '--grep', grep, '--reporter=list', '--retries=0'], {
    CI: '1',
  });
}

function applyMutation(entry) {
  const path = join(ROOT, entry.file);
  const original = readFileSync(path, 'utf8');
  const expected = entry.occurrences ?? 1;
  const seen = original.split(entry.find).length - 1;
  if (seen !== expected) {
    throw new Error(
      `mutation "${entry.id}": expected ${expected} occurrence(s) of its find string in ${entry.file}, found ${seen}. ` +
        'The source moved; update mutations/registry.json rather than loosening the match.',
    );
  }
  writeFileSync(path, original.split(entry.find).join(entry.replace));
  return () => writeFileSync(path, original);
}

function classify(output) {
  for (const { pattern, label } of NOT_A_KILL) {
    if (pattern.test(output)) return label;
  }
  return null;
}

function failingTests(output) {
  return [...output.matchAll(/^\s*\d+\)\s+(.+?)\s*[─-]{3,}/gm)].map((match) => match[1].trim());
}

function excerpt(output, grep) {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => /^\s*\d+\)\s/.test(line));
  if (start === -1) return output.trim().split('\n').slice(-25).join('\n');
  return lines.slice(start, start + 28).join('\n');
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const entry of REGISTRY.mutations) {
    console.log(`${entry.id.padEnd(34)} marker=${entry.marker.padEnd(16)} ${entry.spec}`);
  }
  process.exit(0);
}

const selected = args.length > 0
  ? REGISTRY.mutations.filter((entry) => args.includes(entry.id) || args.includes(entry.marker))
  : REGISTRY.mutations;

if (selected.length === 0) {
  console.error(`No mutation matched ${args.join(', ')}. Try --list.`);
  process.exit(2);
}

const results = [];
for (const entry of selected) {
  console.log(`\n${'='.repeat(78)}\nMUTATION ${entry.id}   marker=${entry.marker}\n${'='.repeat(78)}`);

  // 1. BASELINE, unmutated, same command, same run.
  console.log(`--- baseline: ${entry.spec} --grep "${entry.grep}"`);
  const baseline = playwright(entry.spec, entry.grep);
  const baselineTail = baseline.output.trim().split('\n').slice(-6).join('\n');
  console.log(baselineTail);
  if (!baseline.ok) {
    results.push({ entry, verdict: 'NO BASELINE', baseline: baselineTail, failure: null, notKill: null });
    console.log(`\n>>> ${entry.id}: NOT A KILL — the unmutated baseline did not pass.`);
    continue;
  }

  // 2. MUTATE and rerun exactly the same command.
  const restore = applyMutation(entry);
  let mutated;
  try {
    console.log(`--- mutated: ${entry.file}`);
    mutated = playwright(entry.spec, entry.grep);
  } finally {
    restore();
  }

  if (mutated.ok) {
    results.push({ entry, verdict: 'SURVIVED', baseline: baselineTail, failure: null, notKill: null });
    console.log(`\n>>> ${entry.id}: SURVIVED — the verdict did not branch on the mutated value.`);
    continue;
  }

  const notKill = classify(mutated.output);
  const failed = failingTests(mutated.output);
  const body = excerpt(mutated.output, entry.grep);
  console.log(body);

  if (notKill) {
    results.push({ entry, verdict: `NOT A KILL (${notKill})`, baseline: baselineTail, failure: body, notKill });
    console.log(`\n>>> ${entry.id}: NOT A KILL — ${notKill}.`);
    continue;
  }
  if (!failed.some((title) => title.includes(entry.grep))) {
    results.push({ entry, verdict: 'NOT A KILL (wrong assertion)', baseline: baselineTail, failure: body, notKill: 'wrong assertion' });
    console.log(`\n>>> ${entry.id}: NOT A KILL — failed tests were ${failed.join('; ')}, not the marker's own.`);
    continue;
  }
  results.push({ entry, verdict: 'KILLED', baseline: baselineTail, failure: body, notKill: null });
  console.log(`\n>>> ${entry.id}: KILLED by its own assertion.`);
}

console.log(`\n${'='.repeat(78)}\nSUMMARY\n${'='.repeat(78)}`);
for (const { entry, verdict } of results) {
  console.log(`${verdict.padEnd(30)} ${entry.marker.padEnd(16)} ${entry.id}`);
}
const bad = results.filter((result) => result.verdict !== 'KILLED');
console.log(`\n${results.length - bad.length}/${results.length} killed.`);
process.exit(bad.length === 0 ? 0 : 1);
