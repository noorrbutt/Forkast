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
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
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

const ACCENT = '#F5A524';

export const palettes: Record<ThemeName, Palette> = {
  dark: {
    bg: '#0E0E10',
    surface: '#18181B',
    surfaceAlt: '#202024',
    border: '#26262B',
    text: '#FAFAF7',
    muted: '#8B8B93',
    accent: ACCENT,
    accentSoft: 'rgba(245, 165, 36, 0.16)',
    accentInk: '#0E0E10',
    success: '#4ADE80',
    successSoft: 'rgba(74, 222, 128, 0.16)',
    danger: '#F87171',
    dangerSoft: 'rgba(248, 113, 113, 0.16)',
    blurFallback: 'rgba(14, 14, 16, 0.72)',
    blurTint: 'dark',
    scrim: 'rgba(0, 0, 0, 0.6)',
  },
  light: {
    bg: '#FAFAF7',
    surface: '#FFFFFF',
    surfaceAlt: '#F2F2EF',
    border: '#E8E8E4',
    text: '#0E0E10',
    muted: '#6E6E76',
    accent: ACCENT,
    accentSoft: 'rgba(245, 165, 36, 0.14)',
    accentInk: '#0E0E10',
    success: '#4ADE80',
    successSoft: 'rgba(74, 222, 128, 0.18)',
    danger: '#F87171',
    dangerSoft: 'rgba(248, 113, 113, 0.18)',
    blurFallback: 'rgba(250, 250, 247, 0.72)',
    blurTint: 'light',
    scrim: 'rgba(14, 14, 16, 0.35)',
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
