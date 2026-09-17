/**
 * The daily calorie target on the profile screen.
 *
 * Worth testing on its own because the target is the first setting on this
 * screen that anything else reads. A goal chip that silently fails to save
 * costs nothing; a target that saves the wrong number, or fails to clear,
 * changes what the dashboard tells someone about their day.
 *
 * The server refuses anything outside 800 to 10,000 with a 422, so the
 * interesting cases here are the ones that should never reach it at all.
 *
 * The screen is now a column of settings rows rather than a column of cards, so
 * the field lives in the dialog its row opens. Every case below still asserts
 * the same thing; it just opens the row first.
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
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
  };
});

import { api, hydrateTokens } from '../lib/api';

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock; patch: jest.Mock };
const mockedHydrate = hydrateTokens as jest.Mock;

/** An iPhone 14, so the safe area the screen lays out against is a real one. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      // gcTime 0 so no collection timer outlives the test. The default five
      // minutes leaves a handle open and Jest warns that it could not exit.
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

const user = (target: number | null) => ({
  id: '01a0-aaaa',
  email: 'noor@example.com',
  timezone: 'Asia/Karachi',
  goal: 'maintain',
  daily_calorie_target: target,
  created_at: '2026-01-04T09:00:00Z',
});

/** Sign the screen in, then answer /me with whatever target this test needs. */
function signedInWith(target: number | null) {
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/me') return { data: user(target) };
    // The reminders hook reads logs and streaks off the same screen.
    if (url.startsWith('/logs')) return { data: { items: [], total: 0 } };
    if (url.startsWith('/streaks')) return { data: { current_streak: 0, longest_streak: 0 } };
    return { data: null };
  });
  mockedApi.patch.mockImplementation(
    async (_url: string, patch: { daily_calorie_target?: number | null }) => ({
      data: user(patch.daily_calorie_target ?? null),
    }),
  );
}

const FIELD = 'e.g. 2200';
const ROW = 'Daily calorie target';

/** Wait for the screen to sign in, then open the row the field lives behind. */
async function openTarget(screen: ReturnType<typeof render>) {
  const row = await waitFor(() => screen.getByText(ROW));
  fireEvent.press(row);
  return screen.getByPlaceholderText(FIELD);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('with no target set', () => {
  beforeEach(() => signedInWith(null));

  it('says what the number is for, since nothing else on the screen does', async () => {
    const { getByText } = render(<ProfileScreen />, { wrapper });

    await waitFor(() => expect(getByText(/what is left of the day/)).toBeTruthy());
  });

  it('shows that there is nothing set without being opened', async () => {
    const { getByText } = render(<ProfileScreen />, { wrapper });

    // The row carries its own value, which is the whole point of a settings
    // row: the screen answers the question before anything is tapped.
    await waitFor(() => expect(getByText('Not set')).toBeTruthy());
  });

  it('starts empty and keeps the action inert', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    const input = await openTarget(screen);

    expect(input.props.value).toBe('');

    fireEvent.press(screen.getByText('Set target'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
  });

  it('sends a valid target', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    const input = await openTarget(screen);

    fireEvent.changeText(input, '2200');
    fireEvent.press(screen.getByText('Set target'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', { daily_calorie_target: 2200 }),
    );
  });

  it('offers no clear action when there is nothing to clear', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    await openTarget(screen);

    expect(screen.queryByText('Clear target')).toBeNull();
  });
});

describe('what never reaches the server', () => {
  beforeEach(() => signedInWith(null));

  it('strips anything that is not a digit as it is typed', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    const input = await openTarget(screen);

    fireEvent.changeText(input, '2,2 0a0.');

    expect(input.props.value).toBe('2200');
  });

  it('accepts a low number, because there is no floor to argue with', async () => {
    // There used to be one, at 800. Forkast holds no height, weight, age or
    // activity level, so it was not a clinical minimum derived from anything;
    // it was the app refusing a number the user had deliberately chosen, with
    // no way around it.
    const screen = render(<ProfileScreen />, { wrapper });
    const input = await openTarget(screen);

    fireEvent.changeText(input, '500');
    fireEvent.press(screen.getByText('Set target'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        '/me',
        expect.objectContaining({ daily_calorie_target: 500 }),
      ),
    );
  });

  it('refuses a number above the ceiling and says what the limit is', async () => {
    // The ceiling stays. An extra digit is the error that silently makes every
    // day look like a success, which is the opposite of a low target, where
    // being wrong is obvious to the person who typed it.
    const screen = render(<ProfileScreen />, { wrapper });
    const input = await openTarget(screen);

    fireEvent.changeText(input, '99999');
    fireEvent.press(screen.getByText('Set target'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
    // Saying the limit beats a 422 read back from the server as a red line.
    expect(screen.getByText(/up to 10,000/)).toBeTruthy();
  });
});

describe('with a target already stored', () => {
  beforeEach(() => signedInWith(2000));

  it('shows the stored number on the row itself', async () => {
    const { getByText } = render(<ProfileScreen />, { wrapper });

    await waitFor(() => expect(getByText('2,000')).toBeTruthy());
  });

  it('prefills with what the server sent', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    const input = await openTarget(screen);

    await waitFor(() => expect(input.props.value).toBe('2000'));
  });

  it('will not resend an unchanged value', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    await openTarget(screen);

    fireEvent.press(screen.getByText('Update target'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
  });

  it('sends a changed value', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    const input = await openTarget(screen);

    fireEvent.changeText(input, '2400');
    fireEvent.press(screen.getByText('Update target'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', { daily_calorie_target: 2400 }),
    );
  });

  it('does not overwrite what is being typed when the query settles', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    const input = await openTarget(screen);

    fireEvent.changeText(input, '1800');

    // The stored value arriving late must not clobber the draft.
    await waitFor(() => expect(input.props.value).toBe('1800'));
  });

  it('clears the target with an action of its own, sending null', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    await openTarget(screen);

    fireEvent.press(screen.getByText('Clear target'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', { daily_calorie_target: null }),
    );
  });

  it('empties the field once the target is gone', async () => {
    const screen = render(<ProfileScreen />, { wrapper });
    const input = await openTarget(screen);
    await waitFor(() => expect(input.props.value).toBe('2000'));

    fireEvent.press(screen.getByText('Clear target'));

    await waitFor(() => expect(screen.getByText('Not set')).toBeTruthy());
    const reopened = await openTarget(screen);
    expect(reopened.props.value).toBe('');
  });
});
