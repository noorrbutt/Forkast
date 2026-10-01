/**
 * The demo account line on the sign in screen.
 *
 * It exists for one build, the public browser demo, and must be invisible in
 * every other one. Invisible meaning absent from the tree, not an empty Text
 * that still takes a gap's worth of space under the headline.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from '../app/(auth)/login';
import { AuthProvider } from '../hooks/useAuth';
import { demoAccount } from '../lib/demoHint';
import { ThemeProvider } from '../theme';

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
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

// Synthetic, and only ever set inside this file.
const EMAIL = 'demo@example.com';
const PASSWORD = 'not-a-real-password';

const KEYS = ['EXPO_PUBLIC_DEMO_HINT', 'EXPO_PUBLIC_DEMO_EMAIL', 'EXPO_PUBLIC_DEMO_PASSWORD'];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function configure(hint: string | undefined, email = EMAIL, password = PASSWORD) {
  if (hint === undefined) delete process.env.EXPO_PUBLIC_DEMO_HINT;
  else process.env.EXPO_PUBLIC_DEMO_HINT = hint;
  process.env.EXPO_PUBLIC_DEMO_EMAIL = email;
  process.env.EXPO_PUBLIC_DEMO_PASSWORD = password;
}

describe('demoAccount', () => {
  it('is off when the switch is unset, even with credentials present', () => {
    configure(undefined);
    expect(demoAccount()).toBeNull();
  });

  it('is off for anything but the exact string true', () => {
    // An env file says "false", "0" or "TRUE" as easily as "true", and only
    // one of those is someone deciding to publish a password.
    for (const value of ['false', '0', '1', 'TRUE', '']) {
      configure(value);
      expect(demoAccount()).toBeNull();
    }
  });

  it('is off when switched on with nothing to show', () => {
    configure('true', '', PASSWORD);
    expect(demoAccount()).toBeNull();
    configure('true', EMAIL, '');
    expect(demoAccount()).toBeNull();
  });

  it('hands back both values when switched on and given them', () => {
    configure('true');
    expect(demoAccount()).toEqual({ email: EMAIL, password: PASSWORD });
  });
});

/** Lets AuthProvider finish reading the (absent) stored session. */
const settle = () => act(async () => {});

describe('the sign in screen', () => {
  it('shows the demo account in a demo build', async () => {
    configure('true');
    const { getByText } = render(<LoginScreen />, { wrapper });
    await settle();

    expect(getByText(`Demo account: ${EMAIL} / ${PASSWORD}`)).toBeTruthy();
  });

  it('renders nothing at all for it otherwise, not an empty line', async () => {
    configure(undefined);
    const plain = render(<LoginScreen />, { wrapper });
    await settle();
    const without = JSON.stringify(plain.toJSON());
    plain.unmount();

    // Switched on but unconfigured is the case most likely to leave a husk.
    configure('true', '', '');
    const husk = render(<LoginScreen />, { wrapper });
    await settle();

    expect(JSON.stringify(husk.toJSON())).toBe(without);
    expect(husk.queryByText(/Demo account/)).toBeNull();
  });
});
