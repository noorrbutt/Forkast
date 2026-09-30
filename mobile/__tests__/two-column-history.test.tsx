/**
 * The diary's FlatList at the one breakpoint wide enough for two columns.
 *
 * meals.test.tsx never mocks the window (the runner's own default, 750pt,
 * is medium -- see hero-ring.test.tsx's note on that), so its assertions
 * about single-column grouping still hold unmodified. This file isolates
 * numColumns actually changing at expanded.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { FlatList } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

let mockWidth = 390;
let mockHeight = 844;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: mockHeight, scale: 2, fontScale: 1 }),
}));

jest.mock('expo-router', () => ({
  // A no-op is enough for every test here: nothing exercises what happens
  // when a screen loses focus, only that rendering a screen using the real
  // hook does not throw.
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    getAccessToken: () => 'test-token',
    setAuthFailureHandler: jest.fn(),
  };
});

import HistoryScreen from '../app/(tabs)/history';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider } from '../theme';

const mockedApi = api as unknown as { get: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;

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
        <SafeAreaProvider
          initialMetrics={{ frame: { x: 0, y: 0, width: mockWidth, height: mockHeight }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}
        >
          <AuthProvider>{children}</AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const meal = (id: string, dishName: string, day: string) => ({
  id,
  dish_name: dishName,
  has_photo: false,
  category_id: 4,
  restaurant_id: null,
  area: 'Gulberg',
  rating: 4,
  fun_scale: 3,
  friend_scale: 'solo',
  serving_size: 'medium',
  estimated_calories: 820,
  created_at: day,
  category: { id: 4, name: 'Karahi', is_junk: false, base_calorie_min: 600, base_calorie_max: 900 },
  restaurant: null,
});

// Two different days, so groupByDay produces two DiaryDay cards -- the
// minimum needed to see whether they land in one row or two.
const ITEMS = [
  meal('log-1', 'Chicken biryani', '2026-09-15T09:00:00Z'),
  meal('log-2', 'Haleem', '2026-09-10T12:00:00Z'),
];

function signedIn() {
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/me') {
      return {
        data: {
          id: 'user-1',
          email: 'noor@example.com',
          timezone: 'Asia/Karachi',
          goal: 'maintain',
          daily_calorie_target: 2200,
          created_at: '2026-01-04T09:00:00Z',
        },
      };
    }
    if (url === '/logs') return { data: { items: ITEMS, total: ITEMS.length } };
    return { data: null };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  signedIn();
});

describe('the diary at expanded width', () => {
  it('lists one day card per row on a phone', async () => {
    mockWidth = 390;
    mockHeight = 844;

    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.numColumns).toBe(1);
  });

  it('lists two day cards per row on a tablet-width window', async () => {
    mockWidth = 1024;
    mockHeight = 1366;

    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.numColumns).toBe(2);
    expect(screen.getByText('Haleem')).toBeTruthy();
  });
});
