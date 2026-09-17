/**
 * What the streaks screen leads with, at each reading a run can produce.
 *
 * The old screen was five cards of equal weight, so the number it exists to
 * report was the same size as the date of the last slip and the eye had nowhere
 * to land. The fix is a composition rule rather than a value, which means the
 * regressions worth guarding are structural: a second headline appearing beside
 * the figure, an uppercase eyebrow creeping back over a block, an icon
 * reattaching itself to a heading, or the empty account opening on a bleak zero
 * instead of on the day it is about to start.
 *
 * So these assertions are mostly about size, count and rank rather than about
 * copy. A screenshot cannot prove any of them and a careful reading forgets.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Jest hoists mock factories above these declarations, so the names they reach
// into have to carry the mock prefix that marks them as safe.
const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    navigate: mockNavigate,
    canGoBack: () => true,
  }),
}));

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
  };
});

// The runner's default window is 750pt wide, which is a tablet. Hierarchy is
// hardest to hold on a phone, so a phone is what these measure against.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

import StreaksScreen from '../app/(tabs)/streaks';
import { Card, Icon } from '../components/ui';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider } from '../theme';
import { type } from '../theme/tokens';

const mockedApi = api as unknown as { get: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;

/** An iPhone 14, so the safe area the screen lays out against is a real one. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const USER = {
  id: 'user-1',
  email: 'noor@example.com',
  timezone: 'Asia/Karachi',
  goal: 'maintain',
  daily_calorie_target: 2200,
  created_at: '2026-01-04T09:00:00Z',
};

type StreakPayload = {
  current_streak: number;
  longest_streak: number;
  last_junk_date: string | null;
  message: string;
};

/** Nothing ever logged: no run, no record, no slip. */
const UNTOUCHED: StreakPayload = {
  current_streak: 0,
  longest_streak: 0,
  last_junk_date: null,
  message: '',
};

const RUNNING: StreakPayload = {
  current_streak: 7,
  longest_streak: 12,
  last_junk_date: '2026-09-05',
  message: 'Counted in Asia/Karachi.',
};

/** A run that has just been broken, which is a real zero rather than an empty one. */
const BROKEN: StreakPayload = {
  current_streak: 0,
  longest_streak: 12,
  last_junk_date: '2026-09-16',
  message: '',
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

function serve(streaks: StreakPayload) {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/me') return { data: USER };
    if (url === '/streaks') return { data: streaks };
    return { data: null };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  serve(RUNNING);
});

type Rendered = {
  type?: string;
  props: Record<string, any>;
  children?: (Rendered | string)[] | null;
};

function flatten(style: unknown): Record<string, any> {
  return Object.assign({}, ...[style].flat(6).filter((s) => s && typeof s === 'object'));
}

/** Every piece of text the screen actually drew, with the style it drew it in. */
function textNodes(tree: Rendered | null): { text: string; style: Record<string, any> }[] {
  const found: { text: string; style: Record<string, any> }[] = [];

  const walk = (node: Rendered | string | null) => {
    if (!node || typeof node === 'string') return;
    if (node.type === 'Text') {
      const text = (node.children ?? []).filter((child) => typeof child === 'string').join('');
      found.push({ text, style: flatten(node.props.style) });
    }
    (node.children ?? []).forEach(walk);
  };

  walk(tree);
  return found;
}

/** The host tree, in the shape the walker above reads. */
function treeOf(view: { toJSON: () => unknown }): Rendered | null {
  return view.toJSON() as Rendered | null;
}

async function show(streaks: StreakPayload) {
  serve(streaks);
  const view = render(<StreaksScreen />, { wrapper });
  // The screen paints its loading state first, so nothing can be read off it
  // until the query has landed.
  await waitFor(() => view.getByText('Streaks'));
  await waitFor(() =>
    expect(mockedApi.get).toHaveBeenCalledWith('/streaks'),
  );
  return view;
}

describe('before the count has landed', () => {
  it('paints a designed state rather than nothing', async () => {
    serve(RUNNING);
    const view = render(<StreaksScreen />, { wrapper });

    // The query is disabled until the keystore hands back a token, and a
    // disabled query is not "loading". Reading it as loading left the first
    // paint of a cold start empty.
    expect(view.getByText('Counting your days')).toBeTruthy();

    // Then let the keystore read and the fetch behind it settle, so the state
    // updates land inside the test rather than after it has finished.
    await waitFor(() => view.getByText('7'));
  });
});

describe('an account with nothing on the board', () => {
  it('opens on the day it is about to start rather than on a zero', async () => {
    const { getByText, queryByText } = await show(UNTOUCHED);

    await waitFor(() => expect(getByText('Day one')).toBeTruthy());
    // A zero here would be a measurement of nothing: no run has been broken
    // because no run has started, and the screen would open by reporting a
    // failure that never happened.
    expect(queryByText('0')).toBeNull();
  });

  it('says what a streak counts, since there is nothing on screen to infer it from', async () => {
    const { getByText } = await show(UNTOUCHED);

    await waitFor(() =>
      expect(
        getByText('A streak counts the days in a row where nothing you log is junk.'),
      ).toBeTruthy(),
    );
  });

  it('offers the one action that puts something there', async () => {
    const { getByText } = await show(UNTOUCHED);

    fireEvent.press(await waitFor(() => getByText('Log a meal')));

    expect(mockNavigate).toHaveBeenCalledWith('/log');
  });

  it('does not plug the empty space with cards', async () => {
    const view = await show(UNTOUCHED);

    await waitFor(() => view.getByText('Day one'));
    expect(view.UNSAFE_queryAllByType(Card)).toHaveLength(0);
  });

  it('spends the reserved size once here too', async () => {
    const view = await show(UNTOUCHED);
    await waitFor(() => view.getByText('Day one'));

    const biggest = textNodes(treeOf(view)).filter(
      (node) => node.style.fontSize >= type.hero.fontSize,
    );

    expect(biggest.map((node) => node.text)).toEqual(['Day one']);
  });
});

describe('a run in progress', () => {
  it('leads with the current streak at the reserved size', async () => {
    const view = await show(RUNNING);

    const hero = await waitFor(() => view.getByText('7'));
    expect(flatten(hero.props.style).fontSize).toBe(type.hero.fontSize);
  });

  it('keeps a full step of the scale between the figure and everything else', async () => {
    const view = await show(RUNNING);
    await waitFor(() => view.getByText('7'));

    const others = textNodes(treeOf(view))
      .filter((node) => node.text !== '7')
      .map((node) => node.style.fontSize)
      .filter((size): size is number => typeof size === 'number');

    // display is the step below hero, so anything at or above it would be
    // competing for the top of the hierarchy rather than supporting it.
    expect(Math.max(...others)).toBeLessThan(type.display.fontSize);
  });

  it('holds the record as support, not as a second headline', async () => {
    const view = await show(RUNNING);

    await waitFor(() => view.getByText('Longest run'));
    const longest = flatten(view.getByText('12').props.style).fontSize;

    expect(longest).toBe(type.displaySm.fontSize);
    expect(flatten(view.getByText('7').props.style).fontSize).toBeGreaterThan(longest);
    expect(view.getByText('Sep 5')).toBeTruthy();
  });

  it('spends one card on the screen, and none on the figure', async () => {
    const view = await show(RUNNING);
    await waitFor(() => view.getByText('7'));

    // Six is the ceiling. One is what this screen needs: the record is the only
    // group here that wants a surface of its own.
    const cards = view.UNSAFE_queryAllByType(Card);
    expect(cards.length).toBeLessThanOrEqual(6);
    expect(cards).toHaveLength(1);
  });

  it('wears no uppercase eyebrow over any block', async () => {
    const view = await show(RUNNING);
    await waitFor(() => view.getByText('7'));

    // The tracked out 11px label over every section was on seven screens and is
    // a named tell of generated design. It is allowed on the tab bar and in
    // chart axis text, neither of which is here.
    const shouting = textNodes(treeOf(view)).filter(
      (node) => node.style.textTransform === 'uppercase',
    );

    expect(shouting).toHaveLength(0);
  });

  it('draws one icon, and it belongs to the button rather than to a heading', async () => {
    const view = await show(RUNNING);
    await waitFor(() => view.getByText('7'));

    const icons = view.UNSAFE_queryAllByType(Icon);

    expect(icons).toHaveLength(1);
    expect(icons[0].props.name).toBe('log');
  });
});

describe('a run that has just been broken', () => {
  it('reports the zero rather than hiding it', async () => {
    const view = await show(BROKEN);

    const hero = await waitFor(() => view.getByText('0'));
    // Honest, because this one is a real reading of a real run. The line under
    // it is what carries the tone.
    expect(flatten(hero.props.style).fontSize).toBe(type.hero.fontSize);
  });

  it('says how to read the zero instead of leaving it bare', async () => {
    const view = await show(BROKEN);

    await waitFor(() =>
      expect(
        view.getByText(
          'You have held 12 clean days before, so you already know how. Today is day one again.',
        ),
      ).toBeTruthy(),
    );
  });
});
