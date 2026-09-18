/**
 * Expo Go, where the Google native module does not exist.
 *
 * This is a regression test for a shipped bug, and the bug was not the one the
 * symptom named. lib/googleAuth.ts imported the package at module scope; the
 * package calls TurboModuleRegistry.getEnforcing while being evaluated;
 * getEnforcing throws when the binary has no such module. A throw during module
 * evaluation means every importer up the chain never finishes loading either,
 * so expo-router found three route modules with no default export and said so:
 *
 *   Route "./(auth)/login.tsx" is missing the required default export.
 *   Route "./(auth)/register.tsx" is missing the required default export.
 *   Route "./(tabs)/profile.tsx" is missing the required default export.
 *
 * Sign in, sign up and the Profile tab were all dead in Expo Go, and none of
 * those three messages points at the file that caused it.
 *
 * So the assertion here is deliberately not "the Google button is hidden". It is
 * "the screen renders at all". A feature that needs a development build may be
 * absent; it may not be load bearing for the features that do not need one.
 *
 * Its own file because the module has to be missing for the whole module
 * registry, which is a per-file decision in jest: jest.setup.js mocks the
 * package for every other suite, and this one replaces that mock with a factory
 * that throws, which is what requiring an unlinked native module does.
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

/**
 * Configured with a real client id, so nothing else could be hiding the button.
 * Without this the test would pass for the wrong reason: an unconfigured build
 * hides it too, and then the missing module would never be exercised.
 */
jest.mock('../lib/googleConfig', () => ({
  GOOGLE_WEB_CLIENT_ID: 'forkast-web.apps.googleusercontent.com',
  GOOGLE_IOS_CLIENT_ID: '',
  googleConfigured: true,
}));

/** What Expo Go does: the package throws while being required. */
jest.mock('@react-native-google-signin/google-signin', () => {
  throw new Error(
    "Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'RNGoogleSignin' could not be found.",
  );
});

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

it('still loads the screens as real modules with a default export', () => {
  // The literal thing expo-router complained about. If the import chain throws
  // again, these are undefined rather than components.
  expect(typeof LoginScreen).toBe('function');
  expect(typeof RegisterScreen).toBe('function');
});

describe.each([
  ['sign in', LoginScreen, 'Sign in'],
  ['sign up', RegisterScreen, 'Sign up'],
])('%s with no Google native module', (_name, ScreenUnderTest, primary) => {
  it('renders, and its own form still works', async () => {
    const { getByRole, getByPlaceholderText } = render(<ScreenUnderTest />, { wrapper });

    await waitFor(() => expect(getByRole('button', { name: primary })).toBeTruthy());
    expect(getByPlaceholderText('you@example.com')).toBeTruthy();
  });

  it('draws no Google button, rather than one that cannot work', async () => {
    const { getByRole, queryByRole } = render(<ScreenUnderTest />, { wrapper });

    await waitFor(() => expect(getByRole('button', { name: primary })).toBeTruthy());
    expect(queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  });
});
