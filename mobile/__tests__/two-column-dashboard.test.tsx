/**
 * The dashboard at the one breakpoint wide enough for two columns.
 *
 * dashboard.test.tsx never mocks the window, so it renders at whatever the
 * test runner's own default is (750pt, medium -- see hero-ring.test.tsx's
 * own note on that default), which is why its 21 assertions about the
 * single-column composition still hold unmodified. This file isolates the
 * one thing that changes above that: at expanded, the hero and the
 * supporting cards sit side by side instead of stacked.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
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
    api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
  };
});

import DashboardScreen from '../app/(tabs)/index';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider } from '../theme';
import type { Dashboard, Today } from '../lib/types';

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

const TODAY: Today = { target: 2000, consumed: 1800, burned: 200, net: 1600, remaining: 400 };

function dashboard(): Dashboard {
  return {
    junk_ratio: 0.3,
    total_calories: 18_400,
    total_burned: 2_100,
    net_calories: 16_300,
    logs_count: 12,
    today: TODAY,
    calories_by_day: [{ day: '2026-09-10', calories: 1200, junk_calories: 200, burned: 150 }],
    top_category: null,
    top_restaurant: null,
    best_fun_meals: [],
    burn_equivalents: { walking_minutes: 10, running_minutes: 5, cycling_minutes: 8 },
  };
}

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
          daily_calorie_target: 2000,
          created_at: '2026-01-04T09:00:00Z',
        },
      };
    }
    if (url === '/dashboard') return { data: dashboard() };
    if (url === '/trend') return { data: null };
    if (url === '/burn/today') return { data: null };
    return { data: null };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  signedIn();
});

/** The Card the hero's number sits in and the Card the fortnight chart
 * sits in, walked up to whichever ancestor actually carries a `flexDirection`. */
function rowDirectionAbove(node: { parent: unknown }): string | undefined {
  let current: any = node;
  while (current) {
    const style = current.props?.style;
    const flat = Object.assign({}, ...[style].flat(6).filter((s: unknown) => s && typeof s === 'object'));
    if (flat.flexDirection) return flat.flexDirection;
    current = current.parent;
  }
  return undefined;
}

describe('the dashboard at expanded width', () => {
  it('stacks the hero above the cards on a phone', async () => {
    mockWidth = 390;
    mockHeight = 844;

    const { getByText } = render(<DashboardScreen />, { wrapper });
    const heading = await waitFor(() => getByText('Calories by day'));

    expect(rowDirectionAbove(heading)).not.toBe('row');
  });

  it('places the hero and the cards in a row on a tablet-width window', async () => {
    mockWidth = 1024;
    mockHeight = 1366;

    const { getByText } = render(<DashboardScreen />, { wrapper });
    const heading = await waitFor(() => getByText('Calories by day'));

    expect(rowDirectionAbove(heading)).toBe('row');
  });
});
