/**
 * A checkout that was never given Google credentials.
 *
 * Its own file rather than a case inside google-signin.test.tsx, because the
 * thing under test is a module-scope constant: googleConfig reads the client id
 * once when the module loads, so "configured" and "not configured" cannot both
 * exist in one jest module registry. Trying it with isolateModules looked like
 * it worked and did not, because the screen had already been loaded against the
 * other mock.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '../hooks/useAuth';
import { ThemeProvider } from '../theme';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn() },
    hydrateTokens: jest.fn().mockResolvedValue(null),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
  };
});

/** No client id, which is what a fresh clone of this repo has. */
jest.mock('../lib/googleConfig', () => ({
  GOOGLE_WEB_CLIENT_ID: '',
  GOOGLE_IOS_CLIENT_ID: '',
  googleConfigured: false,
}));

import LoginScreen from '../app/(auth)/login';
import RegisterScreen from '../app/(auth)/register';

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

describe.each([
  ['sign up', RegisterScreen, 'Sign up'],
  ['sign in', LoginScreen, 'Sign in'],
])('%s with no Google client id', (_name, ScreenUnderTest, primary) => {
  it('draws no Google button at all', async () => {
    /**
     * Hidden rather than disabled.
     *
     * A disabled control still says the feature exists and implies the user did
     * something to deserve it greyed out. Absence says the honest thing, which
     * is that this build cannot offer it. The alternative, a live button that
     * opens a Google page and fails there, is the worst of the three: it looks
     * supported right up until it wastes somebody's time.
     */
    const { getByRole, queryByRole } = render(<ScreenUnderTest />, { wrapper });

    await waitFor(() => expect(getByRole('button', { name: primary })).toBeTruthy());
    expect(queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  });

  it('still lets the form through, so the app is not broken by its absence', async () => {
    const { getByPlaceholderText } = render(<ScreenUnderTest />, { wrapper });

    await waitFor(() => expect(getByPlaceholderText('you@example.com')).toBeTruthy());
  });
});
