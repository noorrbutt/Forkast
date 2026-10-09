/**
 * A meal logged with a bad or absent connection.
 *
 * useCreateLog's onMutate inserts the meal into the diary immediately,
 * marked pending, before the network request is even attempted -- see its
 * own comment in hooks/useLogs.ts on why that has to happen regardless of
 * whether the save succeeds, fails, or is merely paused waiting for a
 * connection (networkMode: 'offlineFirst' in lib/queryClient.ts). What
 * matters here is what the diary shows across all three outcomes: the row
 * appears at once, it settles into the real entry on success, and it is
 * pulled back out on a genuine failure rather than left behind as a meal
 * that was never actually saved.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  // A no-op is enough for every test here: nothing exercises what happens
  // when a screen loses focus, only that rendering a screen using the real
  // hook does not throw.
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), navigate: mockNavigate, back: jest.fn(), canGoBack: () => true }),
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
import { useCreateLog } from '../hooks/useLogs';
import { api, hydrateTokens } from '../lib/api';
import type { FoodLog, LogInput } from '../lib/types';
import { ThemeProvider } from '../theme';

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

/** Exposes useCreateLog's mutate to the test, inside the same tree and the
 * same QueryClient the diary reads from -- the whole point being to watch
 * the diary react to the mutation's own cache writes, not to call the API
 * mock directly and skip the part under test. */
function Harness({ onReady }: { onReady: (mutate: (input: LogInput) => void) => void }) {
  const createLog = useCreateLog();
  onReady((input) => createLog.mutate(input));
  return <HistoryScreen />;
}

function renderHarness(queryClient: QueryClient) {
  let mutate: ((input: LogInput) => void) | null = null;
  const screen = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={METRICS}>
          <AuthProvider>
            <Harness onReady={(fn) => (mutate = fn)} />
          </AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { screen, mutate: (input: LogInput) => mutate!(input) };
}

const INPUT: LogInput = {
  dish_name: 'Late Night Biryani',
  category_id: 4,
  rating: 4,
  serving_size: 'medium',
  client_id: 'client-late-biryani',
};

const SAVED: FoodLog = {
  has_photo: false,
  id: 'server-id-1',
  dish_name: 'Late Night Biryani',
  category_id: 4,
  restaurant_id: null,
  area: null,
  rating: 4,
  fun_scale: null,
  friend_scale: null,
  serving_size: 'medium',
  estimated_calories: 810,
  estimate_source: 'local',
  calorie_source: 'category',
  protein_g: null,
  carbs_g: null,
  fat_g: null,
  refined: false,
  created_at: '2026-09-30T21:00:00Z',
  category: {
    id: 4,
    name: 'Biryani',
    slug: 'biryani',
    cuisine_id: 1,
    is_junk: false,
    base_calorie_min: 600,
    base_calorie_max: 900,
  },
  restaurant: null,
};

/**
 * What GET /logs answers, mutated by the tests that go on to save a meal
 * successfully. onSuccess below invalidates ['logs'], which refetches this
 * mock immediately since the query is mounted -- a static empty response
 * would silently wipe the settled row straight back out, which is a fact
 * about this fixture, not about the code under test.
 */
let serverLogs: FoodLog[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  serverLogs = [];
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/me') {
      return {
        data: {
          id: 'user-1',
          email: 'noor@example.com',
          timezone: 'Asia/Karachi',
          goal: 'maintain',
          daily_calorie_target: null,
          created_at: '2026-01-04T09:00:00Z',
        },
      };
    }
    if (url === '/logs') return { data: { items: serverLogs, total: serverLogs.length } };
    return { data: null };
  });
});

function freshClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}

describe('a meal logged with no answer yet', () => {
  it('appears in the diary immediately, marked pending', async () => {
    let resolvePost: (value: { data: FoodLog }) => void = () => {};
    mockedApi.post.mockReturnValue(new Promise((resolve) => (resolvePost = resolve)));

    const { screen, mutate } = renderHarness(freshClient());
    await waitFor(() => expect(screen.getByText('0 logged')).toBeTruthy());

    // Awaited, not fired and forgotten: onMutate is itself async (it awaits
    // cancelQueries before writing the optimistic row), and TanStack Query's
    // cache notifications are batched onto a real setTimeout(0) besides. A
    // bare `act(() => mutate(...))` returns before either has actually
    // flushed, and the very next assertion would otherwise be racing them.
    await act(async () => {
      mutate(INPUT);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(screen.getByText('Late Night Biryani')).toBeTruthy());
    expect(screen.getByText('Pending sync')).toBeTruthy();

    // Unblock the pending request so the test does not leak a dangling timer.
    resolvePost({ data: SAVED });
  });

  it('settles into the real entry once the save succeeds', async () => {
    // Held open deliberately, the same as the first test: resolving before
    // the pending state is ever observed would race straight past the thing
    // this test exists to check.
    let resolvePost: (value: { data: FoodLog }) => void = () => {};
    mockedApi.post.mockReturnValue(new Promise((resolve) => (resolvePost = resolve)));

    const { screen, mutate } = renderHarness(freshClient());
    await waitFor(() => expect(screen.getByText('0 logged')).toBeTruthy());

    await act(async () => {
      mutate(INPUT);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(screen.getByText('Pending sync')).toBeTruthy());

    await act(async () => {
      serverLogs = [SAVED];
      resolvePost({ data: SAVED });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(screen.queryByText('Pending sync')).toBeNull());
    expect(screen.getByText('810 kcal')).toBeTruthy();
  });

  it('is pulled back out if the save genuinely fails', async () => {
    let rejectPost: (error: Error) => void = () => {};
    mockedApi.post.mockReturnValue(new Promise((_resolve, reject) => (rejectPost = reject)));

    const { screen, mutate } = renderHarness(freshClient());
    await waitFor(() => expect(screen.getByText('0 logged')).toBeTruthy());

    await act(async () => {
      mutate(INPUT);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(screen.getByText('Late Night Biryani')).toBeTruthy());

    await act(async () => {
      rejectPost(new Error('network error'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(screen.queryByText('Late Night Biryani')).toBeNull());
  });
});
