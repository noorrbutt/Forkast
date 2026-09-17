/**
 * Closing the account.
 *
 * Every test here is about friction in the right places: it should be findable,
 * and it should be hard to do by accident, because nothing about it can be
 * undone afterwards.
 *
 * The confirmation moved from an inline expansion plus an operating system
 * alert into one dialog on the page, so these cases follow it there rather than
 * being thrown away. What they assert has not changed.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeleteAccount } from '../components/DeleteAccount';
import { AuthProvider } from '../hooks/useAuth';
import { api, clearTokens } from '../lib/api';
import { ThemeProvider } from '../theme';

// The real AuthProvider, not a stand in. useDeleteAccount calls useAuth from
// inside its own module, so mocking the export would not intercept it, and a
// test that cannot see the real wiring is not testing the thing that broke
// before: a dead token left in the keystore.
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { delete: jest.fn(), post: jest.fn() },
    hydrateTokens: jest.fn().mockResolvedValue({ access_token: 'a', refresh_token: 'r' }),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => 'r'),
    setAuthFailureHandler: jest.fn(),
  };
});

const mockedApi = api as unknown as { delete: jest.Mock; post: jest.Mock };
const mockedClear = clearTokens as jest.Mock;

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

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.delete.mockResolvedValue({ data: undefined });
  mockedApi.post.mockResolvedValue({ data: undefined });
  // Spied rather than left alone, so a stray operating system alert would show
  // up in these assertions instead of quietly doing nothing in the runner.
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

it('keeps the password field behind the dialog', () => {
  const { getByText, queryByPlaceholderText } = render(<DeleteAccount />, { wrapper });

  expect(getByText('Delete my account')).toBeTruthy();
  // No password field sitting on the Profile tab waiting to be filled in.
  expect(queryByPlaceholderText('Your password')).toBeNull();
});

it('asks for the password once the dialog is open', () => {
  const { getByText, getByPlaceholderText } = render(<DeleteAccount />, { wrapper });

  fireEvent.press(getByText('Delete my account'));

  expect(getByPlaceholderText('Your password')).toBeTruthy();
  expect(getByText(/signs out every device/)).toBeTruthy();
});

it('says what survives, since that is not obvious', () => {
  const { getByText } = render(<DeleteAccount />, { wrapper });

  fireEvent.press(getByText('Delete my account'));

  expect(getByText(/Restaurants you added stay/)).toBeTruthy();
});

it('asks on the page rather than handing the question to the operating system', () => {
  const { getByText } = render(<DeleteAccount />, { wrapper });

  fireEvent.press(getByText('Delete my account'));

  // An Alert cannot hold a password field, looks nothing like the app, and on
  // web is a browser alert box.
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(getByText('Delete your account?')).toBeTruthy();
});

it('will not delete without a password', () => {
  const { getByText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));

  fireEvent.press(getByText('Delete for good'));

  expect(mockedApi.delete).not.toHaveBeenCalled();
});

it('does nothing on the way in, even with a password typed', () => {
  const { getByText, getByPlaceholderText } = render(<DeleteAccount />, { wrapper });

  fireEvent.press(getByText('Delete my account'));
  fireEvent.changeText(getByPlaceholderText('Your password'), 'password123');

  // Opening the dialog and filling it in is not consent. Only the destructive
  // action inside it is.
  expect(mockedApi.delete).not.toHaveBeenCalled();
});

it('deletes once the destructive action is taken', async () => {
  const { getByText, getByPlaceholderText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));
  fireEvent.changeText(getByPlaceholderText('Your password'), 'password123');

  fireEvent.press(getByText('Delete for good'));

  await waitFor(() =>
    expect(mockedApi.delete).toHaveBeenCalledWith('/me', { data: { password: 'password123' } }),
  );
});

it('signs out afterwards, so no dead token is left behind', async () => {
  const { getByText, getByPlaceholderText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));
  fireEvent.changeText(getByPlaceholderText('Your password'), 'password123');

  fireEvent.press(getByText('Delete for good'));

  // Leaving the tokens in the keystore would park the user in the tabs with
  // every request failing, which is the trap this app fell into once already.
  await waitFor(() => expect(mockedClear).toHaveBeenCalled());
});

it('surfaces a wrong password rather than swallowing it', async () => {
  mockedApi.delete.mockRejectedValue(
    Object.assign(new Error('failed'), {
      isAxiosError: true,
      response: { status: 403, data: { detail: 'That password does not match.' } },
      config: {},
      toJSON: () => ({}),
    }),
  );
  const { getByText, getByPlaceholderText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));
  fireEvent.changeText(getByPlaceholderText('Your password'), 'wrong');

  fireEvent.press(getByText('Delete for good'));

  await waitFor(() => expect(getByText(/does not match/)).toBeTruthy());
  expect(mockedClear).not.toHaveBeenCalled();
});

it('can be backed out of', () => {
  const { getByText, queryByPlaceholderText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));

  fireEvent.press(getByText('Keep my account'));

  expect(queryByPlaceholderText('Your password')).toBeNull();
});

it('forgets the typed password when it is backed out of', () => {
  const { getByText, getByPlaceholderText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));
  fireEvent.changeText(getByPlaceholderText('Your password'), 'password123');

  fireEvent.press(getByText('Keep my account'));
  fireEvent.press(getByText('Delete my account'));

  expect(getByPlaceholderText('Your password').props.value).toBe('');
});
