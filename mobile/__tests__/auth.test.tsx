/**
 * Getting in, and getting out when the session is dead.
 *
 * Both halves of this file exist because of the same shipped bug. An account
 * was deleted server side while a phone still held its tokens. The app asked
 * only "is there a token in the keystore", answered yes, and routed to the
 * tabs, so there was no sign in screen to reach at all. And when the user did
 * reach login, the only route to registration was a caption sized text link
 * below the fold.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from '../app/(auth)/login';
import RegisterScreen from '../app/(auth)/register';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ThemeProvider } from '../theme';

// Jest hoists mock factories above these declarations, so the names it
// reaches into have to carry the mock prefix that marks them as safe.
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
  };
});

import { api, clearTokens, hydrateTokens } from '../lib/api';

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;
const mockedClear = clearTokens as jest.Mock;

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

/** An iPhone 14, so the safe area the screens lay out against is a real one. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const STORED = { access_token: 'stored-access', refresh_token: 'stored-refresh' };

/** An axios rejection carrying a status, shaped the way the interceptor leaves it. */
const refusal = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: {} },
    config: {},
    toJSON: () => ({}),
  });

/** A rejection with no response at all, which is what a timeout looks like. */
const unreachable = () =>
  Object.assign(new Error('timeout of 15000ms exceeded'), {
    isAxiosError: true,
    response: undefined,
    code: 'ECONNABORTED',
    config: {},
    toJSON: () => ({}),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockedHydrate.mockResolvedValue(null);
  mockedApi.get.mockResolvedValue({ data: {} });
  mockedApi.post.mockResolvedValue({ data: STORED });
});

describe('finding the way in', () => {
  it('offers signing in and creating an account as two buttons', async () => {
    const { getByRole } = render(<LoginScreen />, { wrapper });

    // Both by role, not by text: the complaint was that one of these was a
    // caption sized Link, which reads as prose rather than as something to
    // press, and a text query would have passed against it just the same.
    await waitFor(() => expect(getByRole('button', { name: 'Sign in' })).toBeTruthy());
    expect(getByRole('button', { name: 'Create an account' })).toBeTruthy();
  });

  it('takes you to registration when you press it', async () => {
    const { getByRole } = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(getByRole('button', { name: 'Create an account' })).toBeTruthy());

    fireEvent.press(getByRole('button', { name: 'Create an account' }));

    expect(mockPush).toHaveBeenCalledWith('/register');
  });

  it('keeps the way back to signing in a button too', async () => {
    const { getByRole } = render(<RegisterScreen />, { wrapper });

    await waitFor(() => expect(getByRole('button', { name: 'Create account' })).toBeTruthy());
    fireEvent.press(getByRole('button', { name: 'I already have an account' }));

    expect(mockBack).toHaveBeenCalled();
  });

  it('still reaches login when registration was the entry route', async () => {
    mockCanGoBack = false;
    const { getByRole } = render(<RegisterScreen />, { wrapper });
    await waitFor(() =>
      expect(getByRole('button', { name: 'I already have an account' })).toBeTruthy(),
    );

    fireEvent.press(getByRole('button', { name: 'I already have an account' }));

    // router.back() with nothing behind it is a no-op, which would strand
    // someone who deep linked straight to registration.
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });

  it('will not submit an empty form', async () => {
    const { getByRole } = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(getByRole('button', { name: 'Sign in' })).toBeTruthy());

    fireEvent.press(getByRole('button', { name: 'Sign in' }));

    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('signs in with what was typed', async () => {
    const { getByRole, getByPlaceholderText } = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('you@example.com')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('you@example.com'), '  demo@forkast.app  ');
    fireEvent.changeText(getByPlaceholderText('Your password'), 'demo1234');
    fireEvent.press(getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      // Trimmed: a keyboard that capitalises and appends a space is the norm on
      // a phone, and the server compares the address exactly.
      expect(mockedApi.post).toHaveBeenCalledWith('/auth/login', {
        email: 'demo@forkast.app',
        password: 'demo1234',
      }),
    );
  });

  it('holds registration back until the password is long enough', async () => {
    const { getByRole, getByPlaceholderText } = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('you@example.com')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'new@forkast.app');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'short');
    fireEvent.press(getByRole('button', { name: 'Create account' }));

    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});

function SessionProbe() {
  const { ready, signedIn } = useAuth();
  return <Text>{`${ready ? 'ready' : 'booting'}:${signedIn ? 'in' : 'out'}`}</Text>;
}

describe('a stored token on boot', () => {
  it('starts signed out when the keystore is empty, and asks nobody', async () => {
    const { getByText } = render(<SessionProbe />, { wrapper });

    await waitFor(() => expect(getByText('ready:out')).toBeTruthy());
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('checks a stored token against the server', async () => {
    mockedHydrate.mockResolvedValue(STORED);

    render(<SessionProbe />, { wrapper });

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith('/me'));
  });

  it('opens the app without waiting for that check', async () => {
    mockedHydrate.mockResolvedValue(STORED);
    // A server that never answers. Blocking readiness on this would put the
    // full request timeout in front of every cold start.
    mockedApi.get.mockReturnValue(new Promise(() => {}));

    const { getByText } = render(<SessionProbe />, { wrapper });

    await waitFor(() => expect(getByText('ready:in')).toBeTruthy());
  });

  it('signs out when the server refuses the token', async () => {
    // The exact shipped bug: the account behind this token no longer exists.
    // Left alone, signedIn stays true, the router keeps the user in the tabs,
    // and no sign in screen is reachable from anywhere in the app.
    mockedHydrate.mockResolvedValue(STORED);
    mockedApi.get.mockRejectedValue(refusal(401));

    const { getByText } = render(<SessionProbe />, { wrapper });

    await waitFor(() => expect(getByText('ready:out')).toBeTruthy());
    expect(mockedClear).toHaveBeenCalled();
  });

  it('keeps the session when the server could not be reached', async () => {
    // Being unable to ask is not the same answer as being told no. Signing
    // someone out because their connection dropped would lose their session
    // every time they walked into a lift.
    mockedHydrate.mockResolvedValue(STORED);
    mockedApi.get.mockRejectedValue(unreachable());

    const { getByText } = render(<SessionProbe />, { wrapper });

    await waitFor(() => expect(getByText('ready:in')).toBeTruthy());
    await act(async () => {});
    expect(mockedClear).not.toHaveBeenCalled();
    expect(getByText('ready:in')).toBeTruthy();
  });

  it('keeps the session when the server is merely broken', async () => {
    mockedHydrate.mockResolvedValue(STORED);
    mockedApi.get.mockRejectedValue(refusal(500));

    const { getByText } = render(<SessionProbe />, { wrapper });

    await waitFor(() => expect(getByText('ready:in')).toBeTruthy());
    await act(async () => {});
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it('starts signed out rather than crashing when the keystore cannot be read', async () => {
    mockedHydrate.mockRejectedValue(new Error('keystore unavailable'));

    const { getByText } = render(<SessionProbe />, { wrapper });

    await waitFor(() => expect(getByText('ready:out')).toBeTruthy());
  });
});
