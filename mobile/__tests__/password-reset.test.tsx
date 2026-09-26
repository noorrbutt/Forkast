import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPost = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue(undefined);
let mockParams: { token?: string; stage?: string } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: jest.fn(), push: mockPush, replace: mockReplace }),
}));
jest.mock('../lib/api', () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
  describeError: (error: unknown) => (error instanceof Error ? error.message : 'Request failed.'),
}));
jest.mock('../hooks/useAuth', () => ({ useAuth: () => ({ signOut: mockSignOut }) }));

import ForgotPasswordScreen from '../app/(auth)/forgot-password';
import ResetConfirmationScreen from '../app/(auth)/reset-confirmation';
import ResetPasswordScreen from '../app/(auth)/reset-password';
import { ThemeProvider } from '../theme';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignOut.mockResolvedValue(undefined);
  mockParams = {};
  mockPost.mockResolvedValue({ data: { detail: 'ok' } });
});

it('requests a password reset and navigates to generic confirmation', async () => {
  const screen = render(<ForgotPasswordScreen />, { wrapper });
  fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), 'person@example.com');
  fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));

  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', {
      email: 'person@example.com',
    }),
  );
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/reset-confirmation',
    params: { stage: 'request' },
  });
});

it('submits a matching new password and reveals the secure fields', async () => {
  mockParams = { token: 'password-reset-token-from-email' };
  const screen = render(<ResetPasswordScreen />, { wrapper });

  expect(screen.getByPlaceholderText('At least 8 characters').props.secureTextEntry).toBe(true);
  expect(screen.getByPlaceholderText('Type it once more').props.secureTextEntry).toBe(true);
  expect(screen.getAllByRole('button', { name: 'Show password' })).toHaveLength(2);

  fireEvent.changeText(screen.getByPlaceholderText('At least 8 characters'), 'strongpassword');
  fireEvent.changeText(screen.getByPlaceholderText('Type it once more'), 'strongpassword');
  fireEvent.press(screen.getByRole('button', { name: 'Reset password' }));

  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'password-reset-token-from-email',
      new_password: 'strongpassword',
    }),
  );
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/reset-confirmation',
    params: { stage: 'reset' },
  });
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});

it('shows separate confirmation after a successful reset and returns to login', () => {
  mockParams = { stage: 'reset' };
  const screen = render(<ResetConfirmationScreen />, { wrapper });

  expect(screen.getByText('Your password has been updated. Sign in with the new one.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(mockReplace).toHaveBeenCalledWith('/login');
});

it('offers a new link after the reset token is rejected', async () => {
  mockParams = { token: 'expired-reset-token' };
  mockPost.mockRejectedValueOnce(new Error('Password reset link is invalid or expired.'));
  const screen = render(<ResetPasswordScreen />, { wrapper });

  fireEvent.changeText(screen.getByPlaceholderText('At least 8 characters'), 'strongpassword');
  fireEvent.changeText(screen.getByPlaceholderText('Type it once more'), 'strongpassword');
  fireEvent.press(screen.getByRole('button', { name: 'Reset password' }));
  await screen.findByText('Password reset link is invalid or expired.');
  fireEvent.press(screen.getByRole('button', { name: 'Request another reset link' }));

  expect(mockReplace).toHaveBeenCalledWith('/forgot-password');
});
