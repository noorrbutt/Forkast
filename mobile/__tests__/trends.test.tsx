/**
 * Trends: the fortnight chart and the month comparison, moved off Home.
 *
 * These assertions used to live in dashboard.test.tsx, when both cards sat at
 * the foot of Home. They moved with the cards, unchanged in what they pin.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({
    push: jest.fn(),
    navigate: jest.fn(),
    back: mockBack,
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

import TrendsRoute from '../app/trends';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider, palettes, split, type } from '../theme';
import type { Dashboard, Today } from '../lib/types';

const mockedApi = api as unknown as { get: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
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

function signedInWith(today: Today) {
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
    if (url === '/dashboard') return { data: dashboard(today) };
    if (url === '/trend') return { data: TREND };
    return { data: null };
  });
}

function flat(style: unknown): { fontSize?: number } {
  return (StyleSheet.flatten(style as never) ?? {}) as { fontSize?: number };
}

async function open(today: Today) {
  signedInWith(today);
  const screen = render(<TrendsRoute />, { wrapper });
  await waitFor(() => expect(screen.getByText('Calories by day')).toBeTruthy());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the screen', () => {
  it('is headed Trends and has no hero', async () => {
    const screen = await open(UNDER);

    expect(screen.getByText('Trends')).toBeTruthy();
    const sizes = screen
      .UNSAFE_queryAllByType(Text)
      .map((node) => flat(node.props.style).fontSize)
      .filter((size): size is number => typeof size === 'number');
    expect(sizes).not.toContain(type.hero.fontSize);
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

  it('gives the bars a real y axis rather than a caption standing in for one', async () => {
    const screen = await open(UNDER);

    // The tallest eaten day is 2,370, so the scale runs to 3,000 in round steps.
    expect(screen.getByText('1k')).toBeTruthy();
    expect(screen.getByText('2k')).toBeTruthy();
    expect(screen.getByText('3k')).toBeTruthy();
    expect(screen.queryByText(/Tallest bar/)).toBeNull();
  });

  it('draws the daily target as a line to read the bars against', async () => {
    const screen = await open(UNDER);

    expect(screen.getByTestId('calorie-target-line')).toBeTruthy();
    expect(screen.getByText('Daily target')).toBeTruthy();
  });

  it('draws no target line when there is no target', async () => {
    const screen = await open(NO_TARGET);

    expect(screen.queryByTestId('calorie-target-line')).toBeNull();
  });

  it('labels the axis with dates, so a fortnight never names two bars "Fri"', async () => {
    const screen = await open(UNDER);

    // Fourteen days from Sep 4, a tick every third day.
    for (const tick of ['Sep 4', 'Sep 7', 'Sep 10', 'Sep 13', 'Sep 16']) {
      expect(screen.getByText(tick)).toBeTruthy();
    }
    expect(screen.queryByText('Fri')).toBeNull();
  });
});

describe('the month trend', () => {
  it('compares a pace per day, never a part month total against a whole one', async () => {
    const screen = await open(UNDER);
    await waitFor(() => expect(screen.getByText('Calories a day')).toBeTruthy());

    // 12 days of September against 31 of August. The totals differ by 2,600
    // kcal and 6 meals almost entirely because September is not over yet.
    expect(screen.queryByText(/Down 2,600/)).toBeNull();
    expect(screen.queryByText(/Down 6 meals/)).toBeNull();

    expect(screen.getByText('1,530')).toBeTruthy();
    expect(screen.getByText('Down 150 kcal a day on August')).toBeTruthy();
    // Averaged over logged days, not calendar days: 12 meals / 9 logged days
    // = 1.3, against 18 / 25 = 0.7.
    expect(screen.getByText('1.3')).toBeTruthy();
    expect(screen.getByText('Up 0.6 a day on August')).toBeTruthy();
    expect(
      screen.getByText(/9 of 12 in September so far, 25 of 31 in August/),
    ).toBeTruthy();
  });
});
