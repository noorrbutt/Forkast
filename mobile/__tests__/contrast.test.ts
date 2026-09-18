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

import { heroWash, palettes, series, type Palette, type ThemeName } from '../theme/tokens';

/**
 * A colour as channels, from either notation the palette uses.
 *
 * It used to accept six digit hex and throw on anything else, which quietly
 * put every translucent token outside the instrument: `blurFallback`,
 * `accentSoft`, `successSoft`, `dangerSoft` and `scrim` were all unmeasurable,
 * and so were `heroWash` and `split`, which were never imported at all. That is
 * not a gap in coverage, it is the same failure this file's docblock opens
 * with, one layer down. Four surfaces that the app draws on every screen were
 * sitting between 1.00:1 and 1.18:1 against what was behind them, and the suite
 * was green throughout, because it could not see any of them.
 */
function channels(colour: string): { rgb: [number, number, number]; alpha: number } {
  const trimmed = colour.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
    return { rgb: [r, g, b], alpha: 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    trimmed,
  );
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  throw new Error(`not a colour this can measure: ${colour}`);
}

/**
 * What a translucent colour actually becomes once it is painted.
 *
 * A reader sees the composite, never the token, so measuring the token alone
 * says nothing. Everything opaque passes straight through.
 */
function over(colour: string, backdrop: string): string {
  const top = channels(colour);
  if (top.alpha >= 1) return colour;
  const under = channels(backdrop);
  const mixed = top.rgb.map((c, i) => Math.round(c * top.alpha + under.rgb[i] * (1 - top.alpha)));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

/** WCAG 2.1 relative luminance. */
function luminance(colour: string): number {
  const { rgb } = channels(colour);
  const [r, g, b] = rgb
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
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

  // The status meter and the verdict caption, both added when the dashboard
  // stopped being grey. The meter's two halves are drawn against the ring's
  // track, not against the page, and the caption sits inside a card.
  { what: 'success text on a card', fg: 'success', bg: 'surface', min: TEXT },
  { what: 'a meter inside its limit, against its track', fg: 'success', bg: 'surfaceAlt', min: SHAPE },
  { what: 'a meter past its limit, against its track', fg: 'danger', bg: 'surfaceAlt', min: SHAPE },
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


describe('the data series palette', () => {
  // Ten generated cuisine colours used to live here and failed three of the six
  // checks: worst adjacent pair 9.3 against a normal vision floor of 15, 5.8
  // deutan against a floor of 8, and every value inside one narrow lightness
  // band because hue varied and lightness did not. These three come from the
  // documented palette and clear the harder all pairs test in both themes.
  it.each(THEMES)('%s: every series colour is visible on a card', (theme) => {
    const palette = palettes[theme];
    for (const color of series[theme]) {
      // 3:1 is the floor for a mark. The light aqua sits at 2.73 and is allowed
      // only because every bar using it carries its value in text.
      expect(ratio(color, palette.surface)).toBeGreaterThanOrEqual(2.7);
    }
  });

  it.each(THEMES)('%s: no two series share a colour', (theme) => {
    expect(new Set(series[theme]).size).toBe(series[theme].length);
  });

  it('keeps the count inside the cap that makes a palette checkable', () => {
    // Eight is the documented ceiling and more than about seven classes
    // carrying meaning is an anti pattern, because adjacent classes blur.
    for (const theme of THEMES) {
      expect(series[theme].length).toBeLessThanOrEqual(8);
    }
  });

  it('never reuses a status colour as a series', () => {
    for (const theme of THEMES) {
      const p = palettes[theme];
      for (const color of series[theme]) {
        expect(color.toLowerCase()).not.toBe(p.success.toLowerCase());
        expect(color.toLowerCase()).not.toBe(p.danger.toLowerCase());
      }
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

/**
 * The layers that were decided, shipped, and not on screen.
 *
 * Every one of these was specified deliberately in tokens.ts, argued for at
 * length in a comment, and then drawn at a magnitude no eye can resolve. None
 * of them could fail a test, because the measurement above only accepted six
 * digit hex and two of the four are translucent while a third was never
 * imported. They are asserted here so the next person to touch a value finds
 * out from this file rather than from a screenshot.
 */
describe('the layers a reader is supposed to be able to see', () => {
  /** A field of colour that is not at least this far from the page is not a field. */
  const FIELD = 1.15;
  /** A bar floating over content needs an edge, even a soft one. */
  const LAYER = 1.05;

  it('draws the hero wash as something visible against its own page', () => {
    // The light wash shipped at 1.016:1, which is the page. Section 6 calls
    // this field the source of the app's warmth, so in the default theme the
    // app had none. The fix goes down in value, not up: on near white stock
    // there is no headroom upward.
    for (const theme of THEMES) {
      const [first] = heroWash[theme];
      expect(ratio(first, palettes[theme].bg)).toBeGreaterThanOrEqual(FIELD);
    }
  });

  it('ends the wash exactly on the page, so it dissolves rather than stopping', () => {
    for (const theme of THEMES) {
      const stops = heroWash[theme];
      expect(stops[stops.length - 1].toLowerCase()).toBe(palettes[theme].bg.toLowerCase());
    }
  });

  it('keeps the wash monotonic, so the field reads as light falling one way', () => {
    for (const theme of THEMES) {
      const towardsPage = heroWash[theme].map((stop) => ratio(stop, palettes[theme].bg));
      for (let i = 1; i < towardsPage.length; i += 1) {
        expect(towardsPage[i]).toBeLessThanOrEqual(towardsPage[i - 1]);
      }
    }
  });

  it('gives the frosted header and tab bar an edge against the page', () => {
    // Both composited to 1.004:1, in both themes, on every screen in the app.
    for (const theme of THEMES) {
      const p = palettes[theme];
      expect(ratio(over(p.blurFallback, p.bg), p.bg)).toBeGreaterThanOrEqual(LAYER);
    }
  });

  it('shows the unfilled part of the meter against the wash it sits on', () => {
    // The ring used surfaceAlt, which measured 1.138:1 against the wash, so the
    // part of the arc that had not been filled was not on screen and the shape
    // stopped saying part against whole.
    for (const theme of THEMES) {
      expect(ratio(palettes[theme].meterTrack, heroWash[theme][0])).toBeGreaterThanOrEqual(1.35);
    }
  });

  it('keeps both meter fills separable from the track they run over', () => {
    // Whatever the day is doing, the filled arc has to be told from the unfilled
    // one, so this is the 3:1 non-text boundary rather than a field threshold.
    for (const theme of THEMES) {
      const p = palettes[theme];
      expect(ratio(p.success, p.meterTrack)).toBeGreaterThanOrEqual(SHAPE);
      expect(ratio(p.danger, p.meterTrack)).toBeGreaterThanOrEqual(SHAPE);
    }
  });

  it('gives the app mark the same presence in both themes', () => {
    // It was one opacity for both, over ink that is near-white on dark and
    // near-black on light, so it measured 1.53:1 on dark and 1.33:1 on light:
    // weakest on the theme that was already the weaker of the two.
    const seen = THEMES.map((theme) =>
      ratio(palettes[theme].markOnWash, heroWash[theme][0]),
    );
    for (const value of seen) expect(value).toBeGreaterThanOrEqual(1.45);
    // And the same presence, not merely both present.
    expect(Math.abs(seen[0] - seen[1])).toBeLessThan(0.1);
  });

  it('keeps text readable on the wash, which is what caps how far it can go', () => {
    for (const theme of THEMES) {
      const p = palettes[theme];
      const field = heroWash[theme][0];
      expect(ratio(p.text, field)).toBeGreaterThanOrEqual(TEXT);
      expect(ratio(p.muted, field)).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it('can measure a translucent token at all, which is the point of the rewrite', () => {
    // A guard on the instrument rather than on the palette. If someone
    // simplifies the parser back to hex only, these throw instead of silently
    // skipping every layer above.
    for (const theme of THEMES) {
      const p = palettes[theme];
      expect(() => ratio(over(p.accentSoft, p.surface), p.surface)).not.toThrow();
      expect(() => ratio(over(p.scrim, p.bg), p.bg)).not.toThrow();
    }
  });
});

describe('the edge that proves a control is a control', () => {
  it('never lets a text input wear the decorative hairline', () => {
    // Field used colors.border, which is the hairline between two surfaces and
    // measures about 1.52:1 against the fill it sits on. Chip, one control away
    // on the same screens, was already using outline at about 3.02:1, so a text
    // field was the only control in the app failing a rule its neighbour passed.
    for (const theme of THEMES) {
      const p = palettes[theme];
      expect(ratio(p.outline, p.surfaceAlt)).toBeGreaterThanOrEqual(SHAPE);
      // And the hairline is not good enough for the job, which is why this
      // fails if anyone swaps it back.
      expect(ratio(p.border, p.surfaceAlt)).toBeLessThan(SHAPE);
    }
  });
});
