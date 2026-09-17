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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('with no target set', () => {
  beforeEach(() => signedInWith(null));

  it('says what the number is for, since nothing else on the screen does', async () => {
    const { getByText } = render(<ProfileScreen />, { wrapper });

    await waitFor(() => expect(getByText(/what is left of the day/)).toBeTruthy());
  });

  it('starts empty and keeps the button inert', async () => {
    const { getByText, getByPlaceholderText } = render(<ProfileScreen />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText(FIELD));

    expect(input.props.value).toBe('');

    fireEvent.press(getByText('Set target'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
  });

  it('sends a valid target', async () => {
    const { getByText, getByPlaceholderText } = render(<ProfileScreen />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText(FIELD));

    fireEvent.changeText(input, '2200');
    fireEvent.press(getByText('Set target'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', { daily_calorie_target: 2200 }),
    );
  });

  it('offers no clear button when there is nothing to clear', async () => {
    const { queryByText, getByPlaceholderText } = render(<ProfileScreen />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText(FIELD)).toBeTruthy());

    expect(queryByText('Clear target')).toBeNull();
  });
});

describe('what never reaches the server', () => {
  beforeEach(() => signedInWith(null));

  it('strips anything that is not a digit as it is typed', async () => {
    const { getByPlaceholderText } = render(<ProfileScreen />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText(FIELD));

    fireEvent.changeText(input, '2,2 0a0.');

    expect(input.props.value).toBe('2200');
  });

  it('refuses a number below the floor and names the range', async () => {
    const { getByText, getByPlaceholderText } = render(<ProfileScreen />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText(FIELD));

    fireEvent.changeText(input, '500');
    fireEvent.press(getByText('Set target'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
    // Saying the range beats a 422 read back from the server as a red line.
    expect(getByText(/between 800 and 10,000/)).toBeTruthy();
  });

  it('refuses a number above the ceiling', async () => {
    const { getByText, getByPlaceholderText } = render(<ProfileScreen />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText(FIELD));

    fireEvent.changeText(input, '99999');
    fireEvent.press(getByText('Set target'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
    expect(getByText(/between 800 and 10,000/)).toBeTruthy();
  });
});

describe('with a target already stored', () => {
  beforeEach(() => signedInWith(2000));

  it('prefills with what the server sent', async () => {
    const { getByPlaceholderText } = render(<ProfileScreen />, { wrapper });

    await waitFor(() => expect(getByPlaceholderText(FIELD).props.value).toBe('2000'));
  });

  it('will not resend an unchanged value', async () => {
    const { getByText } = render(<ProfileScreen />, { wrapper });
    await waitFor(() => expect(getByText('Update target')).toBeTruthy());

    fireEvent.press(getByText('Update target'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
  });

  it('sends a changed value', async () => {
    const { getByText, getByPlaceholderText } = render(<ProfileScreen />, { wrapper });
    await waitFor(() => expect(getByText('Update target')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText(FIELD), '2400');
    fireEvent.press(getByText('Update target'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', { daily_calorie_target: 2400 }),
    );
  });

  it('does not overwrite what is being typed when the query settles', async () => {
    const { getByPlaceholderText } = render(<ProfileScreen />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText(FIELD));

    fireEvent.changeText(input, '1800');

    // The stored value arriving late must not clobber the draft.
    await waitFor(() => expect(input.props.value).toBe('1800'));
  });

  it('clears the target with an action of its own, sending null', async () => {
    const { getByText } = render(<ProfileScreen />, { wrapper });
    await waitFor(() => expect(getByText('Clear target')).toBeTruthy());

    fireEvent.press(getByText('Clear target'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', { daily_calorie_target: null }),
    );
  });

  it('empties the field once the target is gone', async () => {
    const { getByText, getByPlaceholderText } = render(<ProfileScreen />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText(FIELD).props.value).toBe('2000'));

    fireEvent.press(getByText('Clear target'));

    await waitFor(() => expect(getByPlaceholderText(FIELD).props.value).toBe(''));
  });
});
