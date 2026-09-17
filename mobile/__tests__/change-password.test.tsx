/**
 * Changing the password from the Profile tab.
 *
 * Two things are worth proving here and neither is the happy path. The first is
 * that the rules the app already knows are enforced without a round trip, so a
 * mistyped confirmation is answered instantly rather than by a red line
 * arriving from the network a second later. The second is that a 403, which on
 * this endpoint has exactly one cause, is read back as that cause rather than
 * as a number.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ChangePassword } from '../components/ChangePassword';
import { api } from '../lib/api';
import { ThemeProvider } from '../theme';

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { put: jest.fn() },
  };
});

const mockedApi = api as unknown as { put: jest.Mock };

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
        <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** What axios hands a caller when the server refuses. */
function refusal(status: number, detail?: string) {
  return Object.assign(new Error('failed'), {
    isAxiosError: true,
    response: { status, data: detail ? { detail } : {} },
    config: {},
    toJSON: () => ({}),
  });
}

const CURRENT = 'Your current password';
const NEXT = 'Your new password';
const AGAIN = 'Type it again';

/** Open the dialog and fill it in, which is the start of nearly every case. */
function fill(
  screen: ReturnType<typeof render>,
  { current = 'oldpassword', next = 'newpassword', again = 'newpassword' } = {},
) {
  fireEvent.press(screen.getByText('Change password'));
  fireEvent.changeText(screen.getByPlaceholderText(CURRENT), current);
  fireEvent.changeText(screen.getByPlaceholderText(NEXT), next);
  fireEvent.changeText(screen.getByPlaceholderText(AGAIN), again);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.put.mockResolvedValue({ data: undefined });
});

it('keeps the fields behind the dialog', () => {
  const { getByText, queryByPlaceholderText } = render(<ChangePassword />, { wrapper });

  expect(getByText('Change password')).toBeTruthy();
  // No password form sitting open on a tab nobody came here to fill in.
  expect(queryByPlaceholderText(CURRENT)).toBeNull();
});

it('asks for the current password, a new one, and the new one again', () => {
  const screen = render(<ChangePassword />, { wrapper });

  fireEvent.press(screen.getByText('Change password'));

  expect(screen.getByPlaceholderText(CURRENT)).toBeTruthy();
  expect(screen.getByPlaceholderText(NEXT)).toBeTruthy();
  expect(screen.getByPlaceholderText(AGAIN)).toBeTruthy();
});

it('will not send without the current password', () => {
  const screen = render(<ChangePassword />, { wrapper });
  fill(screen, { current: '' });

  fireEvent.press(screen.getByText('Update password'));

  expect(mockedApi.put).not.toHaveBeenCalled();
  expect(screen.getByText('Enter your current password.')).toBeTruthy();
});

it('refuses a new password under eight characters before asking the server', () => {
  const screen = render(<ChangePassword />, { wrapper });
  fill(screen, { next: 'short', again: 'short' });

  fireEvent.press(screen.getByText('Update password'));

  expect(mockedApi.put).not.toHaveBeenCalled();
  expect(screen.getByText('Your new password needs at least 8 characters.')).toBeTruthy();
});

it('refuses a confirmation that does not match', () => {
  const screen = render(<ChangePassword />, { wrapper });
  fill(screen, { again: 'newpasswordd' });

  fireEvent.press(screen.getByText('Update password'));

  expect(mockedApi.put).not.toHaveBeenCalled();
  expect(screen.getByText('The two new passwords do not match.')).toBeTruthy();
});

it('sends the change once both rules pass', async () => {
  const screen = render(<ChangePassword />, { wrapper });
  fill(screen);

  fireEvent.press(screen.getByText('Update password'));

  await waitFor(() =>
    expect(mockedApi.put).toHaveBeenCalledWith('/me/password', {
      current_password: 'oldpassword',
      new_password: 'newpassword',
    }),
  );
});

it('reads a refusal back as a wrong current password, not as a status', async () => {
  mockedApi.put.mockRejectedValue(refusal(403));
  const screen = render(<ChangePassword />, { wrapper });
  fill(screen);

  fireEvent.press(screen.getByText('Update password'));

  await waitFor(() => expect(screen.getByText('That is not your current password.')).toBeTruthy());
  // "Request failed with status 403" tells someone who mistyped their own
  // password nothing they can act on.
  expect(screen.queryByText(/status 403/)).toBeNull();
});

it('passes on what the server said when the failure is something else', async () => {
  mockedApi.put.mockRejectedValue(refusal(500, 'Try again in a minute.'));
  const screen = render(<ChangePassword />, { wrapper });
  fill(screen);

  fireEvent.press(screen.getByText('Update password'));

  await waitFor(() => expect(screen.getByText('Try again in a minute.')).toBeTruthy());
});

it('closes and says so once the password is changed', async () => {
  const screen = render(<ChangePassword />, { wrapper });
  fill(screen);

  fireEvent.press(screen.getByText('Update password'));

  await waitFor(() => expect(mockedApi.put).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText('Password updated.')).toBeTruthy());
  expect(screen.queryByPlaceholderText(CURRENT)).toBeNull();
});

it('forgets what was typed when it is backed out of', () => {
  const screen = render(<ChangePassword />, { wrapper });
  fill(screen);

  fireEvent.press(screen.getByText('Cancel'));
  fireEvent.press(screen.getByText('Change password'));

  // A password left in state is a password left in a heap dump.
  expect(screen.getByPlaceholderText(CURRENT).props.value).toBe('');
  expect(screen.getByPlaceholderText(NEXT).props.value).toBe('');
});
