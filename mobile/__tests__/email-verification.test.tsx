import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPost = jest.fn();
const mockReplace = jest.fn();
let mockParams: { email?: string; token?: string } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('../hooks/useAuth', () => ({ useAuth: () => ({ needsSetup: true }) }));
jest.mock('../lib/api', () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
  describeError: (error: unknown) => (error instanceof Error ? error.message : 'Request failed.'),
}));

import CheckEmailScreen from '../app/(auth)/check-email';
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
  mockParams = { email: 'new@forkast.app' };
  mockPost.mockResolvedValue({ data: { detail: 'Email verified.' } });
});

it('verifies the email-link token and lets the user continue to setup', async () => {
  mockParams = { token: 'verification-token-from-email' };
  const screen = render(<CheckEmailScreen />, { wrapper });

  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith('/auth/verify-email', {
      token: 'verification-token-from-email',
    }),
  );
  expect(await screen.findByText('Your email address is verified.')).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Continue to Forkast' }));
  expect(mockReplace).toHaveBeenCalledWith('/setup');
});

it('resends safely and keeps the continue action available without verification', async () => {
  const screen = render(<CheckEmailScreen />, { wrapper });

  fireEvent.press(screen.getByRole('button', { name: 'Resend verification email' }));
  await waitFor(() =>
    expect(mockPost).toHaveBeenCalledWith('/auth/resend-verification', {
      email: 'new@forkast.app',
    }),
  );
  expect(
    await screen.findByText('If that address needs verification, a link is on its way.'),
  ).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Continue to Forkast' }));
  expect(mockReplace).toHaveBeenCalledWith('/setup');
});

it('offers resend when an emailed verification link is no longer valid', async () => {
  mockParams = { email: 'new@forkast.app', token: 'expired-token' };
  mockPost.mockRejectedValueOnce(new Error('Verification link is invalid or expired.'));
  const screen = render(<CheckEmailScreen />, { wrapper });

  await screen.findByText('This verification link could not be used.');
  fireEvent.press(screen.getByRole('button', { name: 'Resend verification email' }));

  await waitFor(() =>
    expect(mockPost).toHaveBeenLastCalledWith('/auth/resend-verification', {
      email: 'new@forkast.app',
    }),
  );
});