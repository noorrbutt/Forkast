/**
 * The diary's List / Map switch, which replaced Map as a destination of its
 * own (a row on Home and the /map route).
 *
 * The map itself is stubbed: what is under test is that the diary can show
 * either view, says which one is on, and that /map still lands somewhere.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

let mockParams: { view?: string } = {};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('../components/MapScreen', () => ({
  MapScreen: () => {
    const { Text: MockText } = jest.requireActual('react-native');
    return <MockText>map view</MockText>;
  },
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

import HistoryScreen from '../app/(tabs)/history';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider } from '../theme';

const mockedApi = api as unknown as { get: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 59, left: 0, right: 0, bottom: 34 },
          }}
        >
          <AuthProvider>{children}</AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/logs') return { data: { items: [], total: 0 } };
    return { data: null };
  });
});

describe('the List / Map switch', () => {
  it('opens on the list, with List marked as the current view', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Your diary is empty')).toBeTruthy());

    const list = screen.getByRole('button', { name: 'List' });
    const map = screen.getByRole('button', { name: 'Map' });
    expect(list.props.accessibilityState.selected).toBe(true);
    expect(map.props.accessibilityState.selected).toBe(false);
    expect(screen.queryByText('map view')).toBeNull();
  });

  it('swaps the list for the map and back, under the same header', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Your diary is empty')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByText('map view')).toBeTruthy();
    expect(screen.queryByText('Your diary is empty')).toBeNull();
    expect(screen.getByText('Your diary')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Map' }).props.accessibilityState.selected).toBe(true);

    fireEvent.press(screen.getByRole('button', { name: 'List' }));
    await waitFor(() => expect(screen.getByText('Your diary is empty')).toBeTruthy());
    expect(screen.queryByText('map view')).toBeNull();
  });

  it('opens on the map when sent with ?view=map, which is where /map now lands', async () => {
    mockParams = { view: 'map' };
    const screen = render(<HistoryScreen />, { wrapper });

    expect(screen.getByText('map view')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Text).length).toBeGreaterThan(0);
  });
});

describe('the old map destination', () => {
  const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

  it('is no longer a row on Home', () => {
    expect(read('app/(tabs)/index.tsx')).not.toMatch(/\/map/);
  });

  it('redirects /map to the diary with the map showing, so old links still work', () => {
    const route = read('app/map.tsx');
    expect(route).toMatch(/<Redirect/);
    expect(route).toMatch(/pathname: '\/history', params: \{ view: 'map' \}/);
  });
});
