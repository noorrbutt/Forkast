/**
 * The one line under the save hero. Three tones, and the boundary between
 * them is the interesting part: a junk category never gets scolded, in
 * keeping with the same soft wording the streak message already uses.
 */

import { saveReaction } from '../lib/format';

const category = (overrides: Partial<{ name: string; slug: string; is_junk: boolean }>) => ({
  name: 'Pizza',
  slug: 'pizza',
  is_junk: false,
  ...overrides,
});

describe('saveReaction', () => {
  it('names a light category as a good sign', () => {
    expect(saveReaction(category({ name: 'Salad', slug: 'salad' }))).toBe(
      "Nice, that's salad — lighter one today.",
    );
  });

  it('never scolds a junk category', () => {
    const line = saveReaction(category({ name: 'Fries', slug: 'fries', is_junk: true }));

    expect(line).not.toMatch(/should|shouldn't|bad|guilt|sorry/i);
    expect(line).toBe('Logged. Everything counts, even this one.');
  });

  it('gives everything else a plain acknowledgement', () => {
    expect(saveReaction(category({ name: 'Biryani', slug: 'biryani' }))).toBe(
      'Nice, biryani is on the board.',
    );
  });

  it('falls back when there is no category at all', () => {
    expect(saveReaction(null)).toBe('Logged. On the board.');
  });
});
