/**
 * Every colour pairing the app actually renders, measured.
 *
 * This file exists because the previous test for the same bug passed while the
 * bug was on screen. It asked getByRole('button', { name: 'Create an account' })
 * and got a node back, because Button sets accessibilityRole="button"
 * unconditionally. That assertion cannot fail however invisible the control is,
 * and the control was invisible: a #F2F2EF fill on a #FAFAF7 page, 1.07:1, with
 * a border at 1.17:1. Only the label was visible, so the user correctly
 * reported that there was no button, and the suite disagreed.
 *
 * Contrast is a number, so it can be asserted like one. WCAG 2.1 asks 4.5:1 for
 * body text, 3:1 for large text, and 3:1 for the visual boundary of a control
 * against what sits behind it (1.4.11 Non-text Contrast), which is exactly the
 * rule the secondary button was failing.
 */

import { cuisineColors, palettes, type Palette, type ThemeName } from '../theme/tokens';

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a six digit hex colour: ${hex}`);
  const channels = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = Object.keys(palettes) as ThemeName[];

/** 4.5:1, the floor for text small enough to read rather than scan. */
const TEXT = 4.5;
/** 3:1, the floor for the boundary of a control (WCAG 1.4.11). */
const SHAPE = 3;

type Case = { what: string; fg: keyof Palette; bg: keyof Palette; min: number };

const CASES: Case[] = [
  // Body copy, on each of the three surfaces a card can sit on.
  { what: 'body text on the page', fg: 'text', bg: 'bg', min: TEXT },
  { what: 'body text on a card', fg: 'text', bg: 'surface', min: TEXT },
  { what: 'body text on a raised card', fg: 'text', bg: 'surfaceAlt', min: TEXT },

  // Muted carries real content: hints, captions, timestamps, empty state copy.
  { what: 'muted text on the page', fg: 'muted', bg: 'bg', min: TEXT },
  { what: 'muted text on a card', fg: 'muted', bg: 'surface', min: TEXT },

  // Saffron is used as ink for selected labels and section eyebrows.
  { what: 'accent used as text on the page', fg: 'accent', bg: 'bg', min: TEXT },
  { what: 'accent used as text on a card', fg: 'accent', bg: 'surface', min: TEXT },

  // The primary button. The fill has to be visible as a shape and the label
  // readable on it. This is the pairing that was broken in light theme.
  { what: 'primary button fill against the page', fg: 'accentFill', bg: 'bg', min: SHAPE },
  { what: 'primary button label on its fill', fg: 'accentInk', bg: 'accentFill', min: TEXT },

  // The secondary button proves it is a button with its outline alone.
  { what: 'control outline against the page', fg: 'outline', bg: 'bg', min: SHAPE },
  { what: 'control outline against a card', fg: 'outline', bg: 'surface', min: SHAPE },

  // A disabled control still has to read as a control, and its label still has
  // to be readable. Fading the whole thing to 50% satisfied neither.
  { what: 'disabled button fill against the page', fg: 'disabledFill', bg: 'bg', min: 1.1 },
  { what: 'disabled button label on its fill', fg: 'disabledInk', bg: 'disabledFill', min: TEXT },

  // Controls sit on cards, not on the page, and that is the pairing the old
  // version of this file never checked. A chip fill at 1.09:1 against the card
  // under it has no visible edge, so a row of them reads as one grey blob, and
  // every assertion here passed while that was on screen.
  { what: 'raised fill against the card under it', fg: 'surfaceAlt', bg: 'surface', min: 1.2 },
  { what: 'a card against the page', fg: 'surface', bg: 'bg', min: 1.05 },
  { what: 'control outline against a raised fill', fg: 'outline', bg: 'surfaceAlt', min: SHAPE },
  { what: 'body text on a raised fill', fg: 'text', bg: 'surfaceAlt', min: TEXT },
  { what: 'muted text on a raised fill', fg: 'muted', bg: 'surfaceAlt', min: TEXT },
  { what: 'accent fill against a card', fg: 'accentFill', bg: 'surface', min: SHAPE },
  { what: 'accent text on a raised fill', fg: 'accent', bg: 'surfaceAlt', min: TEXT },

  // Destructive and positive text.
  { what: 'danger text on the page', fg: 'danger', bg: 'bg', min: TEXT },
  { what: 'danger text on a card', fg: 'danger', bg: 'surface', min: TEXT },
  { what: 'success text on the page', fg: 'success', bg: 'bg', min: TEXT },
];

describe.each(THEMES)('%s theme', (theme) => {
  const palette = palettes[theme];

  it.each(CASES)('$what clears $min to 1', ({ fg, bg, min }) => {
    const got = ratio(palette[fg] as string, palette[bg] as string);
    // The received value is in the message because the useful thing to know on
    // a failure is how far short it fell, not merely that it did.
    expect({ ratio: Number(got.toFixed(2)), min }).toEqual({
      ratio: expect.any(Number),
      min,
    });
    expect(got).toBeGreaterThanOrEqual(min);
  });
});

describe('the regression this file was written for', () => {
  it('no longer renders a button that is invisible against the page', () => {
    // The exact pairing that shipped: surfaceAlt fill, border hairline, on bg.
    for (const theme of THEMES) {
      const p = palettes[theme];
      const asShipped = Math.max(ratio(p.surfaceAlt, p.bg), ratio(p.border, p.bg));
      expect(asShipped).toBeLessThan(SHAPE);

      // What the secondary button uses now instead.
      expect(ratio(p.outline, p.bg)).toBeGreaterThanOrEqual(SHAPE);
    }
  });

  it('keeps saffron legible in both themes by letting it differ between them', () => {
    // One brand hex could not do this job: #F5A524 is 9.26:1 on ink and
    // 1.95:1 on paper. Any single value fails one of the two.
    expect(palettes.dark.accent).not.toEqual(palettes.light.accent);
    for (const theme of THEMES) {
      expect(ratio(palettes[theme].accent, palettes[theme].bg)).toBeGreaterThanOrEqual(TEXT);
    }
  });
});


describe('cuisine colours', () => {
  it.each(THEMES)('%s: every cuisine is readable on a card', (theme) => {
    const palette = palettes[theme];
    for (const [cuisine, color] of Object.entries(cuisineColors[theme])) {
      const got = ratio(color, palette.surface);
      expect({ cuisine, ok: got >= TEXT }).toEqual({ cuisine, ok: true });
    }
  });

  it.each(THEMES)('%s: every cuisine is readable on the page too', (theme) => {
    const palette = palettes[theme];
    for (const [cuisine, color] of Object.entries(cuisineColors[theme])) {
      const got = ratio(color, palette.bg);
      expect({ cuisine, ok: got >= TEXT }).toEqual({ cuisine, ok: true });
    }
  });

  it('gives both themes the same set of cuisines', () => {
    expect(Object.keys(cuisineColors.dark).sort()).toEqual(Object.keys(cuisineColors.light).sort());
  });

  it('never gives two cuisines the same colour', () => {
    for (const theme of THEMES) {
      const values = Object.values(cuisineColors[theme]);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe('the flatness this palette was rebuilt to fix', () => {
  it('separates every surface from the one beneath it', () => {
    // Before: bg, surface, surfaceAlt and border sat within 1.09:1 of each
    // other, so a card, a chip and the page were the same sheet of paper and
    // the app read as monochrome however much accent was sprinkled on it.
    for (const theme of THEMES) {
      const p = palettes[theme];
      expect(ratio(p.surfaceAlt, p.surface)).toBeGreaterThan(ratio(p.surface, p.surface) + 0.15);
      expect(ratio(p.border, p.surface)).toBeGreaterThanOrEqual(1.8);
    }
  });

  it('keeps a control edge visible on dark, where shadows cannot help', () => {
    // Light themes can lift a card with a shadow. Dark themes cannot, so the
    // grey ramp has to do the whole job there.
    expect(ratio(palettes.dark.surface, palettes.dark.bg)).toBeGreaterThanOrEqual(1.3);
  });
});
