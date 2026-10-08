/**
 * Dish names as they are shown, not as they are stored.
 *
 * "chocolate brownie" sat lowercase in the diary beside "Hot N Spicy". The fix
 * is display only: what was typed is what is stored and sent, so a relog or a
 * search matches the user's own words exactly.
 */

import { displayDish } from '../lib/format';

describe('displayDish', () => {
  it('capitalises the first letter of every word', () => {
    expect(displayDish('chocolate brownie')).toBe('Chocolate Brownie');
  });

  it('leaves the rest of each word exactly as typed', () => {
    expect(displayDish('Hot N Spicy')).toBe('Hot N Spicy');
    expect(displayDish("McDonald's BBQ wrap")).toBe("McDonald's BBQ Wrap");
  });

  it('keeps the spacing it was given', () => {
    expect(displayDish('daal  chawal')).toBe('Daal  Chawal');
  });

  it('has nothing to show for nothing', () => {
    expect(displayDish(null)).toBe('');
    expect(displayDish(undefined)).toBe('');
    expect(displayDish('')).toBe('');
  });
});
