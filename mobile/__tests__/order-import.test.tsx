/**
 * Importing a delivery-order screenshot: review, edit, and batch-log.
 *
 * The screenshot never reaches this test (the picker and the upload are
 * mocked away); what matters here is that the review sheet turns the
 * server's grounded items into editable rows, that unchecking or editing a
 * row actually changes what gets logged, and that "Log N items" makes one
 * ordinary POST /logs call per selected row, each with its own client_id.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// expo-crypto's native module has no JS fallback under Jest, so
// Crypto.randomUUID() needs its own mock here -- a fresh, distinct value per
// call, which is exactly what the uniqueness assertions below are checking.
jest.mock('expo-crypto', () => {
  let mockUuidCounter = 0;
  return { randomUUID: () => `test-uuid-${++mockUuidCounter}` };
});

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn(), canGoBack: () => true }),
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

import LogScreen from '../app/(tabs)/log';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider } from '../theme';

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

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

const CATEGORIES = [
  {
    id: 1,
    cuisine_id: 1,
    slug: 'biryani',
    name: 'Biryani',
    base_calorie_min: 600,
    base_calorie_max: 950,
    is_junk: false,
  },
  {
    id: 2,
    cuisine_id: 10,
    slug: 'beverage',
    name: 'Sweet Drink',
    base_calorie_min: 170,
    base_calorie_max: 300,
    is_junk: true,
  },
];

const ORDER_ESTIMATE = {
  restaurant_name: 'Student Biryani',
  items: [
    { name: 'chicken biryani', qty: 1, kcal_min: 650, kcal_max: 850, category_id: 1, confidence: 'high' },
    { name: 'coke', qty: 2, kcal_min: 140, kcal_max: 180, category_id: null, confidence: 'medium' },
  ],
  estimate_source: 'local',
};

/** What a library pick hands back; content does not matter, only that it
 * is not canceled. */
const LIBRARY_SHOT = {
  canceled: false,
  assets: [{ uri: 'file:///DCIM/order.jpg', width: 1200, height: 2000 }],
};

const SAVED = {
  id: 'log-new',
  has_photo: false,
  dish_name: 'chicken biryani',
  category_id: 1,
  restaurant_id: null,
  area: null,
  rating: 4,
  fun_scale: null,
  friend_scale: null,
  serving_size: 'medium',
  estimated_calories: 750,
  estimate_source: 'local',
  created_at: '2026-10-16T19:00:00Z',
  category: CATEGORIES[0],
  restaurant: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/health')) return { data: { status: 'ok', ai_provider: 'fake' } };
    if (url === '/cuisines') return { data: [] };
    if (url === '/categories') return { data: CATEGORIES };
    if (url === '/restaurants') return { data: [] };
    if (url === '/dishes') return { data: [] };
    return { data: null };
  });
  mockedApi.post.mockImplementation(async (url: string) => {
    if (url === '/logs/estimate-order') return { data: ORDER_ESTIMATE };
    if (url === '/logs') return { data: SAVED };
    return { data: null };
  });
  picker.launchImageLibraryAsync.mockResolvedValue(LIBRARY_SHOT as never);
});

async function importOrder(): Promise<ReturnType<typeof render>> {
  const screen = render(<LogScreen />, { wrapper });
  fireEvent.press(screen.getByText('Import a delivery order'));
  await waitFor(() => expect(screen.getByText('What was on the order?')).toBeTruthy());
  return screen;
}

describe('reading a delivery-order screenshot', () => {
  it('shows one row per item, from the restaurant the screenshot named', async () => {
    const screen = await importOrder();

    expect(screen.getByText(/From Student Biryani/)).toBeTruthy();
    expect(screen.getByText('chicken biryani')).toBeTruthy();
    expect(screen.getByText(/coke \(no category match\)/)).toBeTruthy();
  });

  it('starts every row checked, so logging needs no extra taps for the common case', async () => {
    const screen = await importOrder();

    expect(screen.getByText('Log 2 items')).toBeTruthy();
  });

  it('unchecking a row drops it from the count and from what gets logged', async () => {
    const screen = await importOrder();

    fireEvent.press(screen.getByLabelText('coke (no category match)'));

    expect(screen.getByText('Log 1 item')).toBeTruthy();
  });

  it('a screenshot with nothing recognisable says so instead of showing empty rows', async () => {
    mockedApi.post.mockImplementation(async (url: string) => {
      if (url === '/logs/estimate-order') {
        return { data: { restaurant_name: null, items: [], estimate_source: 'local' } };
      }
      return { data: null };
    });

    const screen = await importOrder();

    expect(screen.getByText(/nothing on that screenshot looked like a food order/i)).toBeTruthy();
    expect(screen.getByText('Log 0 items')).toBeTruthy();
  });
});

describe('editing a row before logging', () => {
  it('an edited name is what gets sent, not the original guess', async () => {
    const screen = await importOrder();

    fireEvent.changeText(screen.getByDisplayValue('chicken biryani'), 'chicken biryani large');
    fireEvent.press(screen.getByText('Log 2 items'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ dish_name: 'chicken biryani large' }),
      ),
    );
  });

  it('stepping the quantity up scales the calorie figure sent for that item', async () => {
    const screen = await importOrder();

    // coke: kcal_min 140, kcal_max 180 at qty 2 -> midpoint 160 for the pair.
    // Stepping to qty 3 scales that midpoint by 3/2.
    fireEvent.press(screen.getAllByText('+')[1]);
    fireEvent.press(screen.getByText('Log 2 items'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ dish_name: 'coke', estimated_calories: 240 }),
      ),
    );
  });
});

describe('logging the selected items', () => {
  it('makes one POST /logs call per selected row, each with its own client_id', async () => {
    const screen = await importOrder();

    fireEvent.press(screen.getByText('Log 2 items'));

    await waitFor(() =>
      expect(mockedApi.post.mock.calls.filter(([url]) => url === '/logs')).toHaveLength(2),
    );
    const [firstCall, secondCall] = mockedApi.post.mock.calls.filter(([url]) => url === '/logs');
    expect(firstCall[1].client_id).not.toBe(secondCall[1].client_id);
    expect(firstCall[1].client_id).toBeTruthy();
    expect(secondCall[1].client_id).toBeTruthy();
  });

  it('sends the restaurant name along with each item', async () => {
    const screen = await importOrder();

    fireEvent.press(screen.getByText('Log 2 items'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ restaurant_name: 'Student Biryani' }),
      ),
    );
  });

  it('an unchecked item is never sent', async () => {
    const screen = await importOrder();

    fireEvent.press(screen.getByLabelText('coke (no category match)'));
    fireEvent.press(screen.getByText('Log 1 item'));

    await waitFor(() =>
      expect(mockedApi.post.mock.calls.filter(([url]) => url === '/logs')).toHaveLength(1),
    );
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/logs',
      expect.objectContaining({ dish_name: 'chicken biryani' }),
    );
  });

  it('shows a count and a way to log another once logging is done', async () => {
    const screen = await importOrder();

    fireEvent.press(screen.getByText('Log 2 items'));

    await waitFor(() => expect(screen.getByText('Logged 2 items')).toBeTruthy());
    expect(screen.getByText('Log another')).toBeTruthy();
  });

  it('falls back to a default category for an item the desi table did not match', async () => {
    const screen = await importOrder();

    fireEvent.press(screen.getByText('Log 2 items'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ dish_name: 'coke', category_id: 2 }),
      ),
    );
  });
});
