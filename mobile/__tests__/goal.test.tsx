/**
 * What a goal does now that it is more than a word.
 *
 * Picking a goal used to reach the plan prompt and nothing else, so it changed
 * no number anyone could see. It now proposes the daily target, which is the
 * one figure the dashboard measures a day against, and then gets out of the
 * way. Two things are worth pinning down: the numbers it proposes, and the
 * promise that it never overwrites a number someone typed.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import SetupScreen from '../app/setup';
import { AuthProvider } from '../hooks/useAuth';
import { GOALS, type Goal } from '../lib/types';
import { GOAL_BLURBS, GOAL_LABELS, formatNumber, suggestedTarget } from '../lib/format';
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

/** What ck_users_calorie_target_plausible allows, which is what the server takes. */
const MIN_TARGET = 0;
const MAX_TARGET = 10_000;

describe('the target a goal suggests', () => {
  it('sends someone eating less down and someone eating more up', () => {
    expect(suggestedTarget('cut')).toBeLessThan(suggestedTarget('maintain'));
    expect(suggestedTarget('maintain')).toBeLessThan(suggestedTarget('bulk'));
  });

  it('opens a maintenance day at the reference intake on a food label', () => {
    expect(suggestedTarget('maintain')).toBe(2000);
  });

  it('takes off 500 a day to lose, which is about half a kilo a week', () => {
    // Half a kilo of fat is roughly 3,500 kcal, so 500 a day for seven days.
    expect(suggestedTarget('maintain') - suggestedTarget('cut')).toBe(500);
  });

  it('adds a smaller surplus to gain than it takes away to lose', () => {
    // Overshooting a gain mostly adds fat, so the two directions are not
    // mirror images of each other and this test says so on purpose.
    const deficit = suggestedTarget('maintain') - suggestedTarget('cut');
    const surplus = suggestedTarget('bulk') - suggestedTarget('maintain');

    expect(surplus).toBeGreaterThan(0);
    expect(surplus).toBeLessThan(deficit);
  });

  it('never suggests a number the server would refuse', () => {
    for (const goal of GOALS) {
      expect(suggestedTarget(goal)).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(suggestedTarget(goal)).toBeLessThanOrEqual(MAX_TARGET);
    }
  });

  it('suggests a round number, since nobody counts to the calorie', () => {
    for (const goal of GOALS) {
      expect(suggestedTarget(goal) % 100).toBe(0);
    }
  });
});

describe('the words on the goal', () => {
  it('names the number it is about to set, so the copy cannot drift from it', () => {
    for (const goal of GOALS) {
      expect(GOAL_BLURBS[goal]).toContain(formatNumber(suggestedTarget(goal)));
    }
  });

  it('says which way the weight is going, rather than using gym shorthand', () => {
    expect(GOAL_LABELS.cut).toMatch(/loss/i);
    expect(GOAL_LABELS.bulk).toMatch(/gain/i);
    expect(new Set(Object.values(GOAL_LABELS)).size).toBe(GOALS.length);
  });
});

/** An iPhone 14, so the screen lays out against a real safe area. */
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

const FIELD = 'e.g. 2000';

function openSetup() {
  const screen = render(<SetupScreen />, { wrapper });
  return { screen, input: screen.getByPlaceholderText(FIELD) };
}

/** The chip for a goal, which carries the selected state a screen reader reads. */
function chipFor(screen: ReturnType<typeof render>, goal: Goal) {
  return screen.getByRole('button', { name: GOAL_LABELS[goal] });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.patch.mockResolvedValue({ data: {} });
});

describe('setting up, where the goal fills the target in', () => {
  it('opens with the suggestion for the goal it opens on', () => {
    const { screen, input } = openSetup();

    expect(chipFor(screen, 'maintain').props.accessibilityState.selected).toBe(true);
    expect(input.props.value).toBe(String(suggestedTarget('maintain')));
  });

  it('moves the number when a different goal is picked', () => {
    const { screen, input } = openSetup();

    fireEvent.press(screen.getByText(GOAL_LABELS.cut));

    expect(input.props.value).toBe(String(suggestedTarget('cut')));
  });

  it('follows the goal for as long as the number is still ours', () => {
    const { screen, input } = openSetup();

    fireEvent.press(screen.getByText(GOAL_LABELS.cut));
    fireEvent.press(screen.getByText(GOAL_LABELS.bulk));

    expect(input.props.value).toBe(String(suggestedTarget('bulk')));
  });

  it('leaves a number someone typed exactly where they left it', () => {
    // The promise the whole feature rests on: a suggestion is a starting
    // point, never a correction of something considered.
    const { screen, input } = openSetup();

    fireEvent.changeText(input, '1750');
    fireEvent.press(screen.getByText(GOAL_LABELS.bulk));

    expect(input.props.value).toBe('1750');
  });

  it('keeps hands off even when the field was emptied on purpose', () => {
    const { screen, input } = openSetup();

    fireEvent.changeText(input, '');
    fireEvent.press(screen.getByText(GOAL_LABELS.cut));

    expect(input.props.value).toBe('');
  });

  it('still picks the goal that was tapped, prefill or no prefill', () => {
    const { screen, input } = openSetup();

    fireEvent.changeText(input, '1750');
    fireEvent.press(screen.getByText(GOAL_LABELS.cut));

    expect(chipFor(screen, 'cut').props.accessibilityState.selected).toBe(true);
  });

  it('explains what the number does, since that is what the goal was missing', () => {
    const { screen } = openSetup();

    expect(screen.getByText(/measures every day against this number/)).toBeTruthy();
  });
});

describe('what setup sends', () => {
  it('saves the goal and the target it filled in together', async () => {
    const { screen } = openSetup();

    fireEvent.press(screen.getByText(GOAL_LABELS.cut));
    fireEvent.press(screen.getByText('Start logging'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        '/me',
        expect.objectContaining({ goal: 'cut', daily_calorie_target: suggestedTarget('cut') }),
      ),
    );
  });

  it('saves the number that was typed over the suggestion', async () => {
    const { screen, input } = openSetup();

    fireEvent.changeText(input, '1750');
    fireEvent.press(screen.getByText('Start logging'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        '/me',
        expect.objectContaining({ daily_calorie_target: 1750 }),
      ),
    );
  });

  it('accepts a low number, because there is no floor to argue with', async () => {
    const { screen, input } = openSetup();

    fireEvent.changeText(input, '400');
    fireEvent.press(screen.getByText('Start logging'));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        '/me',
        expect.objectContaining({ daily_calorie_target: 400 }),
      ),
    );
  });

  it('refuses a number the server would refuse, and says what the limit is', () => {
    const { screen, input } = openSetup();

    fireEvent.changeText(input, '99999');
    fireEvent.press(screen.getByText('Start logging'));

    expect(mockedApi.patch).not.toHaveBeenCalled();
    expect(screen.getByText(/up to 10,000/)).toBeTruthy();
  });

  it('sends no target at all when the setup is skipped', async () => {
    const { screen } = openSetup();

    fireEvent.press(screen.getByText('Skip for now'));

    await waitFor(() => expect(mockedApi.patch).toHaveBeenCalled());
    expect(mockedApi.patch.mock.calls[0][1]).not.toHaveProperty('daily_calorie_target');
  });
});
