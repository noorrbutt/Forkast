/**
 * The onboarding quiz: two questions, one per step, both skippable, neither
 * ever blocking the account from reaching setup.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import OnboardingScreen from '../app/onboarding';
import { AuthProvider } from '../hooks/useAuth';
import { ThemeProvider } from '../theme';

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
    hydrateTokens: jest.fn().mockResolvedValue(null),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
  };
});

import { api } from '../lib/api';

const mockedApi = api as unknown as { get: jest.Mock; post: jest.Mock; patch: jest.Mock };

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

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

function openOnboarding() {
  return render(<OnboardingScreen />, { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.patch.mockResolvedValue({ data: {} });
});

describe('the eating out question', () => {
  it('opens on the first question with nothing picked', () => {
    const screen = openOnboarding();

    expect(screen.getByText('How often do you eat out?')).toBeTruthy();
  });

  it('moves to the struggle question once an answer is picked', () => {
    const screen = openOnboarding();

    fireEvent.press(screen.getByText('Often'));

    expect(screen.getByText('What trips you up most?')).toBeTruthy();
  });

  it('advances to the second question without sending anything when skipped', () => {
    const screen = openOnboarding();

    fireEvent.press(screen.getAllByText('Skip this')[0]);

    expect(screen.getByText('What trips you up most?')).toBeTruthy();
    expect(mockedApi.patch).not.toHaveBeenCalled();
  });
});

describe('what the quiz sends', () => {
  it('saves both answers together', async () => {
    const screen = openOnboarding();

    fireEvent.press(screen.getByText('Often'));
    fireEvent.press(screen.getByText('Cravings'));
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', {
        eating_out_frequency: 'often',
        biggest_struggle: 'cravings',
      }),
    );
  });

  it('keeps the first answer when the second is skipped', async () => {
    const screen = openOnboarding();

    fireEvent.press(screen.getByText('Rarely'));
    fireEvent.press(screen.getAllByText('Skip this')[0]);

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith('/me', { eating_out_frequency: 'rarely' }),
    );
  });

  it('sends nothing at all when both questions are skipped', () => {
    const screen = openOnboarding();

    fireEvent.press(screen.getByText('Skip this'));
    fireEvent.press(screen.getByText('Skip this'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
  });
});
