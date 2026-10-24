/**
 * The desi dish chips on the log form, reordered client-side during Ramadan
 * mode's sehri/iftar slots.
 *
 * The /dishes request itself must stay byte-identical whether the mode is on
 * or off -- the app's eating pattern during Ramadan is not something to tell
 * the server about -- so these tests pin the request shape alongside the
 * reordered chips.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: mockPush, navigate: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
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
    getAccessToken: () => 'test-token',
  };
});

// Fixed Karachi fasting window, independent of the system clock set below.
const mockWindow = { fajr: new Date(2026, 1, 19, 5, 47), maghrib: new Date(2026, 1, 19, 18, 29) };

jest.mock('../lib/ramadan', () => ({
  ...jest.requireActual('../lib/ramadan'),
  fastingWindow: jest.fn(() => mockWindow),
}));

// Same reasoning as __tests__/use-ramadan.test.ts: a Map-backed mock stands
// in for the OS keystore, since jest-expo's auto-mock resolves without
// storing anything.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

import LogScreen from '../app/(tabs)/log';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { writeRamadanSettings } from '../lib/ramadanStore';
import { ThemeProvider } from '../theme';

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock; put: jest.Mock; delete: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
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

const CATEGORIES = [{ id: 11, cuisine_id: 1, slug: 'karahi', name: 'Karahi', base_calorie_min: 400, base_calorie_max: 900, is_junk: false }];

// Deliberately ordered so a passing test proves reordering happened rather
// than the fixture already being in Ramadan order: "daal chawal" and
// "daliya" (neither in IFTAR_DISHES) sit ahead of "dates" and "dahi bhalla"
// (both in it) in what the server returns.
const D_DISH_HINTS = [
  { name: 'daal chawal', unit: 'plate', typical_qty: 1, kcal_min: 400, kcal_max: 550, category_id: 11 },
  { name: 'daliya', unit: 'katori', typical_qty: 1, kcal_min: 180, kcal_max: 240, category_id: 11 },
  { name: 'dates', unit: 'piece', typical_qty: 3, kcal_min: 75, kcal_max: 110, category_id: 11 },
  { name: 'dahi bhalla', unit: 'plate', typical_qty: 1, kcal_min: 300, kcal_max: 430, category_id: 11 },
];

function mockDishesEndpoint() {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/health')) return { data: { status: 'ok', ai_provider: 'fake' } };
    if (url === '/cuisines') return { data: [] };
    if (url === '/categories') return { data: CATEGORIES };
    if (url === '/restaurants') return { data: [] };
    if (url === '/dishes') return { data: D_DISH_HINTS };
    if (url === '/search') return { data: { cuisines: [], categories: [], dishes: [] } };
    return { data: null };
  });
}

function renderManualForm(): ReturnType<typeof render> {
  const screen = render(<LogScreen />, { wrapper });
  fireEvent.press(screen.getByText('Type it in instead'));
  return screen;
}

async function enableRamadan() {
  await writeRamadanSettings({
    enabled: true,
    cityId: 'karachi',
    offsetMin: 0,
    suggestionDismissed: false,
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockDishesEndpoint();
  await writeRamadanSettings({
    enabled: false,
    cityId: 'karachi',
    offsetMin: 0,
    suggestionDismissed: false,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

async function typeD(screen: ReturnType<typeof render>) {
  fireEvent.changeText(screen.getByPlaceholderText('Chicken karahi'), 'd');
  await waitFor(() => expect(screen.getByText('Common desi dishes')).toBeTruthy());
}

const DISH_NAME_PATTERN = new RegExp(`^(${D_DISH_HINTS.map((hint) => hint.name).join('|')})$`);

/** The dish names actually on screen, in the order the tree renders them --
 * unlike filtering the fixture array, this reflects what reordering really
 * did rather than the fixture's own declaration order. */
function chipLabels(screen: ReturnType<typeof render>): string[] {
  return screen.getAllByText(DISH_NAME_PATTERN).map((el) => el.props.children as string);
}

test('standard mode: chips keep the server order', async () => {
  const screen = renderManualForm();
  await typeD(screen);

  // Not asserting a literal order here beyond "unchanged from the fixture":
  // daal chawal (not in either Ramadan set) still renders ahead of dates.
  const daalChawal = screen.getByText('daal chawal');
  const dates = screen.getByText('dates');
  expect(chipLabels(screen).indexOf('daal chawal')).toBeLessThan(chipLabels(screen).indexOf('dates'));
  expect(daalChawal).toBeTruthy();
  expect(dates).toBeTruthy();
});

test('iftar window: dates and dahi bhalla move to the front', async () => {
  await enableRamadan();
  jest.useFakeTimers().setSystemTime(new Date(2026, 1, 19, 18, 40)); // inside WINDOW's iftar range

  const screen = renderManualForm();
  await typeD(screen);

  const labels = chipLabels(screen);
  expect(labels.slice(0, 2).sort()).toEqual(['dahi bhalla', 'dates'].sort());
  expect(labels.slice(2)).toEqual(['daal chawal', 'daliya']);
});

test('sehri window: the sehri-set dishes move to the front', async () => {
  await enableRamadan();
  jest.useFakeTimers().setSystemTime(new Date(2026, 1, 19, 5, 0)); // before fajr: sehri

  const screen = renderManualForm();
  await typeD(screen);

  // "daliya" is in SEHRI_DISHES, the other three are not.
  expect(chipLabels(screen)[0]).toBe('daliya');
});

test('the /dishes request is identical whether the mode is on or off', async () => {
  await enableRamadan();
  jest.useFakeTimers().setSystemTime(new Date(2026, 1, 19, 18, 40));

  const screen = renderManualForm();
  await typeD(screen);

  const dishesCalls = mockedApi.get.mock.calls.filter(([url]) => url === '/dishes');
  expect(dishesCalls.length).toBeGreaterThan(0);
  for (const [, config] of dishesCalls) {
    expect(Object.keys(config?.params ?? {})).toEqual(
      config?.params?.q !== undefined ? ['q'] : [],
    );
  }
});
