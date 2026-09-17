import type { TextStyle } from 'react-native';

/**
 * Forkast design tokens: "ink and saffron".
 * Two full palettes (light and dark) plus a shared structural language.
 * Screens must always read from here, never from a literal hex value.
 */

export type ThemeName = 'light' | 'dark';

export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  /** Hairline between surfaces. Decorative, never the only thing defining a control. */
  border: string;
  /**
   * The border a control uses to prove it is a control. Held at 3:1 or better
   * against bg, which `border` is not and was never meant to be.
   */
  outline: string;
  text: string;
  muted: string;
  /** Saffron as ink: text, icons, the selected label. Legible on bg and surface. */
  accent: string;
  /** Saffron as a solid fill. Held at 3:1 against bg so the shape itself is visible. */
  accentFill: string;
  accentSoft: string;
  /** The label printed on accentFill. */
  accentInk: string;
  /** Fill for a control that is present but inactive. Solid, never a faded copy. */
  disabledFill: string;
  disabledInk: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  /** Solid colour painted behind a BlurView so the layer never reads as a hole. */
  blurFallback: string;
  /** Tint passed to expo-blur. */
  blurTint: 'light' | 'dark';
  /** Scrim for modal and sheet backdrops. */
  scrim: string;
};

/**
 * Saffron has to be two colours, not one.
 *
 * #F5A524 sits at 9.26:1 on the dark background and at 1.95:1 on the light one.
 * A single brand hex therefore cannot both fill a button and be read on paper
 * white: in light mode the enabled primary button was invisible as a shape and
 * its label unreadable as text. The dark palette keeps the original saffron and
 * the light palette uses a deeper burnt amber, which is the same colour family
 * at a luminance the light background can actually show.
 *
 * Every pairing here is asserted in __tests__/contrast.test.ts rather than
 * eyeballed. Change a value and that test tells you what it broke.
 */
const SAFFRON = '#F5A524';
const SAFFRON_DEEP = '#9A4D08';

export const palettes: Record<ThemeName, Palette> = {
  dark: {
    // The greys are a solved ramp, not a taste. Every step clears a measured
    // floor against the one below it, which is what stops a card, a chip and
    // the page reading as one flat sheet. The previous ramp sat every surface
    // within 1.09:1 of the background, so nothing lifted off anything and the
    // whole app looked monochrome.
    bg: '#08080B',
    surface: '#28282E',
    surfaceAlt: '#38383E',
    border: '#535359',
    outline: '#818187',
    text: '#FAFAF7',
    muted: '#B4B4BE',
    accent: SAFFRON,
    accentFill: SAFFRON,
    accentSoft: 'rgba(245, 165, 36, 0.18)',
    accentInk: '#0E0E10',
    disabledFill: '#3A3A42',
    disabledInk: '#B8B8C2',
    success: '#5CE08C',
    successSoft: 'rgba(92, 224, 140, 0.16)',
    danger: '#FF8F8F',
    dangerSoft: 'rgba(255, 143, 143, 0.16)',
    blurFallback: 'rgba(8, 8, 11, 0.72)',
    blurTint: 'dark',
    scrim: 'rgba(0, 0, 0, 0.66)',
  },
  light: {
    bg: '#F2F1EB',
    surface: '#FFFFFF',
    surfaceAlt: '#E6E5E1',
    border: '#BDBCB8',
    outline: '#84837F',
    text: '#14140F',
    muted: '#5A5A62',
    accent: SAFFRON_DEEP,
    accentFill: SAFFRON_DEEP,
    accentSoft: 'rgba(154, 77, 8, 0.12)',
    accentInk: '#FFFFFF',
    disabledFill: '#DCDBD6',
    disabledInk: '#55555C',
    success: '#146B33',
    successSoft: 'rgba(20, 107, 51, 0.14)',
    danger: '#A81F1A',
    dangerSoft: 'rgba(168, 31, 26, 0.12)',
    blurFallback: 'rgba(242, 241, 235, 0.72)',
    blurTint: 'light',
    scrim: 'rgba(20, 20, 15, 0.42)',
  },
};

/**
 * A colour per cuisine, so a cuisine is recognisable before its name is read.
 *
 * Generated rather than picked: hues are spaced 36 degrees apart so they are
 * told apart by hue and not by brightness, and each one's lightness was walked
 * until it cleared 4.5:1 against the card it sits on in its own theme. Several
 * pairs are near identical in luminance, which is fine and deliberate; what
 * must not happen is two cuisines that are the same hue.
 *
 * Used as ink and as a soft tint, never as a large fill, so no screen ever
 * carries ten saturated blocks at once.
 */
export const cuisineColors: Record<ThemeName, Record<string, string>> = {
  dark: {
    desi: '#D79256',
    american: '#E38793',
    italian: '#7ED345',
    chinese: '#D187E3',
    middle_eastern: '#45D3CA',
    japanese: '#E283B3',
    korean: '#A598E7',
    thai: '#B7D345',
    mexican: '#DF8F77',
    continental: '#6AA7DC',
  },
  light: {
    desi: '#98551B',
    american: '#C32238',
    italian: '#397114',
    chinese: '#A322C3',
    middle_eastern: '#14716B',
    japanese: '#BF2270',
    korean: '#3D22C3',
    thai: '#5B6C13',
    mexican: '#B2421F',
    continental: '#1E68A9',
  },
};

/**
 * Elevation, which does the job luminance cannot on a light theme.
 *
 * A white card on a near white page tops out around 1.08:1, and the only way to
 * push that higher is to dirty the page until it looks grey. So on light the
 * card is lifted with a shadow, and on dark it is lifted with the grey ramp
 * above, where shadows are close to invisible anyway.
 */
export const elevation: Record<ThemeName, object> = {
  dark: {},
  light: {
    shadowColor: '#14140F',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};

/** Very large corner radii are the core structural move. */
export const radius = {
  card: 28,
  input: 20,
  sheet: 20,
  tile: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Height reserved at the bottom of scroll views so the floating tab bar never covers content. */
export const layout = {
  screenPadding: spacing.xl,
  tabBarHeight: 64,
  tabBarInset: 18,
  scrollBottomInset: 120,
  hairline: 1,
} as const;

/**
 * Editorial type scale: large light-weight display numerals set against
 * tiny uppercase letterspaced labels.
 */
export const type = {
  /** 48 / 300. The hero numeral. */
  display: {
    fontSize: 48,
    fontWeight: '300',
    letterSpacing: -1.4,
    lineHeight: 54,
  } satisfies TextStyle,
  /** 34 / 300. Secondary numerals, for example streak counts in a pair. */
  displaySm: {
    fontSize: 34,
    fontWeight: '300',
    letterSpacing: -0.8,
    lineHeight: 40,
  } satisfies TextStyle,
  /** 26 / 300. Numerals inside a stat tile. */
  numeral: {
    fontSize: 26,
    fontWeight: '300',
    letterSpacing: -0.4,
    lineHeight: 32,
  } satisfies TextStyle,
  title: {
    fontSize: 21,
    fontWeight: '600',
    letterSpacing: -0.3,
    lineHeight: 27,
  } satisfies TextStyle,
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.1,
    lineHeight: 22,
  } satisfies TextStyle,
  body: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
  } satisfies TextStyle,
  caption: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
  } satisfies TextStyle,
  /** 11 / uppercase / letterSpacing 1. Always paired with the muted colour. */
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    lineHeight: 15,
    textTransform: 'uppercase',
  } satisfies TextStyle,
  /** 28. The star glyphs on the rating control, sized to be a comfortable tap. */
  star: {
    fontSize: 28,
    lineHeight: 34,
  } satisfies TextStyle,
  /** Same metrics as label but a touch softer, for inline meta text. */
  labelSoft: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.9,
    lineHeight: 15,
    textTransform: 'uppercase',
  } satisfies TextStyle,
} as const;

export type TypeToken = keyof typeof type;

export const tokens = { palettes, radius, spacing, layout, type } as const;
