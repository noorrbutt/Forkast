/**
 * Editing a name and an email address from the Profile screen.
 *
 * Mirrors profile-target.test.tsx's harness: sign in, open the row's dialog,
 * exercise the field. The interesting case for email is what it does to
 * email_verified in the cache once the server answers, since that is what
 * the dashboard's "verify your email" banner reads.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ProfileScreen from '../app/(tabs)/profile';
import { AuthProvider } from '../hooks/useAuth';
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

const mockedApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
};
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

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '01a0-aaaa',
    email: 'noor@example.com',
    first_name: 'Noor',
    last_name: 'Butt',
    has_password: true,
    email_verified: true,
    timezone: 'Asia/Karachi',
    goal: 'maintain',
    daily_calorie_target: null,
    created_at: '2026-01-04T09:00:00Z',
    ...overrides,
  };
}

function signedInWith(user: ReturnType<typeof baseUser>, patchResponse?: (patch: any) => any) {
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/me') return { data: user };
    if (url === '/auth/sessions') return { data: [] };
    if (url.startsWith('/logs')) return { data: { items: [], total: 0 } };
    if (url.startsWith('/streaks')) return { data: { current_streak: 0, longest_streak: 0 } };
    return { data: null };
  });
  mockedApi.patch.mockImplementation(async (_url: string, patch: Record<string, unknown>) => ({
    data: patchResponse ? patchResponse(patch) : { ...user, ...patch },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('editing a name', () => {
  it('shows the current name on the row', async () => {
    signedInWith(baseUser());
    const { getAllByText } = render(<ProfileScreen />, { wrapper });

    // Appears twice: once in the Identity header, once as the row's value.
    await waitFor(() => expect(getAllByText('Noor Butt').length).toBeGreaterThanOrEqual(1));
  });

  it('saves both fields together', async () => {
    signedInWith(baseUser());
    const screen = render(<ProfileScreen />, { wrapper });

    const row = await waitFor(() => screen.getByLabelText('Name'));
    fireEvent.press(row);

    fireEvent.changeText(screen.getByDisplayValue('Noor'), 'Sara');
    fireEvent.changeText(screen.getByDisplayValue('Butt'), 'Khan');
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', {
        first_name: 'Sara',
        last_name: 'Khan',
      }),
    );
  });

  it('refuses to save a blank name', async () => {
    signedInWith(baseUser());
    const screen = render(<ProfileScreen />, { wrapper });

    const row = await waitFor(() => screen.getByLabelText('Name'));
    fireEvent.press(row);

    fireEvent.changeText(screen.getByDisplayValue('Noor'), '   ');
    fireEvent.press(screen.getByText('Save'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
    expect(screen.getByText('Both names are required.')).toBeTruthy();
  });
});

describe('editing an email', () => {
  it('shows "Not yet verified" on the row when the account is unverified', async () => {
    signedInWith(baseUser({ email_verified: false }));
    const { getByText } = render(<ProfileScreen />, { wrapper });

    await waitFor(() => expect(getByText('Not yet verified')).toBeTruthy());
  });

  it('does not show the verification hint for a verified account', async () => {
    signedInWith(baseUser({ email_verified: true }));
    const { queryByText, getByLabelText } = render(<ProfileScreen />, { wrapper });

    await waitFor(() => expect(getByLabelText('Email')).toBeTruthy());
    expect(queryByText('Not yet verified')).toBeNull();
  });

  it('sends a changed, valid address', async () => {
    signedInWith(baseUser());
    const screen = render(<ProfileScreen />, { wrapper });

    const row = await waitFor(() => screen.getByLabelText('Email'));
    fireEvent.press(row);

    fireEvent.changeText(screen.getByDisplayValue('noor@example.com'), 'new@forkast.app');
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', { email: 'new@forkast.app' }),
    );
  });

  it('rejects a malformed address before it reaches the server', async () => {
    signedInWith(baseUser());
    const screen = render(<ProfileScreen />, { wrapper });

    const row = await waitFor(() => screen.getByLabelText('Email'));
    fireEvent.press(row);

    fireEvent.changeText(screen.getByDisplayValue('noor@example.com'), 'not-an-email');
    fireEvent.press(screen.getByText('Save'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('reflects the server response, which flips email_verified back to false', async () => {
    signedInWith(baseUser({ email_verified: true }), (patch) => ({
      ...baseUser({ email_verified: true }),
      ...patch,
      email_verified: patch.email ? false : true,
    }));
    const screen = render(<ProfileScreen />, { wrapper });

    const row = await waitFor(() => screen.getByLabelText('Email'));
    fireEvent.press(row);
    fireEvent.changeText(screen.getByDisplayValue('noor@example.com'), 'new@forkast.app');
    fireEvent.press(screen.getByText('Save'));

    // The row now shows the new address with the unverified hint, straight
    // from the mutation's cache write -- no second request needed.
    await waitFor(() => expect(screen.getByText('Not yet verified')).toBeTruthy());
  });
});
