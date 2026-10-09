/**
 * The dashboard, checked as a composition rather than as a render.
 *
 * Every assertion here is a rule from DESIGN_STYLE_GUIDE.md that the old screen
 * broke, written so that breaking it again fails the build. "It renders" is not
 * one of them: the eleven card dashboard rendered perfectly well, and that was
 * the whole problem.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Svg from 'react-native-svg';

// Jest hoists mock factories above these declarations, so the names they reach
// into have to carry the mock prefix that marks them as safe.
const mockPush = jest.fn();
const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  // A no-op is enough for every test here: nothing exercises what happens
  // when a screen loses focus, only that rendering a screen using the real
  // hook does not throw.
  useFocusEffect: jest.fn(),
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
import { Card, Icon, ListGroup, Skeleton } from '../components/ui';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider, palettes, type } from '../theme';
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
    days_logged: 9,
    days_counted: 12,
  },
  last_month: {
    month: '2026-08-01',
    total_calories: 21_000,
    meals_logged: 18,
    junk_ratio: 0.4,
    avg_calories_per_day: 1_680,
    days_logged: 25,
    days_counted: 31,
  },
  change: {
    total_calories: -2_600,
    meals_logged: -6,
    junk_ratio: -0.1,
    avg_calories_per_day: -150,
  },
};

/** A local time today, as the ISO string the server would send. */
function todayAt(hour: number): string {
  const at = new Date();
  at.setHours(hour, 0, 0, 0);
  return at.toISOString();
}

function typedMeal(id: string, dish: string, calories: number, hour: number, isJunk: boolean) {
  return {
    has_photo: false,
    id,
    dish_name: dish,
    category_id: 3,
    restaurant_id: null,
    area: null,
    rating: 4,
    fun_scale: null,
    friend_scale: null,
    serving_size: 'medium',
    estimated_calories: calories,
    estimate_source: 'ai',
    calorie_source: 'category',
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    refined: true,
    created_at: todayAt(hour),
    category: { id: 3, slug: 'biryani', name: 'Biryani', is_junk: isJunk },
    restaurant: null,
  };
}

/** Two typed meals today, no photos: the everyday case the strip has to carry. */
const TODAY_LOGS = [
  typedMeal('log-lunch', 'chicken biryani', 640, 13, false),
  typedMeal('log-breakfast', 'paratha', 420, 8, true),
];

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
    if (url === '/logs') {
      return { data: logs === 0 ? { items: [], total: 0 } : { items: TODAY_LOGS, total: logs } };
    }
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
  await waitFor(() => expect(screen.getByText('This week')).toBeTruthy());
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
  signedInWith({ target: null, consumed: 0, burned: 0, net: 0, remaining: null }, 0);
  const screen = render(<DashboardScreen />, { wrapper });
  await waitFor(() => expect(screen.getByText('Today')).toBeTruthy());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('hierarchy', () => {
  it('puts exactly one element at the reserved hero size', async () => {
    const screen = await open(UNDER);

    // 400 is what is left of the target, the number someone opens the app to
    // see. Twice at this size is a rule violation rather than a judgement call.
    const hero = textSizes(screen).filter((size) => size >= 44);

    expect(hero).toEqual([type.hero.fontSize]);
    expect(flat(screen.getByText('400').props.style).fontSize).toBe(type.hero.fontSize);
    expect(screen.getByText('kcal left')).toBeTruthy();
  });

  it('answers with one hero number, not three competing ones', async () => {
    const screen = await open(UNDER);

    // Net and target are still on screen, but in one caption-size line rather
    // than as a figure plus a title-size status plus an explanatory sentence.
    const key = screen.getByText('1,600 net of 2,000 kcal');
    expect(flat(key.props.style).fontSize).toBe(type.caption.fontSize);
    expect(screen.queryByText('400 kcal left')).toBeNull();
    expect(screen.queryByText(/The ring measures/)).toBeNull();
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

  it('shows eaten and burned as one quiet inline pair, not two more figures', async () => {
    const screen = await open(UNDER);

    const eaten = screen.getByText('1,800 eaten');
    const burned = screen.getByText('200 burned');
    expect(flat(eaten.props.style).fontSize).toBe(type.body.fontSize);
    expect(flat(burned.props.style).fontSize).toBe(type.body.fontSize);
    // No second-level numerals competing with the hero any more.
    expect(textSizes(screen)).not.toContain(type.displaySm.fontSize);
  });

  it('mutes "0 burned" when nothing has been burned, and still lets it be changed', async () => {
    const screen = await open({ ...UNDER, burned: 0, net: 1800, remaining: 200 });

    const burned = screen.getByTestId('hero-burned');
    expect(burned.props.children).toBe('0 burned');
    const color = (StyleSheet.flatten(burned.props.style) as { color?: string }).color;
    expect([palettes.dark.muted, palettes.light.muted]).toContain(color);
    expect(screen.getByRole('button', { name: '0 kcal burned' })).toBeTruthy();
    // With nothing burned, net is what was eaten, so the line drops "net".
    expect(screen.getByText('1,800 of 2,000 kcal')).toBeTruthy();
  });

  it('keeps the ring small, beside the figure rather than around it', async () => {
    const screen = await open(UNDER);

    const ring = screen.getByRole('progressbar');
    expect((StyleSheet.flatten(ring.props.style) as { width?: number }).width).toBe(96);
    // And the explainer sentence under the old ring is gone.
    expect(screen.queryByText(/net of 2,000 kcal target/)).toBeNull();
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
    expect(screen.getByText(/net of 2,000 kcal/)).toBeTruthy();
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
    expect(screen.getByText('kcal left')).toBeTruthy();
  });

  it('reads as over in words, not only in colour', async () => {
    const screen = await open(OVER);

    // 200 over, at hero size.
    const sizes = screen.getAllByText('200').map((node) => flat(node.props.style).fontSize);
    expect(sizes).toContain(type.hero.fontSize);
    expect(screen.getByText('kcal over')).toBeTruthy();
    expect(screen.getByText('2,200 net of 2,000 kcal')).toBeTruthy();
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

    expect(flat(screen.getByText('Today').props.style).fontSize).toBe(type.title.fontSize);
    expect(flat(screen.getByText('This week').props.style).fontSize).toBe(type.title.fontSize);
  });
});

describe('the month trend', () => {
  it('is not on Home any more: it lives on Trends', async () => {
    const screen = await open(UNDER);

    expect(screen.queryByText('Calories by day')).toBeNull();
    expect(screen.queryByText('September against August')).toBeNull();
    expect(screen.queryByText('Calories a day')).toBeNull();
  });

  it('promises the plan length the plan actually has', async () => {
    const screen = await open(UNDER);

    expect(screen.getByText('Three days of meals shaped around your goal.')).toBeTruthy();
    expect(screen.queryByText(/a week of suggestions/i)).toBeNull();
  });
});

describe('the week strip', () => {
  it('draws the last seven days, not the fortnight', async () => {
    const screen = await open(UNDER);

    expect(screen.getAllByTestId(/^week-bar-/)).toHaveLength(7);
    expect(screen.getByTestId('week-bar-2026-09-17')).toBeTruthy();
    expect(screen.queryByTestId('week-bar-2026-09-10')).toBeNull();
  });

  it('draws the target as a line to read the bars against, and none without one', async () => {
    const withTarget = await open(UNDER);
    expect(withTarget.getByTestId('week-target-line')).toBeTruthy();
    withTarget.unmount();

    const without = await open(NO_TARGET);
    expect(without.queryByTestId('week-target-line')).toBeNull();
  });

  it("wears the ring's status colours, never the brand colour", async () => {
    const screen = await open(UNDER);
    const fills = screen
      .getAllByTestId(/^week-bar-/)
      .map((bar) =>
        String(
          (StyleSheet.flatten(bar.props.style) as { backgroundColor?: string }).backgroundColor,
        ).toLowerCase(),
      );

    const accent = [palettes.dark.accentFill, palettes.light.accentFill].map((c) =>
      c.toLowerCase(),
    );
    for (const fill of fills) expect(accent).not.toContain(fill);
    // 1,200 to 2,370 against a 2,000 target: some inside, some past.
    const status = [
      palettes.dark.success,
      palettes.light.success,
      palettes.dark.danger,
      palettes.light.danger,
    ].map((c) => c.toLowerCase());
    expect(fills.every((fill) => status.includes(fill))).toBe(true);
  });

  it('links to Trends', async () => {
    const screen = await open(UNDER);

    fireEvent.press(screen.getByText('See trends'));
    expect(mockPush).toHaveBeenCalledWith('/trends');
  });
});

describe('while the day is still loading', () => {
  it('shows a skeleton that matches the layout, not a spinner', async () => {
    mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
    // '/me' answers normally -- the dashboard query itself is what's held
    // open, since that's the one this screen's own loading state gates on.
    let resolveDashboard: (value: { data: unknown }) => void = () => {};
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === '/me') {
        return {
          data: {
            id: 'u1',
            email: 'noor@example.com',
            timezone: 'Asia/Karachi',
            goal: 'maintain',
            daily_calorie_target: 2000,
            created_at: '2026-01-04T09:00:00Z',
          },
        };
      }
      if (url === '/dashboard') return new Promise((resolve) => (resolveDashboard = resolve));
      return { data: null };
    });

    const screen = render(<DashboardScreen />, { wrapper });

    // The old spinner's own label must be gone, not merely joined by
    // something else -- a skeleton that ships alongside the spinner it was
    // meant to replace is not a replacement.
    await waitFor(() => expect(screen.queryByText('Reading your day')).toBeNull());
    expect(screen.UNSAFE_queryAllByType(Skeleton).length).toBeGreaterThan(0);

    resolveDashboard({ data: null });
  });
});

describe('the Today strip', () => {
  it("shows today's meals as tiles, oldest first, labelled for a screen reader", async () => {
    const screen = await open(UNDER);
    await waitFor(() => expect(screen.getByTestId('today-tile-log-breakfast')).toBeTruthy());

    expect(screen.getByRole('button', { name: 'Breakfast, Paratha, 420 kcal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lunch, Chicken Biryani, 640 kcal' })).toBeTruthy();
  });

  it('opens a meal from its tile', async () => {
    const screen = await open(UNDER);
    await waitFor(() => expect(screen.getByTestId('today-tile-log-lunch')).toBeTruthy());

    fireEvent.press(screen.getByTestId('today-tile-log-lunch'));
    expect(mockPush).toHaveBeenCalledWith('/logs/log-lunch');
  });

  it('always leaves a way in to Log, since the raised button is hidden on Home', async () => {
    const screen = await open(UNDER);
    await waitFor(() => expect(screen.getByTestId('today-tile-log-lunch')).toBeTruthy());

    const ghosts = screen.getAllByRole('button', { name: /^Log / });
    expect(ghosts.length).toBeGreaterThan(0);

    fireEvent.press(ghosts[0]);
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/log',
      params: { slot: expect.any(String) },
    });
  });
});

describe('nothing logged yet', () => {
  it('turns the empty day into the call to action, as ghost tiles', async () => {
    const screen = await openEmpty();

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^Log / }).length).toBeGreaterThan(0),
    );
    // No meal tiles, and no separate empty-state block competing with them.
    expect(screen.queryByTestId(/^today-tile-/)).toBeNull();
    expect(screen.queryByText('Nothing to count yet')).toBeNull();
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
