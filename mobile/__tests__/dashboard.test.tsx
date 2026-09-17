/**
 * The dashboard, checked as a composition rather than as a render.
 *
 * Every assertion here is a rule from DESIGN_STYLE_GUIDE.md that the old screen
 * broke, written so that breaking it again fails the build. "It renders" is not
 * one of them: the eleven card dashboard rendered perfectly well, and that was
 * the whole problem.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Svg from 'react-native-svg';

// Jest hoists mock factories above these declarations, so the names they reach
// into have to carry the mock prefix that marks them as safe.
const mockPush = jest.fn();
const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    navigate: mockNavigate,
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
  };
});

import DashboardScreen from '../app/(tabs)/index';
import { Card, Icon, ListGroup } from '../components/ui';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider, palettes, split, type } from '../theme';
import { series } from '../theme/tokens';
import type { Dashboard, Today } from '../lib/types';

const mockedApi = api as unknown as { get: jest.Mock; put: jest.Mock; delete: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;

/** An iPhone 14, so the safe area the screen lays out against is a real one. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      // gcTime 0 so no collection timer outlives the test. The default five
      // minutes leaves a handle open and Jest warns that it could not exit.
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={METRICS}>
          <AuthProvider>{children}</AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const FORTNIGHT = Array.from({ length: 14 }, (_, index) => ({
  day: `2026-09-${String(index + 4).padStart(2, '0')}`,
  calories: 1200 + index * 90,
  // Some days all junk, some none, most in between, so the stack has every
  // shape to draw: a full terracotta bar, a full sage one, and a split.
  junk_calories: index % 5 === 0 ? 0 : Math.round((1200 + index * 90) * (index % 4) * 0.2),
  burned: index % 3 === 0 ? 0 : 150 + index * 10,
}));

const UNDER: Today = { target: 2000, consumed: 1800, burned: 200, net: 1600, remaining: 400 };
const OVER: Today = { target: 2000, consumed: 2400, burned: 200, net: 2200, remaining: -200 };
const NO_TARGET: Today = { target: null, consumed: 1400, burned: 0, net: 1400, remaining: null };

function dashboard(today: Today, logs = 12): Dashboard {
  return {
    junk_ratio: 0.3,
    total_calories: 18_400,
    // Burned calories can be entered before any meal is, so an account with
    // nothing on it is one with neither, not merely one without logs.
    total_burned: logs === 0 ? 0 : 2_100,
    net_calories: 16_300,
    logs_count: logs,
    today,
    calories_by_day: FORTNIGHT,
    top_category: { category_id: 3, name: 'Biryani', count: 5 },
    top_restaurant: { restaurant_id: null, name: 'Home cooked', count: 4 },
    best_fun_meals: [{ dish_name: 'Nihari', fun_scale: 5, restaurant_name: null }],
    burn_equivalents: { walking_minutes: 210, running_minutes: 95, cycling_minutes: 130 },
  };
}

const TREND = {
  this_month: {
    month: '2026-09-01',
    total_calories: 18_400,
    meals_logged: 12,
    junk_ratio: 0.3,
    avg_calories_per_day: 1_530,
    days_counted: 12,
  },
  last_month: {
    month: '2026-08-01',
    total_calories: 21_000,
    meals_logged: 18,
    junk_ratio: 0.4,
    avg_calories_per_day: 1_680,
    days_counted: 31,
  },
  change: {
    total_calories: -2_600,
    meals_logged: -6,
    junk_ratio: -0.1,
    avg_calories_per_day: -150,
  },
};

function signedInWith(today: Today, logs = 12) {
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/me') {
      return {
        data: {
          id: '01a0-aaaa',
          email: 'noor@example.com',
          timezone: 'Asia/Karachi',
          goal: 'maintain',
          daily_calorie_target: today.target,
          created_at: '2026-01-04T09:00:00Z',
        },
      };
    }
    if (url === '/dashboard') return { data: dashboard(today, logs) };
    if (url === '/trend') return { data: TREND };
    // Nothing entered, which is the state the burn input opens in.
    if (url === '/burn/today') return { data: null };
    return { data: null };
  });
}

type Screen = ReturnType<typeof render>;

function flat(style: unknown): { fontSize?: number; textTransform?: string } {
  return (StyleSheet.flatten(style as never) ?? {}) as {
    fontSize?: number;
    textTransform?: string;
  };
}

/** Every font size actually rendered, icon glyphs included. */
function textSizes(screen: Screen): number[] {
  return screen
    .UNSAFE_queryAllByType(Text)
    .map((node) => flat(node.props.style).fontSize)
    .filter((size): size is number => typeof size === 'number');
}

/**
 * The nearest real view above a component instance.
 *
 * An icon is several composites deep by the time it reaches a glyph, so asking
 * its immediate parent for siblings finds only the icon's own insides and the
 * check passes without ever looking at a heading.
 */
function hostParentOf(node: { parent: unknown }) {
  let current = (node as { parent: any }).parent;
  while (current && typeof current.type !== 'string') current = current.parent;
  return current as { findAllByType: (t: unknown) => { props: Record<string, unknown> }[] } | null;
}

/** Section 4 headings: the 21pt title and the 11pt uppercase label. */
const HEADING_SIZES = new Set<number>([type.title.fontSize, type.label.fontSize]);

/** Icons drawn in the same view as a heading, which Section 10 bans outright. */
function iconsBesideHeadings(screen: Screen) {
  return screen.UNSAFE_queryAllByType(Icon).filter((icon) => {
    const host = hostParentOf(icon);
    if (!host) return false;
    return host
      .findAllByType(Text)
      .some((node) => HEADING_SIZES.has(flat(node.props.style).fontSize ?? 0));
  });
}

/** Every tracked out uppercase label on the screen, by the words it carries. */
function uppercaseLabels(screen: Screen): string[] {
  return screen
    .UNSAFE_queryAllByType(Text)
    .filter((node) => flat(node.props.style).textTransform === 'uppercase')
    .map((node) => String(node.props.children ?? ''));
}

/** Renders the screen and waits for the day to arrive. */
async function open(today: Today) {
  signedInWith(today, 12);
  const screen = render(<DashboardScreen />, { wrapper });
  await waitFor(() => expect(screen.getByText('Calories by day')).toBeTruthy());
  // The burn input runs a query of its own, which settles after this one. Left
  // to land on its own it updates outside act, and that warning is noise that
  // hides the next real one.
  // A timer, not just a microtask: react-query batches its notifications onto
  // setTimeout, so a resolved promise alone does not flush the re-render.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return screen;
}

/** Renders the screen for an account that has logged nothing at all. */
async function openEmpty() {
  signedInWith(NO_TARGET, 0);
  const screen = render(<DashboardScreen />, { wrapper });
  await waitFor(() => expect(screen.getByText('Nothing to count yet')).toBeTruthy());
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('hierarchy', () => {
  it('puts exactly one element at the reserved hero size', async () => {
    const screen = await open(UNDER);

    // 1,600 is the net, which is the number the ring measures. Twice at this
    // size is a rule violation rather than a judgement call.
    const hero = textSizes(screen).filter((size) => size >= 44);

    expect(hero).toEqual([type.hero.fontSize]);
    expect(screen.getByText('1,600')).toBeTruthy();
  });

  it('leaves a full step of the scale between the hero and whatever is second', async () => {
    const screen = await open(UNDER);

    const sizes = [...new Set(textSizes(screen))].sort((a, b) => b - a);

    expect(sizes[0]).toBe(type.hero.fontSize);
    // The two supporting figures, eaten and burned. Everything else is smaller
    // again. Without this gap the old screen had a 48 beside a 48 and nothing
    // was dominant.
    expect(sizes[1]).toBeLessThanOrEqual(type.displaySm.fontSize);
  });

  it('shows the two numbers the hero is made of, and only those two', async () => {
    const screen = await open(UNDER);

    expect(screen.getByText('1,800')).toBeTruthy();
    expect(screen.getByText('kcal eaten')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
    expect(screen.getByText('kcal burned')).toBeTruthy();

    const supporting = textSizes(screen).filter((size) => size === type.displaySm.fontSize);
    expect(supporting).toHaveLength(2);
  });

  it('stays under the six card ceiling', async () => {
    const screen = await open(UNDER);

    const surfaces =
      screen.UNSAFE_queryAllByType(Card).length + screen.UNSAFE_queryAllByType(ListGroup).length;

    // Was eleven. The hero is not one of them, which is how the container
    // carries the hierarchy as well as the type.
    expect(surfaces).toBeLessThanOrEqual(6);
  });
});

describe('the ring', () => {
  it('says in words which number it is measuring', async () => {
    const screen = await open(UNDER);

    // A meter that moves for an unexplained reason is worse than no meter.
    expect(screen.getByText(/The ring measures net calories/)).toBeTruthy();
  });

  it('draws no ring when there is no target, and offers to set one', async () => {
    const screen = await open(NO_TARGET);

    expect(screen.UNSAFE_queryAllByType(Svg)).toHaveLength(0);
    expect(screen.getByText('Set a daily target')).toBeTruthy();
    expect(screen.getByText(/No daily target yet/)).toBeTruthy();
    // The figure still leads the screen; it just has nothing to be a
    // proportion of.
    expect(textSizes(screen).filter((size) => size >= 44)).toEqual([type.hero.fontSize]);
  });

  it('draws the ring once there is a target', async () => {
    const screen = await open(UNDER);

    expect(screen.UNSAFE_queryAllByType(Svg)).toHaveLength(1);
    expect(screen.getByText('400 kcal left')).toBeTruthy();
  });

  it('reads as over in words, not only in colour', async () => {
    const screen = await open(OVER);

    expect(screen.getByText('Over by 200 kcal')).toBeTruthy();
    expect(screen.getByText(/over/i)).toBeTruthy();
    expect(screen.getByText('2,200')).toBeTruthy();
  });
});

describe('icons and labels', () => {
  it('has no icon beside any heading', async () => {
    const screen = await open(UNDER);

    // Ten of these shipped on this one screen, which is a large part of why
    // the app read as templated.
    expect(iconsBesideHeadings(screen)).toHaveLength(0);
  });

  it('has no icon beside a heading in the empty state either', async () => {
    const screen = await openEmpty();

    // The one icon inside an empty state is allowed. A heading wearing one is
    // not, in either state.
    expect(iconsBesideHeadings(screen)).toHaveLength(0);
  });

  it('carries no uppercase eyebrow of its own', async () => {
    const screen = await open(UNDER);

    // Not one, anywhere. The chart is the one place the guide still permits the
    // restricted label token, for axis and legend text, and this chart spends
    // `caption` there instead, so zero is the right number on this screen.
    expect(uppercaseLabels(screen)).toEqual([]);
    expect(textSizes(screen)).not.toContain(type.label.fontSize);
  });

  it('writes its section headings in sentence case at title size', async () => {
    const screen = await open(UNDER);

    expect(flat(screen.getByText('Calories by day').props.style).fontSize).toBe(
      type.title.fontSize,
    );
    expect(screen.getByText('September against August')).toBeTruthy();
  });
});

describe('the chart', () => {
  it('names every series rather than leaving the colours to speak', async () => {
    const screen = await open(UNDER);

    // Three now. The eaten bar used to be one saffron block, which said how
    // much was eaten and nothing about what it was, and spent the brand colour
    // on a chart to say it.
    expect(screen.getByText('Junk')).toBeTruthy();
    expect(screen.getByText('Everything else')).toBeTruthy();
    expect(screen.getByText('Burned')).toBeTruthy();
  });

  it('never draws a data mark in the brand colour', async () => {
    // Saffron means "you can press this". A chart wearing it weakens that and
    // tells the reader nothing about the food.
    const screen = await open(UNDER);
    const chart = screen.getByLabelText(/Calories by day/);
    const fills = new Set<string>();

    const walk = (node: { props?: Record<string, unknown>; children?: unknown[] }) => {
      const style = flat((node.props as { style?: unknown })?.style) as {
        backgroundColor?: string;
      };
      if (style?.backgroundColor) fills.add(style.backgroundColor);
      for (const child of node.children ?? []) {
        if (child && typeof child === 'object') walk(child as never);
      }
    };
    walk(chart as never);

    expect(fills.size).toBeGreaterThan(0);
    expect([...fills]).not.toContain(palettes.dark.accentFill);
    expect([...fills]).not.toContain(palettes.light.accentFill);
  });

  it('splits a day by what the food was, not just how much of it there was', async () => {
    // Two days of 2,000 kcal, one all junk and one none, are the same bar
    // unless the bar is split. Both halves have to be drawn.
    const screen = await open(UNDER);
    const chart = screen.getByLabelText(/Calories by day/);
    const fills = new Set<string>();

    const walk = (node: { props?: Record<string, unknown>; children?: unknown[] }) => {
      const style = flat((node.props as { style?: unknown })?.style) as {
        backgroundColor?: string;
      };
      if (style?.backgroundColor) fills.add(style.backgroundColor);
      for (const child of node.children ?? []) {
        if (child && typeof child === 'object') walk(child as never);
      }
    };
    walk(chart as never);

    // Whichever theme the runner resolved to, both halves have to be present.
    const lower = [...fills].map((fill) => fill.toLowerCase());
    const theme = lower.includes(split.dark.junk.toLowerCase()) ? split.dark : split.light;

    expect(lower).toContain(theme.junk.toLowerCase());
    expect(lower).toContain(theme.clean.toLowerCase());
  });

  it('gives the bars a scale to be read against', async () => {
    const screen = await open(UNDER);

    // The tallest eaten day in the fixture.
    expect(screen.getByText('Tallest bar 2,370 kcal.')).toBeTruthy();
  });
});

describe('nothing logged yet', () => {
  it('invites an action instead of drawing a hero with no value behind it', async () => {
    const screen = await openEmpty();

    // No focal value yet, so no hero. An empty screen is an invitation to act,
    // not a hole to plug with a ring reading zero.
    expect(textSizes(screen).filter((size) => size >= 44)).toHaveLength(0);
    expect(screen.getByText('Log your first meal')).toBeTruthy();
  });
});

describe('colour on the dashboard', () => {
  /**
   * The screen was 87 percent greyscale, and worse than that above the fold:
   * thirteen painted roles in the hero block and exactly one of them carried any
   * chroma at all.
   *
   * The deeper fault was which one. The ring took a blue series colour inside
   * the target and a terracotta status colour past it, so the only two
   * elements that ever gained colour were the ones announcing a bad day. Doing
   * well was drawn entirely in grey, on a screen whose whole job is telling you
   * how today is going.
   */
  const fillsIn = (node: unknown): string[] => {
    const found: string[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const node = n as { props?: Record<string, unknown>; children?: unknown[] };
      const style = flat(node.props?.style) as { backgroundColor?: unknown };
      if (typeof style?.backgroundColor === 'string') found.push(style.backgroundColor);
      // The ring is SVG, so its colour is a stroke rather than a background,
      // and the wash is a gradient, so its colours are an array of stops.
      // react-native-svg does not keep the stroke as a hex string. It
      // processes it to an ARGB integer wrapped in { type, payload }, so
      // reading it as a string silently finds nothing and the test passes for
      // the wrong reason.
      const stroke = node.props?.stroke as unknown;
      if (typeof stroke === 'string') found.push(stroke);
      if (stroke && typeof stroke === 'object' && 'payload' in stroke) {
        const argb = (stroke as { payload?: unknown }).payload;
        if (typeof argb === 'number') {
          found.push(`#${(argb & 0xffffff).toString(16).padStart(6, '0')}`);
        }
      }
      const colors = node.props?.colors;
      if (Array.isArray(colors)) {
        for (const stop of colors) if (typeof stop === 'string') found.push(stop);
      }
      node.children?.forEach(walk);
    };
    walk(node);
    // A processed colour can come back as a number rather than a hex string, so
    // anything that is not a string is dropped rather than assumed.
    return found.filter((value) => typeof value === 'string').map((value) => value.toLowerCase());
  };





  it('never paints the meter in a data series colour', async () => {
    // series[0] is the only cold hue in the whole token file and it is named by
    // none of the rules the palette is built on. A meter is a status.
    const screen = await open(UNDER);
    const painted = fillsIn(screen.toJSON());

    for (const theme of ['dark', 'light'] as const) {
      expect(painted).not.toContain(series[theme][0].toLowerCase());
    }
  });

  it('draws a day inside its target in the positive colour', async () => {
    const screen = await open(UNDER);
    const painted = fillsIn(screen.toJSON());
    const theme = painted.includes(palettes.dark.bg.toLowerCase()) ? 'dark' : 'light';

    expect(painted).toContain(palettes[theme].success.toLowerCase());
  });

  it('does not save its only colour for a day that went badly', async () => {
    // The regression this guards is subtle: it would still "have colour", just
    // only ever on the bad branch. Under target has to be as coloured as over.
    const under = fillsIn((await open(UNDER)).toJSON());
    const over = fillsIn((await open(OVER)).toJSON());
    const theme = under.includes(palettes.dark.bg.toLowerCase()) ? 'dark' : 'light';
    const grey = new Set(
      [
        palettes[theme].bg,
        palettes[theme].surface,
        palettes[theme].surfaceAlt,
        palettes[theme].border,
        palettes[theme].outline,
      ].map((value) => value.toLowerCase()),
    );

    const chromaUnder = under.filter((value) => !grey.has(value)).length;
    const chromaOver = over.filter((value) => !grey.has(value)).length;

    expect(chromaUnder).toBeGreaterThan(0);
    expect(chromaUnder).toBeGreaterThanOrEqual(chromaOver - 1);
  });

  it('puts the warm field under the hero, like every other hero in the app', async () => {
    // heroWash is where the design language gets its warmth from, and the
    // dashboard, the screen with the largest hero and the first one anyone
    // opens, was the only hero screen not using it.
    //
    // Asserted by the presence of the gradient rather than by its stops: the
    // native adapter processes `colors` into numbers, so matching hex here
    // would be matching something the renderer no longer holds.
    const screen = await open(UNDER);
    const types: string[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const node = n as { type?: unknown; children?: unknown[] };
      if (typeof node.type === 'string') types.push(node.type);
      node.children?.forEach(walk);
    };
    walk(screen.toJSON());

    expect(types.some((name) => name.includes('LinearGradient'))).toBe(true);
    // One per screen. Two washes make both meaningless.
    expect(types.filter((name) => name.includes('LinearGradient'))).toHaveLength(1);
  });
});
