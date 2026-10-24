/**
 * The Ramadan section on the profile screen: opt-in, off by default, and the
 * city/offset rows only appear once it's on.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ProfileScreen from '../app/(tabs)/profile';
import { AuthProvider } from '../hooks/useAuth';
import { RamadanProvider } from '../hooks/useRamadan';
import { ThemeProvider } from '../theme';

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

import { api, hydrateTokens } from '../lib/api';

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock; patch: jest.Mock; delete: jest.Mock };
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
          <AuthProvider><RamadanProvider>{children}</RamadanProvider></AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function signedIn() {
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/me') {
      return {
        data: {
          id: '01a0-aaaa',
          email: 'noor@example.com',
          timezone: 'Asia/Karachi',
          goal: 'maintain',
          daily_calorie_target: null,
          created_at: '2026-01-04T09:00:00Z',
        },
      };
    }
    if (url === '/auth/sessions') return { data: [] };
    if (url.startsWith('/logs')) return { data: { items: [], total: 0 } };
    if (url.startsWith('/streaks')) return { data: { current_streak: 0, longest_streak: 0 } };
    return { data: null };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  signedIn();
});

it('shows the Ramadan toggle off by default, with no city or offset row', async () => {
  const { getByText, getByLabelText, queryByText } = render(<ProfileScreen />, { wrapper });

  await waitFor(() => expect(getByText('Ramadan mode')).toBeTruthy());
  expect(getByLabelText('Ramadan mode').props.accessibilityValue).toEqual({ text: 'Off' });
  expect(queryByText('City')).toBeNull();
  expect(queryByText('Minute offset')).toBeNull();
});

it('reveals city and offset rows once switched on, defaulting to Karachi', async () => {
  const { getByText, getByLabelText } = render(<ProfileScreen />, { wrapper });

  const row = await waitFor(() => getByLabelText('Ramadan mode'));
  fireEvent.press(row);

  await waitFor(() =>
    expect(getByLabelText('Ramadan mode').props.accessibilityValue).toEqual({ text: 'On' }),
  );
  expect(getByText('Karachi')).toBeTruthy();
  expect(getByText('0 min')).toBeTruthy();
});

it('names the device-local privacy note, and its one exception', async () => {
  const { getByText } = render(<ProfileScreen />, { wrapper });

  await waitFor(() =>
    expect(
      getByText(
        "Times are calculated; follow your local timetable. Ramadan mode settings (on/off, city, minute offset) are stored on your device and are not sent to Forkast's servers. Asking for an iftar/sehri-style meal plan is the one exception: that request, and the style you asked for, is sent to our servers and saved with the plan, the same as any other meal plan you generate.",
      ),
    ).toBeTruthy(),
  );
});
