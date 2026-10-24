import { planSlotLabel } from '../app/(tabs)/plan';

describe('planSlotLabel', () => {
  test.each([
    ['Breakfast', 'Breakfast'],
    ['Lunch', 'Lunch'],
    ['Dinner', 'Dinner'],
    ['Sehri', 'Sehri'],
    ['Iftar', 'Iftar'],
    // The one case a bare titleCase would get wrong: "Late" alone, not
    // "Late night" -- this is why the lookup is lowercased first.
    ['Late', 'Late night'],
  ])('model-cased %s -> %s, regardless of the plan\'s own style', (slot, expected) => {
    expect(planSlotLabel(slot, 'standard')).toBe(expected);
    expect(planSlotLabel(slot, 'iftar_sehri')).toBe(expected);
  });

  test('an unrecognised slot still falls back to a plain titleCase', () => {
    expect(planSlotLabel('midnight snack', 'standard')).toBe('Midnight Snack');
    expect(planSlotLabel('midnight snack', 'iftar_sehri')).toBe('Midnight Snack');
  });
});
