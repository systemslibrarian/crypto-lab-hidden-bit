import { describe, expect, it } from 'vitest';
import { runKnownAnswerTests } from './kats';

describe('published known-answer tests', () => {
  const results = runKnownAnswerTests();

  it.each(results)('$source matches byte for byte', ({ actual, expected, passed }) => {
    expect(actual).toBe(expected);
    expect(passed).toBe(true);
  });

  it('contains exactly the three declared vector cases', () => {
    expect(results.map(({ id }) => id)).toEqual(['aes-128', 'ecdsa-p256', 'ed25519']);
  });
});