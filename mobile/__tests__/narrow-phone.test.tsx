/**
 * The narrowest phone this app claims to support, smoke tested.
 *
 * Not a pixel-perfect overflow check -- React Native Testing Library's
 * renderer does not do real layout measurement, so it cannot actually tell
 * a clipped row from a fine one. What it can catch is a crash: a width this
 * narrow is exactly where a fixed-width element (a hardcoded pixel value
 * instead of a percentage or a flex share) throws or renders nonsense
 * first, before anyone gets to a device to see it visually. See docs/A11Y.md
 * for the manual visual check this stands in for.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 320, height: 568, scale: 2, fontScale: 1 }),
}));

jest.mock('expo-router', () => ({
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

import DashboardScreen from '../app/(tabs)/index';
import HistoryScreen from '../app/(tabs)/history';
import LoginScreen from '../app/(auth)/login';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider } from '../theme';

const mockedApi = api as unknown as { get: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 320, height: 568 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
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

beforeEach(() => {
  jest.clearAllMocks();
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/me') {
      return {
        data: {
          id: 'user-1',
          email: 'noor@example.com',
          timezone: 'Asia/Karachi',
          goal: 'maintain',
          daily_calorie_target: 2000,
          created_at: '2026-01-04T09:00:00Z',
        },
      };
    }
    if (url === '/dashboard') {
      return {
        data: {
          junk_ratio: 0.3,
          total_calories: 18_400,
          total_burned: 2_100,
          net_calories: 16_300,
          logs_count: 12,
          today: { target: 2000, consumed: 1800, burned: 200, net: 1600, remaining: 400 },
          calories_by_day: [],
          top_category: null,
          top_restaurant: null,
          best_fun_meals: [],
          burn_equivalents: { walking_minutes: 10, running_minutes: 5, cycling_minutes: 8 },
        },
      };
    }
    if (url === '/logs') return { data: { items: [], total: 0 } };
    if (url === '/trend' || url === '/burn/today') return { data: null };
    return { data: null };
  });
});

describe('at a 320dp-wide phone', () => {
  it('renders the dashboard', async () => {
    const { getByText } = render(<DashboardScreen />, { wrapper });
    await waitFor(() => expect(getByText(/1,600|1600/)).toBeTruthy());
  });

  it('renders the diary', async () => {
    const { getByText } = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(getByText('Your diary is empty')).toBeTruthy());
  });

  it('renders the login form', async () => {
    const { getByText } = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(getByText('Sign in.')).toBeTruthy());
  });
});
