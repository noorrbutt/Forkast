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
  /**
   * Sage. Good states: a live streak, a day inside its target, a meal that is
   * not junk. Warm and in saffron's family rather than a stock mint, which read
   * as arriving from a component kit.
   */
  success: string;
  successSoft: string;
  /**
   * Terracotta. Junk flags, going over target, and destructive actions. A warm
   * rust rather than a generic red, for the same reason.
   *
   * It sits near saffron on the wheel, which a categorical palette would not
   * allow. Status colour is not categorical: it is reserved, and the guide
   * requires it to ship with an icon and a word, never colour alone, so the
   * difference between a button and a warning is never carried by hue. What it
   * does have to clear is text contrast, and it does on every surface.
   */
  danger: string;
  dangerSoft: string;
  /**
   * The unfilled part of a meter.
   *
   * Not `surfaceAlt`, which is what the ring used to use. A meter sits on the
   * hero wash rather than on the page, and against the wash `surfaceAlt`
   * measured 1.138:1, so the part of the ring that had not been filled was not
   * on screen and the shape stopped reading as part against whole. This is the
   * one grey chosen to be seen against the wash while still leaving 3:1 to the
   * fills that run over it.
   */
  meterTrack: string;
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
    bg: '#0A0908',
    surface: '#2B2927',
    surfaceAlt: '#3B3937',
    border: '#58544F',
    outline: '#89827A',
    text: '#FAF7F2',
    muted: '#BCB5AC',
    accent: SAFFRON,
    accentFill: SAFFRON,
    accentSoft: 'rgba(245, 165, 36, 0.18)',
    accentInk: '#0E0E10',
    disabledFill: '#3D3A36',
    disabledInk: '#BCB5AC',
    success: '#87AF6A',
    successSoft: 'rgba(135, 175, 106, 0.18)',
    danger: '#DF8F77',
    dangerSoft: 'rgba(223, 143, 119, 0.18)',
    meterTrack: '#4A443E',
    // Derived from this theme's own surface rather than hand picked. The old
    // pair composited to 1.004:1 against the page in BOTH themes, so the
    // frosted header and the floating tab bar, which are on every screen in
    // the app, had no visible edge and read as holes.
    blurFallback: 'rgba(43, 41, 39, 0.85)',
    blurTint: 'dark',
    scrim: 'rgba(0, 0, 0, 0.66)',
  },
  light: {
    bg: '#F4F1EE',
    surface: '#FDFBFA',
    surfaceAlt: '#E5E1DC',
    border: '#BFB7AE',
    outline: '#897F73',
    text: '#17140F',
    muted: '#5E574D',
    accent: SAFFRON_DEEP,
    accentFill: SAFFRON_DEEP,
    accentSoft: 'rgba(154, 77, 8, 0.12)',
    accentInk: '#FFFFFF',
    disabledFill: '#DED9D2',
    disabledInk: '#5E574D',
    success: '#4E6A39',
    successSoft: 'rgba(78, 106, 57, 0.14)',
    danger: '#A54427',
    dangerSoft: 'rgba(165, 68, 39, 0.12)',
    meterTrack: '#C7BBA8',
    blurFallback: 'rgba(253, 251, 250, 0.85)',
    blurTint: 'light',
    scrim: 'rgba(20, 20, 15, 0.42)',
  },
};

/**
 * Colour for data, and nothing else.
 *
 * Three slots, taken from the documented categorical palette rather than
 * invented, because invented ones do not survive the checks. The ten cuisine
 * colours that used to live here failed three of six: worst adjacent pair 9.3
 * against a normal vision floor of 15, 5.8 deutan against a floor of 8, and
 * every value inside one narrow lightness band because hue varied and lightness
 * did not. The method caps a categorical palette at eight anyway, and calls more
 * than about seven classes carrying meaning an anti pattern.
 *
 * These three clear every check on the harder all pairs test in both themes,
 * which is what lets any two of them sit next to each other. Assigned in fixed
 * order, never cycled, and never reused for a status.
 *
 * The light aqua sits at 2.73:1, which the validator allows only where the value
 * is readable another way, so every bar using it carries its number in text.
 */
export const series: Record<ThemeName, string[]> = {
  dark: ['#3987E5', '#D95926', '#199E70'],
  light: ['#2A78D6', '#EB6834', '#1BAF7A'],
};

/**
 * The two halves of a day's calories: what was junk, and what was not.
 *
 * Sage for the food that was fine, terracotta for the food that was not. Warm,
 * in the same family as the rest of the app, and nothing like the stock
 * red-against-green those two states usually get.
 *
 * These are not `success` and `danger`. Those are reserved status colours and a
 * chart series may not borrow a meaning it does not have, so this is a separate
 * pair tuned for the one job of being told apart as adjacent fills.
 *
 * Tuned, specifically, because the obvious choice does not work. Sage and
 * terracotta at the palette's own lightness sit at L 0.708 and 0.726, which is
 * so nearly identical that under simulated deuteranopia the two are 2.4 apart
 * in OKLab: red-green colour blindness collapses the hue difference and there
 * is no lightness difference left underneath it. Roughly one man in twelve
 * would have seen one flat bar. Holding the hues and pulling the lightnesses
 * apart takes that to 6.3 on dark and 6.0 on light, against a normal-vision
 * separation above 20 in both.
 *
 * Six is a floor rather than a target, and it is only legal alongside a second
 * way of telling the two apart. There are three here: junk is always the top
 * segment, a 2px gap of the surface colour runs between the fills, and the
 * legend pairs each swatch with its word.
 */
export const split: Record<ThemeName, { junk: string; clean: string }> = {
  dark: { junk: '#D3795E', clean: '#5F952D' },
  light: { junk: '#B83B0E', clean: '#4C6F2F' },
};

/**
 * The wash behind the one number a screen leads with.
 *
 * The reference apps get most of their warmth from a soft colour field sitting
 * under the hero rather than from anything structural, and a flat surface
 * behind a big number is what made this app read as austere. Low saturation and
 * a narrow hue range on purpose: it should feel like light falling on the page,
 * not like a decorative gradient, and the number on top of it still has to
 * clear contrast, which is why the stops stay close to the page colour.
 */
export const heroWash: Record<ThemeName, string[]> = {
  dark: ['#2A2018', '#1A1512', '#0A0908'],
  // The light stops go DOWN in value, not up. The page already sits at L 0.96,
  // so there is no headroom upward and the previous first stop, #FBEEDC,
  // measured 1.016:1 against it: the field the guide calls the source of the
  // app's warmth was specified, shipped, and not on screen. A field of colour
  // on near-white stock is made by adding ink. The last stop is still exactly
  // bg, so the wash dissolves rather than ending on a line.
  light: ['#E9DDCD', '#EEE8E1', '#F4F1EE'],
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
  /**
   * How wide a column of content is allowed to get.
   *
   * The guide requires the content column to be capped and centred, because a
   * form running the full width of a tablet or a browser is not a design. These
   * two numbers used to be declared in nine separate screen files, each with its
   * own near identical comment, and three screens had simply forgotten to do it
   * at all: there was nothing to inherit, so every screen had to remember.
   *
   * `content` is the reading measure: a dashboard, a diary, a settings list.
   * `form` is narrower, because a column of short controls looks abandoned in a
   * wide one and a label sitting 500pt from its field is harder to read, not
   * easier.
   */
  contentWidth: 560,
  formWidth: 420,
} as const;

/**
 * Editorial type scale: large light-weight display numerals set against
 * tiny uppercase letterspaced labels.
 */
  /**
 * The typeface, named per weight.
 *
 * React Native has no synthetic weights: on iOS and Android `fontWeight` only
 * selects among the cuts actually registered, so a family is named per weight
 * rather than set once with a numeric weight beside it. Getting this wrong is
 * silent, and it fails in exactly the direction that matters here, by falling
 * back to the regular cut.
 *
 * That silent fallback is what the app shipped with. With no family at all,
 * every platform substituted its own: SF on iOS, Roboto or an OEM replacement
 * on Android, whatever the browser defaults to on web. The whole scale above
 * `title` is 300, and 300 is precisely where those disagree, because several
 * OEM Android faces carry no Light cut and quietly render Regular. The most
 * distinctive decision in this app was the one least likely to survive
 * somebody else's phone.
 *
 * Figtree, for three checkable reasons rather than a preference. It ships a
 * real 300. It carries the `tnum` feature, without which the tabular figures
 * the scale asks for below would be a no-op. And the four cuts used here come
 * to 156KB, which is a launch cost worth paying once.
 *
 * `fontWeight` stays on every token beside the family. It is what web reads,
 * since react-native-web maps the family to CSS and needs the weight to pick
 * the right @font-face.
 */
const FAMILY = {
  light: 'Figtree_300Light',
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
} as const;

  /**
   * Lining, fixed-advance figures on every token that sets a number.
   *
   * The whole type scale above `title` exists to set figures, and all of it was
   * proportional. Two consequences, both visible today. A figure that changes in
   * place jitters: the dashboard's eaten and burned numbers physically move as
   * the day's totals change, because a 1 is narrower than a 7. And a column of
   * numbers does not line up, so the diary, the plan and the month comparison
   * each right-align a column that then agrees on its right edge and nowhere
   * else. The repo had exactly one `fontVariant`, hand-rolled at one of those
   * four sites, with the correct reasoning written beside it.
   *
   * Deliberately NOT on `subtitle`. That is the row-label and button-label
   * token, so it would set dish names and running sentences in fixed-advance
   * figures, where a 1 takes a full figure width and leaves a hole.
   */
export const type = {
  /**
   * 64 / 300. Reserved for the one number or headline a screen leads with, at
   * most once per screen.
   *
   * Derived rather than chosen. Measuring the reference screens, a hero numeral
   * runs about 58pt on one and 38pt on the other, supporting numerals about
   * 28pt and captions about 12pt, so the hero to caption ratio sits near 5x. At
   * 64 this is 4.92x caption and 2.46x numeral, inside that range, and 1.33x
   * display, which is enough that a hero can never be mistaken for a page
   * title. Those two sharing one size is why nothing on the old screens was
   * dominant.
   *
   * The component that renders this steps the size down for long values and
   * large system text, so the rule lives in one place rather than in every
   * caller. See DESIGN_STYLE_GUIDE.md section 4.
   */
  hero: {
    fontFamily: FAMILY.light,
    fontSize: 64,
    fontWeight: '300',
    letterSpacing: -2.2,
    lineHeight: 70,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  /** 48 / 300. A page title, or a secondary numeral on a screen with a hero. */
  display: {
    fontFamily: FAMILY.light,
    fontSize: 48,
    fontWeight: '300',
    letterSpacing: -1.4,
    lineHeight: 54,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  /** 34 / 300. Secondary numerals, for example streak counts in a pair. */
  displaySm: {
    fontFamily: FAMILY.light,
    fontSize: 34,
    fontWeight: '300',
    letterSpacing: -0.8,
    lineHeight: 40,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  /** 26 / 300. Numerals inside a stat tile. */
  numeral: {
    fontFamily: FAMILY.light,
    fontSize: 26,
    fontWeight: '300',
    letterSpacing: -0.4,
    lineHeight: 32,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  title: {
    fontFamily: FAMILY.semibold,
    fontSize: 21,
    fontWeight: '600',
    letterSpacing: -0.3,
    lineHeight: 27,
  } satisfies TextStyle,
  subtitle: {
    fontFamily: FAMILY.semibold,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.1,
    lineHeight: 22,
  } satisfies TextStyle,
  body: {
    fontFamily: FAMILY.regular,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
  } satisfies TextStyle,
  caption: {
    fontFamily: FAMILY.regular,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
  } satisfies TextStyle,
  /** 11 / uppercase / letterSpacing 1. Always paired with the muted colour. */
  /**
   * 11 / 600 uppercase. RESTRICTED: the tab bar and chart axis or legend text
   * only. See DESIGN_STYLE_GUIDE.md section 4. Anywhere else it is the eyebrow
   * this app is trying to stop wearing.
   */
  label: {
    fontFamily: FAMILY.semibold,
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
  /**
   * 12 / 500, sentence case. The quiet small label.
   *
   * It used to be uppercase with letterspacing, like `label`. A tracked out
   * uppercase eyebrow above every block is one of the named tells of generated
   * design, and Forkast wore it on seven screens through SectionLabel, Field
   * and the ListGroup title. Sentence case is what a field label looks like
   * when it is there to be read rather than to decorate.
   */
  labelSoft: {
    fontFamily: FAMILY.medium,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 16,
  } satisfies TextStyle,
} as const;

/**
 * The cuts, for the few call sites that need a weight the token does not carry.
 *
 * A bare `fontWeight` override no longer does anything on iOS or Android now
 * that the family is named per weight, so a component that wants a bolder label
 * than its token asks for has to name the cut. Anything not in here is not
 * loaded and will fall back silently.
 */
export const fonts = FAMILY;

export type TypeToken = keyof typeof type;

export const tokens = { palettes, radius, spacing, layout, type } as const;
