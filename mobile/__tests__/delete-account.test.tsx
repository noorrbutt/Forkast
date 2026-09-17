/**
 * Closing the account.
 *
 * Every test here is about friction in the right places: it should be findable,
 * and it should be hard to do by accident, because nothing about it can be
 * undone afterwards.
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

/** Accept the confirmation dialog, as a user tapping the destructive option. */
function acceptTheAlert() {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.delete.mockResolvedValue({ data: undefined });
  mockedApi.post.mockResolvedValue({ data: undefined });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

it('stays collapsed until asked for', () => {
  const { getByText, queryByPlaceholderText } = render(<DeleteAccount />, { wrapper });

  expect(getByText('Delete my account')).toBeTruthy();
  // No password field sitting on the Profile tab waiting to be filled in.
  expect(queryByPlaceholderText('Your password')).toBeNull();
});

it('asks for the password once opened', () => {
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

it('will not delete without a password', () => {
  const { getByText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));

  fireEvent.press(getByText('Delete for good'));

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockedApi.delete).not.toHaveBeenCalled();
});

it('confirms before doing anything, even with a password typed', () => {
  const { getByText, getByPlaceholderText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));
  fireEvent.changeText(getByPlaceholderText('Your password'), 'password123');

  fireEvent.press(getByText('Delete for good'));

  expect(Alert.alert).toHaveBeenCalled();
  expect(mockedApi.delete).not.toHaveBeenCalled();
});

it('deletes once the confirmation is accepted', async () => {
  acceptTheAlert();
  const { getByText, getByPlaceholderText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));
  fireEvent.changeText(getByPlaceholderText('Your password'), 'password123');

  fireEvent.press(getByText('Delete for good'));

  await waitFor(() =>
    expect(mockedApi.delete).toHaveBeenCalledWith('/me', { data: { password: 'password123' } }),
  );
});

it('signs out afterwards, so no dead token is left behind', async () => {
  acceptTheAlert();
  const { getByText, getByPlaceholderText } = render(<DeleteAccount />, { wrapper });
  fireEvent.press(getByText('Delete my account'));
  fireEvent.changeText(getByPlaceholderText('Your password'), 'password123');

  fireEvent.press(getByText('Delete for good'));

  // Leaving the tokens in the keystore would park the user in the tabs with
  // every request failing, which is the trap this app fell into once already.
  await waitFor(() => expect(mockedClear).toHaveBeenCalled());
});

it('surfaces a wrong password rather than swallowing it', async () => {
  acceptTheAlert();
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

  fireEvent.press(getByText('Cancel'));

  expect(queryByPlaceholderText('Your password')).toBeNull();
});
