/**
 * Logging a meal again.
 *
 * The server does the work: /logs/{id}/repeat copies the row onto today. That
 * leaves the interesting failures on this side, and they are the kind a
 * screenshot never shows. A tap that succeeds in silence reads as a tap that
 * did nothing, so it gets pressed again and two dinners land. A tap that fails
 * in silence reads exactly the same way. And on the diary the button sits
 * inside a row that opens the meal, so pressing one must never do the other.
 *
 * Each of those is asserted here rather than left to a careful reading.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Jest hoists mock factories above these declarations, so the names they reach
// into have to carry the mock prefix that marks them as safe.
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockNavigate = jest.fn();
/** The meal the detail screen is opened on, and the second row in the diary. */
const mockDetailId = 'log-nihari';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    navigate: mockNavigate,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ id: mockDetailId }),
}));

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
  };
});

import HistoryScreen from '../app/(tabs)/history';
import EditLogScreen from '../app/logs/[id]';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider } from '../theme';

const mockedApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
};
const mockedHydrate = hydrateTokens as jest.Mock;
const mockedHaptic = Haptics.notificationAsync as jest.Mock;

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

const meal = (id: string, dishName: string) => ({
  id,
  dish_name: dishName,
  category_id: 4,
  restaurant_id: null,
  area: 'Gulberg',
  rating: 4,
  fun_scale: 3,
  friend_scale: 'solo',
  serving_size: 'medium',
  estimated_calories: 820,
  created_at: '2026-09-15T19:20:00Z',
  category: { id: 4, name: 'Karahi', is_junk: false, base_calorie_min: 600, base_calorie_max: 900 },
  restaurant: null,
});

const BIRYANI = meal('log-biryani', 'Chicken biryani');
const NIHARI = meal(mockDetailId, 'Nihari');

/** What the server answers with: the same meal, a new row, today. */
const COPY = { ...NIHARI, id: 'log-fresh', created_at: '2026-09-17T13:00:00Z' };

/** A 404 shaped the way axios delivers one, so describeError reads the detail. */
const GONE = Object.assign(new Error('Request failed with status code 404'), {
  isAxiosError: true,
  response: { status: 404, data: { detail: 'That meal is no longer in your diary.' } },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/me') {
      return {
        data: {
          id: 'user-1',
          email: 'noor@example.com',
          timezone: 'Asia/Karachi',
          goal: 'maintain',
          daily_calorie_target: 2200,
          created_at: '2026-01-04T09:00:00Z',
        },
      };
    }
    if (url === '/logs') return { data: { items: [BIRYANI, NIHARI], total: 2 } };
    if (url === '/logs/' + mockDetailId) return { data: NIHARI };
    if (url === '/categories') return { data: [] };
    return { data: null };
  });
  mockedApi.post.mockResolvedValue({ data: COPY });
});

describe('from the diary', () => {
  /**
   * Tapping "Log again" asks before it writes anything.
   *
   * It used to fire on the tap. It creates a real row that then has to be found
   * and deleted, and the button sits on a row that is itself pressable, so it
   * is easy to catch while scrolling. One question is cheaper than an undo that
   * does not exist.
   */
  const confirm = (screen: ReturnType<typeof render>) =>
    fireEvent.press(screen.getByText('Log it again'));

  it('asks before it writes anything', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    const buttons = await waitFor(() => screen.getAllByText('Log again'));

    fireEvent.press(buttons[0]);

    expect(screen.getByText('Log this again?')).toBeTruthy();
    // Nothing sent until the question is answered.
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('names the meal and the figure it is about to add', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    const buttons = await waitFor(() => screen.getAllByText('Log again'));

    fireEvent.press(buttons[0]);

    // A confirmation that does not say what it is confirming is a speed bump.
    // Matched on the dialog's own wording rather than on the dish name alone,
    // which appears on the row behind it too.
    const message = screen.getByText(/goes into today/);
    expect(message.props.children).toMatch(/Chicken biryani/);
  });

  it('writes nothing when the question is declined', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    const buttons = await waitFor(() => screen.getAllByText('Log again'));

    fireEvent.press(buttons[0]);
    fireEvent.press(screen.getByText('Cancel'));

    expect(screen.queryByText('Log this again?')).toBeNull();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('repeats the meal the button belongs to, not the first one on the list', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    const buttons = await waitFor(() => screen.getAllByText('Log again'));

    fireEvent.press(buttons[1]);
    confirm(screen);

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/logs/' + mockDetailId + '/repeat'),
    );
  });

  it('logs one meal however fast the second tap lands', async () => {
    let release: ((value: { data: typeof COPY }) => void) | undefined;
    mockedApi.post.mockImplementation(
      () =>
        new Promise<{ data: typeof COPY }>((resolve) => {
          release = resolve;
        }),
    );

    const screen = render(<HistoryScreen />, { wrapper });
    const { getByText } = screen;
    const buttons = await waitFor(() => screen.getAllByText('Log again'));

    fireEvent.press(buttons[0]);
    // The same confirm control twice, which is what an impatient thumb does.
    // Held as one element rather than looked up twice, because answering the
    // question closes the dialog, so a second lookup would find nothing and the
    // test would be asserting the dialog had closed rather than that the second
    // tap was refused.
    const confirmButton = screen.getByText('Log it again');
    fireEvent.press(confirmButton);
    fireEvent.press(confirmButton);

    await waitFor(() => expect(getByText('Logging')).toBeTruthy());
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();

    // Settle the request rather than leaving it hanging past the test, and
    // check the second tap did not arrive late behind the first.
    await act(async () => {
      release?.({ data: COPY });
    });
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
  });

  it('says the meal was logged, rather than leaving the tap unanswered', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    const { getByText } = screen;
    const buttons = await waitFor(() => screen.getAllByText('Log again'));

    fireEvent.press(buttons[0]);
    confirm(screen);

    await waitFor(() => expect(getByText('Logged again for today.')).toBeTruthy());
    expect(mockedHaptic).toHaveBeenCalledWith('success');
  });

  it('puts a refusal on the row instead of swallowing it', async () => {
    mockedApi.post.mockRejectedValue(GONE);

    const screen = render(<HistoryScreen />, { wrapper });
    const { getByText } = screen;
    const buttons = await waitFor(() => screen.getAllByText('Log again'));

    fireEvent.press(buttons[0]);
    confirm(screen);

    await waitFor(() => expect(getByText('That meal is no longer in your diary.')).toBeTruthy());
    expect(mockedHaptic).toHaveBeenCalledWith('error');
  });

  it('does not open the meal, which is what the rest of the row is for', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    const { getByText } = screen;
    const buttons = await waitFor(() => screen.getAllByText('Log again'));

    fireEvent.press(buttons[0]);
    confirm(screen);
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());

    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(getByText('Chicken biryani'));

    expect(mockPush).toHaveBeenCalledWith('/logs/log-biryani');
  });
});

describe('from the meal itself', () => {
  it('repeats the meal the screen is open on, and says so', async () => {
    const { getByText } = render(<EditLogScreen />, { wrapper });
    await waitFor(() => expect(getByText('Log this again')).toBeTruthy());

    fireEvent.press(getByText('Log this again'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/logs/' + mockDetailId + '/repeat'),
    );
    await waitFor(() => expect(getByText(/Logged again for today/)).toBeTruthy());
    expect(mockedHaptic).toHaveBeenCalledWith('success');
  });

  it('logs one meal however fast the second tap lands', async () => {
    let release: ((value: { data: typeof COPY }) => void) | undefined;
    mockedApi.post.mockImplementation(
      () =>
        new Promise<{ data: typeof COPY }>((resolve) => {
          release = resolve;
        }),
    );

    const { getByLabelText, getByText } = render(<EditLogScreen />, { wrapper });
    await waitFor(() => expect(getByText('Log this again')).toBeTruthy());

    // Held by its accessibility label, not its text: the label survives the
    // swap to a spinner, and the point of this test is the second tap.
    const button = getByLabelText('Log this again');
    fireEvent.press(button);
    fireEvent.press(button);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    expect(mockedApi.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.({ data: COPY });
    });
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
  });

  it('shows a refusal next to the button that asked for it', async () => {
    mockedApi.post.mockRejectedValue(GONE);

    const { getByText } = render(<EditLogScreen />, { wrapper });
    await waitFor(() => expect(getByText('Log this again')).toBeTruthy());

    fireEvent.press(getByText('Log this again'));

    await waitFor(() => expect(getByText('That meal is no longer in your diary.')).toBeTruthy());
  });
});
