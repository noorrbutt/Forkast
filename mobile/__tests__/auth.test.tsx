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
import {
  act,
  fireEvent,
  render,
  waitFor,
  type RenderAPI,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from '../app/(auth)/login';
import RegisterScreen from '../app/(auth)/register';
import WelcomeScreen from '../app/(auth)/welcome';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { fonts, palettes, ThemeProvider } from '../theme';

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

/**
 * Fill the sign up form, overriding whichever field a test is actually about.
 *
 * A helper rather than five changeText calls per test, because the form has
 * five fields now and four of them are noise in any test about the fifth.
 * Fields are addressed by placeholder, which is what somebody reading the
 * screen would use to find them.
 */
function fillSignUp(
  screen: RenderAPI,
  overrides: Partial<{
    first: string;
    last: string;
    email: string;
    password: string;
    confirm: string;
  }> = {},
) {
  const values = {
    first: 'Sara',
    last: 'Khan',
    email: 'new@forkast.app',
    password: 'longenough',
    confirm: 'longenough',
    ...overrides,
  };
  fireEvent.changeText(screen.getByPlaceholderText('Sara'), values.first);
  fireEvent.changeText(screen.getByPlaceholderText('Khan'), values.last);
  fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), values.email);
  fireEvent.changeText(screen.getByPlaceholderText('At least 8 characters'), values.password);
  fireEvent.changeText(screen.getByPlaceholderText('Type it once more'), values.confirm);
}

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

    await waitFor(() => expect(getByText('Forkast.')).toBeTruthy());

    /**
     * The same three claims, now carried by one sentence rather than three
     * blocks.
     *
     * They used to be three titles with a caption each, six text elements
     * taking 167pt of a screen whose only job is to make a stranger read the
     * promise first. They were the evidence for the promise and they outweighed
     * it. Asserted as ideas rather than as headings so the copy can be rewritten
     * without the test having to be, but not dropped: losing all three would be
     * a real loss and should fail.
     */
    const pitch = getByText(/Eat now\. Explain later\./);
    expect(pitch).toBeTruthy();
    expect(pitch.props.children).toMatch(/in seconds/);
    expect(pitch.props.children).toMatch(/week/);
    expect(pitch.props.children).toMatch(/plan/);
  });

  it('offers one door as a button and the other as a link', async () => {
    // Both were buttons, briefly both full width, which put two controls of the
    // same size on a screen whose whole job is to get a stranger to start. The
    // way back is prose with a tinted verb now. It still has to be reachable as
    // a control, which is what the role assertion is for: text nobody can
    // address is the failure this file already has a bug report about.
    const { getByRole } = render(<WelcomeScreen />, { wrapper });

    await waitFor(() => expect(getByRole('button', { name: 'Get started' })).toBeTruthy());
    expect(getByRole('link', { name: 'Sign in' })).toBeTruthy();
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

    fireEvent.press(getByRole('link', { name: 'Sign in' }));
    expect(mockPush).toHaveBeenCalledWith('/login');
  });
});

describe('finding the way in', () => {
  it('uses the words people scan for', async () => {
    // "Create an account" was the old label. Nobody hunts a screen for that
    // phrase; the reported complaint was literally "no button that says signup
    // or sign in".
    //
    // The other-form route is a link rather than a button now, which is a
    // change of shape and not of that requirement: the words still have to be
    // there and still have to be addressable as a control.
    const login = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(login.getByRole('button', { name: 'Sign in' })).toBeTruthy());
    expect(login.getByRole('link', { name: 'Sign up' })).toBeTruthy();
    expect(login.queryByText('Create an account')).toBeNull();

    const reg = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(reg.getByRole('button', { name: 'Sign up' })).toBeTruthy());
    expect(reg.getByRole('link', { name: 'Sign in' })).toBeTruthy();
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

  /**
   * The offer of the other form is one centred line, and the verb in it is
   * tinted.
   *
   * This test has been three things, because the arrangement has been three
   * things. First a rule that nothing here was centred, written when the
   * caption was centred over a left aligned button and the column's edge
   * changed twice in a short scroll. Then a rule that the caption and the
   * button agreed, written when the button was centred to fix that. Both were
   * guarding one thing under different names: the offer reads as one object.
   *
   * It is literally one object now, so what is left to guard is that it reads
   * as a control rather than as a sentence. That is the tint. Muted prose with
   * a muted verb in it is the failure here, and it is the one this app has
   * already had reported once.
   */
  it('offers the other form as one centred line with the verb tinted', async () => {
    // Either palette: the provider reads the system scheme, and which one a
    // test run gets is not the point of this test.
    const ACCENT = [palettes.light.accent, palettes.dark.accent];
    const MUTED = [palettes.light.muted, palettes.dark.muted];
    for (const [Screen, prompt, verb] of [
      [LoginScreen, 'New to Forkast?', 'Sign up'],
      [RegisterScreen, 'Already have an account?', 'Sign in'],
    ] as const) {
      const screen = render(<Screen />, { wrapper });
      await waitFor(() => expect(screen.getByRole('link', { name: verb })).toBeTruthy());

      // The prompt and the verb are one line now, not a caption with a control
      // under it, so the prompt has no text node of its own to inspect. The
      // line is addressed by the whole sentence, which is also the assertion
      // that the two halves really are one run of text rather than two blocks
      // that happen to sit close together.
      const line = screen.getByText(`${prompt} ${verb}`);
      const lineStyle = StyleSheet.flatten(line.props.style) as AnyStyle;
      expect(lineStyle.textAlign).toBe('center');
      expect(MUTED).toContain(lineStyle.color);

      // And the verb inside it is saffron, not more of the same muted grey.
      const verbStyle = StyleSheet.flatten(screen.getByText(verb).props.style) as AnyStyle;
      expect(ACCENT).toContain(verbStyle.color);
      expect(verbStyle.color).not.toBe(lineStyle.color);
      // Semibold needs the cut named as well as the weight, or it is a silent
      // no-op on device. See the FAMILY note in tokens.
      expect(verbStyle.fontFamily).toBe(fonts.semibold);

      // The target is a target, not a 22pt line of type. Section 3 floor.
      const tappable = everyStyle(screen.toJSON()).filter(
        (style) => Number(style.minHeight ?? 0) >= 48,
      );
      expect(tappable.length).toBeGreaterThan(0);

      screen.unmount();
    }
  });

  it('leaves the form itself on one left edge', async () => {
    // Only the trailing escape hatch is centred. The headline and the fields
    // above it keep the single left edge the column is built on, because a form
    // whose labels wander is a form that is hard to scan.
    const login = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(login.getByText('Sign in.')).toBeTruthy());

    const headline = StyleSheet.flatten(login.getByText('Sign in.').props.style) as AnyStyle;
    expect(headline.textAlign).toBeUndefined();

    const fieldLabel = StyleSheet.flatten(login.getByText('Email').props.style) as AnyStyle;
    expect(fieldLabel.textAlign).toBeUndefined();
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
    await waitFor(() => expect(getByRole('link', { name: 'Sign up' })).toBeTruthy());

    fireEvent.press(getByRole('link', { name: 'Sign up' }));

    // replace, not push: pushing would grow a login/register/login stack that
    // the back gesture then has to walk all the way down.
    expect(mockReplace).toHaveBeenCalledWith('/register');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('holds registration back until the password is long enough', async () => {
    const screen = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy());

    fillSignUp(screen, { password: 'short', confirm: 'short' });
    fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 8 characters/i)).toBeTruthy();
  });

  it('registers once the whole form is filled in', async () => {
    const screen = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy());

    fillSignUp(screen);
    fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() =>
      // Trimmed on the way out, for the same reason sign in trims the address:
      // a phone keyboard appends a space and nobody means it to be part of
      // their name.
      expect(mockedApi.post).toHaveBeenCalledWith('/auth/register', {
        first_name: 'Sara',
        last_name: 'Khan',
        email: 'new@forkast.app',
        password: 'longenough',
      }),
    );
  });

  it('asks for a first and last name before anything else', async () => {
    const screen = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter your first name/)).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('Sara'), 'Sara');
    fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter your last name/)).toBeTruthy();
  });

  it('refuses a name that is only whitespace', async () => {
    // The server refuses it too, and this is the half that says so without a
    // round trip. A field holding one space passes a bare "is it empty" check
    // and stores a name that renders as a blank line.
    const screen = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy());

    fillSignUp(screen, { first: '   ' });
    fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter your first name/)).toBeTruthy();
  });

  it('will not register two passwords that disagree', async () => {
    /**
     * The whole reason the confirmation field exists.
     *
     * A mistyped password in a masked field, on an account that does not exist
     * yet, has nothing to be checked against later and no email to recover
     * through. The first the user would hear of it is being unable to sign in
     * to an account they had just made.
     */
    const screen = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy());

    fillSignUp(screen, { confirm: 'longenougi' });
    fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(screen.getByText(/passwords are different/)).toBeTruthy();
  });

  it('says the two disagree while they still do, rather than after a press', async () => {
    const screen = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy());

    fireEvent.changeText(screen.getByPlaceholderText('At least 8 characters'), 'longenough');
    fireEvent.changeText(screen.getByPlaceholderText('Type it once more'), 'l');

    expect(screen.getByText(/does not match the password above/)).toBeTruthy();

    // And stops saying it the moment they agree, rather than waiting to be
    // pressed again.
    fireEvent.changeText(screen.getByPlaceholderText('Type it once more'), 'longenough');
    expect(screen.queryByText(/does not match the password above/)).toBeNull();
  });

  it('hides both passwords until the eye is pressed, one field at a time', async () => {
    /**
     * Section 3: the control has to be addressable, and it has to say which
     * field it belongs to. Two eyes on one screen answering to the same name
     * would be two controls a screen reader cannot tell apart.
     */
    const screen = render(<RegisterScreen />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy());

    expect(screen.getByPlaceholderText('At least 8 characters').props.secureTextEntry).toBe(true);
    expect(screen.getByPlaceholderText('Type it once more').props.secureTextEntry).toBe(true);

    const eyes = screen.getAllByRole('button', { name: 'Show password' });
    expect(eyes).toHaveLength(2);
    expect(eyes.map((eye) => eye.props.accessibilityHint)).toEqual([
      'Password field',
      'Confirm password field',
    ]);

    fireEvent.press(eyes[0]);

    // Only the one that was pressed. An eye that revealed both would undo the
    // point of having one per field.
    expect(screen.getByPlaceholderText('At least 8 characters').props.secureTextEntry).toBe(false);
    expect(screen.getByPlaceholderText('Type it once more').props.secureTextEntry).toBe(true);
    // And it now offers the opposite action rather than repeating itself.
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });

  it('lets someone reveal their sign in password', async () => {
    const screen = render(<LoginScreen />, { wrapper });
    await waitFor(() => expect(screen.getByPlaceholderText('Your password')).toBeTruthy());

    expect(screen.getByPlaceholderText('Your password').props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByPlaceholderText('Your password').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
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
