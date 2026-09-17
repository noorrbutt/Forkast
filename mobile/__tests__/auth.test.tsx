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
import { StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from '../app/(auth)/login';
import RegisterScreen from '../app/(auth)/register';
import WelcomeScreen from '../app/(auth)/welcome';
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

type AnyStyle = TextStyle & ViewStyle;

/**
 * Every style on every rendered node, flattened.
 *
 * The composition rules in the style guide are about what is on the screen
 * rather than about any one component, so the checks below read the whole tree
 * instead of asking a component what it thinks it rendered.
 */
function everyStyle(tree: unknown): AnyStyle[] {
  const found: AnyStyle[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const { props, children } = node as { props?: { style?: unknown }; children?: unknown };
    if (props?.style) found.push(StyleSheet.flatten(props.style as AnyStyle) ?? {});
    walk(children);
  };
  walk(tree);
  return found;
}

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

describe('the welcome screen', () => {
  it('says what the app is before asking who you are', async () => {
    const { getByText } = render(<WelcomeScreen />, { wrapper });

    await waitFor(() => expect(getByText(/Welcome/)).toBeTruthy());
    expect(getByText('Eat now. Explain later.')).toBeTruthy();
    // The three things the app actually does, which the login form said nothing about.
    expect(getByText('Log it in seconds')).toBeTruthy();
    expect(getByText('See it coming')).toBeTruthy();
    expect(getByText('Get a plan that fits')).toBeTruthy();
  });

  it('offers both doors as buttons', async () => {
    const { getByRole } = render(<WelcomeScreen />, { wrapper });

    await waitFor(() => expect(getByRole('button', { name: 'Get started' })).toBeTruthy());
    expect(getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('leads with exactly one figure, and nothing else comes near it', async () => {
    // Style guide section 4: `hero` at most once per screen, and the gap to the
    // second element at least one full step of the scale. The screen used to
    // top out at 48 with three 44pt coloured discs beneath it, which is how
    // three supporting rows ended up weighing as much as the headline.
    const { toJSON } = render(<WelcomeScreen />, { wrapper });

    const sizes = everyStyle(toJSON())
      .map((style) => Number(style.fontSize ?? 0))
      .sort((a, b) => b - a);

    // 44, 52 and 64 are the three sizes the hero is allowed to step between.
    expect(sizes.filter((size) => size >= 44)).toHaveLength(1);
    // And the drop to whatever is second is a full step of the scale or more.
    const second = sizes.find((size) => size < sizes[0]) ?? 0;
    expect(sizes[0] / second).toBeGreaterThanOrEqual(1.33);
  });

  it('puts no decorative disc behind anything', async () => {
    // Section 10 bans the disc outright, and this screen had three of them:
    // 44pt circles of accentSoft behind the icon on each feature row, which is
    // also brand colour spent on decoration rather than on an action.
    const { toJSON } = render(<WelcomeScreen />, { wrapper });

    const discs = everyStyle(toJSON()).filter(
      (style) =>
        Boolean(style.backgroundColor) &&
        typeof style.width === 'number' &&
        style.width === style.height &&
        Number(style.borderRadius ?? 0) >= style.width / 2,
    );
    expect(discs).toHaveLength(0);
  });

  it('wears no uppercase eyebrow', async () => {
    // Section 4: the 11px tracked out uppercase label is allowed on the tab bar
    // and in chart axes, nowhere else. This screen wore one reading "Forkast".
    const { toJSON } = render(<WelcomeScreen />, { wrapper });

    expect(everyStyle(toJSON()).some((style) => style.textTransform === 'uppercase')).toBe(false);
  });

  it('sends you to sign up and to sign in', async () => {
    const { getByRole } = render(<WelcomeScreen />, { wrapper });
    await waitFor(() => expect(getByRole('button', { name: 'Get started' })).toBeTruthy());

    fireEvent.press(getByRole('button', { name: 'Get started' }));
    expect(mockPush).toHaveBeenCalledWith('/register');

    fireEvent.press(getByRole('button', { name: 'Sign in' }));
    expect(mockPush).toHaveBeenCalledWith('/login');
  });
});

describe('finding the way in', () => {
  it('uses the words people scan for', async () => {
    // "Create an account" was the old label. Nobody hunts a screen for that
    // phrase; the reported complaint was literally "no button that says signup
    // or sign in".
    const login = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(login.getByRole('button', { name: 'Sign in' })).toBeTruthy());
    expect(login.getByRole('button', { name: 'Sign up' })).toBeTruthy();
    expect(login.queryByText('Create an account')).toBeNull();

    const reg = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(reg.getByRole('button', { name: 'Sign up' })).toBeTruthy());
    expect(reg.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('calls each form what the button that opened it called it', async () => {
    // Section 3: one name per action, everywhere. Both screens used to carry a
    // 21pt title in the bar and a different 48pt headline under it, so the
    // biggest words on a form were not the name of the thing it does.
    const login = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(login.getByText('Sign in.')).toBeTruthy());

    const reg = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(reg.getByText('Sign up.')).toBeTruthy());
  });

  it('keeps one left edge down both forms', async () => {
    // Section 2: one content column, one left edge. The line offering the other
    // form was centred between left aligned blocks, so a short scroll changed
    // alignment twice.
    const login = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(login.getByText('New to Forkast?')).toBeTruthy());
    expect(everyStyle(login.toJSON()).some((style) => style.textAlign === 'center')).toBe(false);

    const reg = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(reg.getByText('Already have an account?')).toBeTruthy());
    expect(everyStyle(reg.toJSON()).some((style) => style.textAlign === 'center')).toBe(false);
  });

  it('keeps the submit button live with the form empty', async () => {
    // It used to be disabled until both fields were filled, which meant the
    // only thing that looked like a button appeared after the action it was
    // there to invite. The disabled fill measured 1.39:1 in light theme.
    const { getByRole } = render(<LoginScreen />, { wrapper });

    await waitFor(() => expect(getByRole('button', { name: 'Sign in' })).toBeTruthy());
    expect(getByRole('button', { name: 'Sign in' }).props.accessibilityState.disabled).toBe(false);
  });

  it('says what is missing instead of silently doing nothing', async () => {
    const { getByRole, getByText } = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(getByRole('button', { name: 'Sign in' })).toBeTruthy());

    fireEvent.press(getByRole('button', { name: 'Sign in' }));

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(getByText(/Enter the email/)).toBeTruthy();
  });

  it('asks for the password once the email is there', async () => {
    const { getByRole, getByPlaceholderText, getByText } = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('you@example.com')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'demo@forkast.app');
    fireEvent.press(getByRole('button', { name: 'Sign in' }));

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(getByText(/Enter your password/)).toBeTruthy();
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

  it('swaps between the two forms rather than stacking them', async () => {
    const { getByRole } = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(getByRole('button', { name: 'Sign up' })).toBeTruthy());

    fireEvent.press(getByRole('button', { name: 'Sign up' }));

    // replace, not push: pushing would grow a login/register/login stack that
    // the back gesture then has to walk all the way down.
    expect(mockReplace).toHaveBeenCalledWith('/register');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('holds registration back until the password is long enough', async () => {
    const { getByRole, getByPlaceholderText, getByText } = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('you@example.com')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'new@forkast.app');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'short');
    fireEvent.press(getByRole('button', { name: 'Sign up' }));

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(getByText(/at least 8 characters/i)).toBeTruthy();
  });

  it('registers once the password is long enough', async () => {
    const { getByRole, getByPlaceholderText } = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('you@example.com')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('you@example.com'), 'new@forkast.app');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'longenough');
    fireEvent.press(getByRole('button', { name: 'Sign up' }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/auth/register', {
        email: 'new@forkast.app',
        password: 'longenough',
      }),
    );
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
