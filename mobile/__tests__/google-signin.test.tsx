/**
 * "Continue with Google", from the button to the request.
 *
 * What these tests can and cannot prove. They cover everything from the press
 * to the call to /auth/google: that the button is there when it can work and
 * absent when it cannot, that backing out of Google is not drawn as a failure,
 * that a refusal is said out loud, and that the only thing sent to the server
 * is the ID token. What they do not cover is the round trip to Google itself,
 * which needs a real OAuth client and a real device; the native module is
 * mocked in jest.setup.js for the same reason the camera and the taptic engine
 * are.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '../hooks/useAuth';
import { ThemeProvider } from '../theme';

const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
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

/**
 * A build that was given a Google client id.
 *
 * Mocked rather than set through process.env, because googleConfig reads the
 * variable once at module load and Expo inlines it at build time, so there is
 * no moment during a test run at which setting it would still be read.
 */
jest.mock('../lib/googleConfig', () => ({
  GOOGLE_WEB_CLIENT_ID: 'forkast-web.apps.googleusercontent.com',
  GOOGLE_IOS_CLIENT_ID: '',
  googleConfigured: true,
}));

import { GoogleSignin } from '@react-native-google-signin/google-signin';

import LoginScreen from '../app/(auth)/login';
import RegisterScreen from '../app/(auth)/register';
import { api, hydrateTokens } from '../lib/api';

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;
const mockedSignIn = GoogleSignin.signIn as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const TOKENS = { access_token: 'access', refresh_token: 'refresh' };

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
  mockedHydrate.mockResolvedValue(null);
  mockedApi.get.mockResolvedValue({ data: {} });
  mockedApi.post.mockResolvedValue({ data: TOKENS, status: 200 });
  mockedSignIn.mockResolvedValue({
    type: 'success',
    data: { idToken: 'google-id-token' },
  });
});

describe.each([
  ['sign up', RegisterScreen],
  ['sign in', LoginScreen],
])('continue with google on %s', (_name, ScreenUnderTest) => {
  it('offers it as a button of its own', async () => {
    const { getByRole } = render(<ScreenUnderTest />, { wrapper });

    await waitFor(() =>
      expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy(),
    );
  });

  it('sends only the token Google returned', async () => {
    const { getByRole } = render(<ScreenUnderTest />, { wrapper });
    await waitFor(() =>
      expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy(),
    );

    fireEvent.press(getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() =>
      // The token and nothing else. The library hands over an email, a name and
      // a picture beside it, and none of them are covered by Google's
      // signature, so the server reads all of that out of the token itself.
      expect(mockedApi.post).toHaveBeenCalledWith('/auth/google', {
        id_token: 'google-id-token',
      }),
    );
  });

  it('drops any cached Google session first, so the chooser actually appears', async () => {
    // Without this a second sign in silently reuses whichever account was
    // picked the first time, which on a shared phone hands the second person
    // the first person's Forkast account.
    const { getByRole } = render(<ScreenUnderTest />, { wrapper });
    await waitFor(() =>
      expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy(),
    );

    fireEvent.press(getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(GoogleSignin.signOut).toHaveBeenCalled());
  });

  it('says nothing at all when the user backs out of Google', async () => {
    // Changing your mind is a decision, not a failure, and drawing a red line
    // under it is the app arguing with somebody who has done nothing wrong.
    mockedSignIn.mockResolvedValue({ type: 'cancelled' });
    const { getByRole, queryByText } = render(<ScreenUnderTest />, { wrapper });
    await waitFor(() =>
      expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy(),
    );

    fireEvent.press(getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(mockedApi.post).not.toHaveBeenCalled());
    expect(queryByText(/went wrong|could not|failed/i)).toBeNull();
  });

  it('treats a second press while the sheet is open as backing out', async () => {
    // The library answers IN_PROGRESS, which would otherwise be drawn as a
    // failure over a sheet the user is still looking at.
    mockedSignIn.mockRejectedValue(Object.assign(new Error('busy'), { code: 'IN_PROGRESS' }));
    const { getByRole, queryByText } = render(<ScreenUnderTest />, { wrapper });
    await waitFor(() =>
      expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy(),
    );

    fireEvent.press(getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(mockedApi.post).not.toHaveBeenCalled());
    expect(queryByText(/went wrong|could not|failed/i)).toBeNull();
  });

  it('says so out loud when Google itself refuses', async () => {
    mockedSignIn.mockRejectedValue(new Error('Play Services are out of date.'));
    const { getByRole, getByText } = render(<ScreenUnderTest />, { wrapper });
    await waitFor(() =>
      expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy(),
    );

    fireEvent.press(getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(getByText(/Play Services are out of date/)).toBeTruthy());
  });

  it('says so out loud when the server refuses the token', async () => {
    mockedApi.post.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 401, data: { detail: 'That Google sign in could not be verified.' } },
        config: {},
        toJSON: () => ({}),
      }),
    );
    const { getByRole, getByText } = render(<ScreenUnderTest />, { wrapper });
    await waitFor(() =>
      expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy(),
    );

    fireEvent.press(getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(getByText(/could not be verified/)).toBeTruthy());
  });

  it('keeps the form button pressable afterwards', async () => {
    // A failed Google attempt must not leave the screen stuck in a busy state
    // with no way to fall back to the form.
    mockedSignIn.mockRejectedValue(new Error('nope'));
    const { getByRole } = render(<ScreenUnderTest />, { wrapper });
    await waitFor(() =>
      expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy(),
    );

    fireEvent.press(getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() =>
      expect(
        getByRole('button', { name: 'Continue with Google' }).props.accessibilityState.disabled,
      ).toBe(false),
    );
  });
});
