/**
 * The diary and the meal behind it.
 *
 * These are composition rules with teeth, so they are asserted rather than
 * eyeballed. The diary is the one screen in the app that is correctly a list:
 * every meal weighs the same as every other and nothing in the payload ranks
 * them, so the work is grouping and alignment, not a hero. The meal screen is
 * the opposite: it answers one question, so exactly one thing leads, and which
 * thing that is depends on whether there is a photograph.
 *
 * The two things most likely to be quietly undone later are the day grouping
 * and the rule that a photoless meal still gets a real placeholder rather than
 * a camera glyph in a grey box, so both are pinned here.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { FlatList } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Jest hoists mock factories above these declarations, so the names they reach
// into have to carry the mock prefix that marks them as safe.
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockNavigate = jest.fn();
const mockDetailId = 'log-nihari';

jest.mock('expo-router', () => ({
  // A no-op is enough for every test here: nothing exercises what happens
  // when a screen loses focus, only that rendering a screen using the real
  // hook does not throw.
  useFocusEffect: jest.fn(),
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
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    getAccessToken: () => 'test-token',
    setAuthFailureHandler: jest.fn(),
  };
});

import HistoryScreen from '../app/(tabs)/history';
import MealScreen from '../app/logs/[id]';
import { Button, Skeleton } from '../components/ui';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider } from '../theme';

const mockedApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};
const mockedHydrate = hydrateTokens as jest.Mock;

/** An iPhone 14, so the safe area the screen lays out against is a real one. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      // gcTime 0 so no collection timer outlives the test.
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

type Meal = {
  id: string;
  dish_name: string;
  has_photo: boolean;
  estimated_calories: number;
  created_at: string;
  [key: string]: unknown;
};

/**
 * Timestamps sit in the middle of the UTC day on purpose.
 *
 * Grouping is by local day, which is the only grouping that matches what the
 * reader sees, so a fixture at 23:50Z would land on two different days
 * depending on where the test is run. Midday survives every offset anyone
 * running this will have.
 */
const meal = (
  id: string,
  dishName: string,
  extra: Partial<Meal> = {},
): Meal => ({
  id,
  dish_name: dishName,
  has_photo: false,
  category_id: 4,
  restaurant_id: null,
  area: 'Gulberg',
  rating: 4,
  fun_scale: 3,
  friend_scale: 'solo',
  serving_size: 'medium',
  estimated_calories: 820,
  created_at: '2026-09-15T09:00:00Z',
  category: { id: 4, name: 'Karahi', is_junk: false, base_calorie_min: 600, base_calorie_max: 900 },
  restaurant: null,
  ...extra,
});

const BIRYANI = meal('log-biryani', 'Chicken biryani');
const NIHARI = meal(mockDetailId, 'Nihari', {
  has_photo: true,
  created_at: '2026-09-15T12:00:00Z',
});
/** Five days earlier, so it has to get a heading of its own. */
const HALEEM = meal('log-haleem', 'Haleem', {
  estimated_calories: 540,
  created_at: '2026-09-10T12:00:00Z',
});

/** What the meal screen is opened on. Set per test, before the render. */
let detail: Meal = NIHARI;

beforeEach(() => {
  jest.clearAllMocks();
  detail = NIHARI;
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/health')) return { data: { status: 'ok', ai_provider: 'groq' } };
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
    if (url === '/logs') return { data: { items: [NIHARI, BIRYANI, HALEEM], total: 3 } };
    if (url === '/logs/' + mockDetailId) return { data: detail };
    if (url === '/categories') return { data: [] };
    return { data: null };
  });
  mockedApi.patch.mockResolvedValue({ data: NIHARI });
  mockedApi.delete.mockResolvedValue({ data: undefined });
});

describe('the diary while it is still loading', () => {
  it('shows a skeleton that matches the row layout, not a spinner', async () => {
    mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
    let resolveLogs: (value: { data: unknown }) => void = () => {};
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
      if (url === '/logs') return new Promise((resolve) => (resolveLogs = resolve));
      return { data: null };
    });

    const { UNSAFE_queryAllByType, queryByText } = render(<HistoryScreen />, { wrapper });

    // The old spinner's own label must be gone entirely, not joined by a
    // skeleton alongside it.
    expect(queryByText('Reading your diary')).toBeNull();
    expect(UNSAFE_queryAllByType(Skeleton).length).toBeGreaterThan(0);

    resolveLogs({ data: { items: [], total: 0 } });
  });
});

describe('the diary', () => {
  it('gathers a day into one heading carrying that day’s total', async () => {
    const { getByText } = render(<HistoryScreen />, { wrapper });

    // Two meals on one day is one heading and one total, not two dates
    // repeated on two cards.
    await waitFor(() => expect(getByText(/1,640 kcal/)).toBeTruthy());
    // The older meal is five days back, so it gets its own heading.
    expect(getByText(/540 kcal/)).toBeTruthy();
  });

  it('gives a meal with no photo a monogram rather than a camera in a grey box', async () => {
    const { getByText, queryByText } = render(<HistoryScreen />, { wrapper });

    await waitFor(() => expect(getByText('Chicken biryani')).toBeTruthy());

    // Chicken biryani has no picture, so its initials stand in for one.
    expect(getByText('CB')).toBeTruthy();
    // Nihari has one, so nothing stands in.
    expect(queryByText('NI')).toBeNull();
  });

  it('gives a meal with a photo its own full width card, dish and figure included', async () => {
    const { getByText, getByLabelText } = render(<HistoryScreen />, { wrapper });

    // Nihari has a photo, so it renders through the card path rather than
    // the compact row -- this is the whole point of the photo carrying the
    // dish name and the calorie figure itself rather than sitting beside a
    // thumbnail-sized copy of them.
    await waitFor(() => expect(getByText('Nihari')).toBeTruthy());
    expect(getByLabelText('Nihari, 820 kcal')).toBeTruthy();
  });

  it('still opens a photo meal when its card is tapped, the same as any other row', async () => {
    const { getByText } = render(<HistoryScreen />, { wrapper });

    await waitFor(() => expect(getByText('Nihari')).toBeTruthy());
    fireEvent.press(getByText('Nihari'));

    expect(mockPush).toHaveBeenCalledWith('/logs/log-nihari');
  });

  it('keeps a mixed day working: a photo meal next to a photoless one', async () => {
    // Nihari (photo) and Chicken biryani (no photo) share 2026-09-15, so this
    // is the one day that actually exercises segmentMeals splitting a run of
    // compact rows away from a standalone photo card.
    const { getByText } = render(<HistoryScreen />, { wrapper });

    await waitFor(() => expect(getByText('Nihari')).toBeTruthy());
    expect(getByText('Chicken biryani')).toBeTruthy();
    expect(getByText(/1,640 kcal/)).toBeTruthy();
  });

  /**
   * The diary is paged, and it says when there is no more of it.
   *
   * It used to ask for a flat hundred and render every one. The header counted
   * the real total, so an account with more than that read "312 logged" over a
   * list that stopped at the hundredth, with nothing saying so and no way to
   * reach the rest.
   */
  it('asks for a page rather than a flat hundred', async () => {
    const { getByText } = render(<HistoryScreen />, { wrapper });

    await waitFor(() => expect(getByText('Haleem')).toBeTruthy());

    const call = mockedApi.get.mock.calls.find(([url]: [string]) => url === '/logs');
    expect(call?.[1]?.params).toEqual({ limit: 30, offset: 0 });
  });

  it('says so once the whole diary has been read', async () => {
    const { getByText } = render(<HistoryScreen />, { wrapper });

    // Three of three arrived, so there is no next page and the end is stated
    // rather than left as silence after the last row.
    await waitFor(() => expect(getByText('That is every meal you have logged.')).toBeTruthy());
  });

  it('fetches the next page when there is more than one', async () => {
    const FIRST = Array.from({ length: 30 }, (_, index) =>
      meal(`log-${index}`, `Meal ${index}`),
    );
    mockedApi.get.mockImplementation(async (url: string, config?: { params?: { offset: number } }) => {
      if (url === '/logs') {
        const offset = config?.params?.offset ?? 0;
        return offset === 0
          ? { data: { items: FIRST, total: 31 } }
          : { data: { items: [HALEEM], total: 31 } };
      }
      return { data: null };
    });

    const { getByTestId, getByText, queryByText } = render(<HistoryScreen />, { wrapper });

    await waitFor(() => expect(getByText('Meal 0')).toBeTruthy());
    // Nothing claims the diary is finished while a page is still outstanding.
    expect(queryByText('That is every meal you have logged.')).toBeNull();

    // Driven directly: a list in the test renderer has no height, so it never
    // works out that it has been scrolled to the end on its own.
    fireEvent(getByTestId('diary'), 'endReached');

    await waitFor(() =>
      expect(
        mockedApi.get.mock.calls.some(
          ([url, config]: [string, { params?: { offset: number } }]) =>
            url === '/logs' && config?.params?.offset === 30,
        ),
      ).toBe(true),
    );
  });

  it('still opens the meal when the row is tapped', async () => {
    const { getByText } = render(<HistoryScreen />, { wrapper });

    await waitFor(() => expect(getByText('Haleem')).toBeTruthy());
    fireEvent.press(getByText('Haleem'));

    expect(mockPush).toHaveBeenCalledWith('/logs/log-haleem');
  });

  it('tags a row "Refined" for one refetch when its number changes, and not before', async () => {
    // Mutated in place between renders: mockedApi.get's closure returns this
    // same object every call, so changing its fields is what a real
    // background refinement landing between two fetches looks like.
    // Distinct from NIHARI's and HALEEM's own calorie figures (both 820/540
    // by default), so a text query for one number can only ever match this row.
    BIRYANI.estimated_calories = 823;
    BIRYANI.refined = false;

    const screen = render(<HistoryScreen />, { wrapper });
    const { getByText, queryByText } = screen;

    await waitFor(() => expect(getByText('823')).toBeTruthy());
    expect(queryByText('Refined')).toBeNull();

    BIRYANI.estimated_calories = 751;
    BIRYANI.refined = true;
    // Pulled directly off the FlatList's own refreshControl prop rather than
    // simulated as a gesture: nothing in this suite exercises pull-to-refresh
    // as an actual touch, and RefreshControl's onRefresh is what the screen
    // wires to logs.refetch() regardless of how it gets called.
    const list = screen.UNSAFE_getByType(FlatList);
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });

    await waitFor(() => expect(getByText('751')).toBeTruthy());
    await waitFor(() => expect(getByText('Refined')).toBeTruthy());

    // A log that was already refined before this row ever mounted must never
    // show the tag -- it is marking a change, not restating old news.
    const { queryByText: queryFreshMount } = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(queryFreshMount('751')).toBeTruthy());
    expect(queryFreshMount('Refined')).toBeNull();
  });
});

describe('deleting a meal from the diary', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * The diary lists three meals, so a bare `getAllByText('Delete')[0]` finds
   * whichever row the server happened to list first (NIHARI, not BIRYANI) --
   * not necessarily the one a test means to press. Button gives its
   * accessibilityHint the dish name specifically so a screen reader can
   * tell two "Delete" buttons apart, and that same hint is what disambiguates
   * them here.
   */
  function deleteButtonFor(screen: ReturnType<typeof render>, dishName: string) {
    const button = screen
      .UNSAFE_queryAllByType(Button)
      .find((node) => (node.props.accessibilityHint as string | undefined)?.startsWith(`Removes ${dishName}`));
    if (!button) throw new Error(`no Delete button found for ${dishName}`);
    return button;
  }

  it('removes the row immediately and offers Undo, without calling the server yet', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      fireEvent.press(deleteButtonFor(screen, 'Chicken biryani'));
    });

    expect(screen.queryByText('Chicken biryani')).toBeNull();
    expect(screen.getByText(/Deleted Chicken biryani/)).toBeTruthy();
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  it('actually deletes it from the server once the undo window elapses', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      fireEvent.press(deleteButtonFor(screen, 'Chicken biryani'));
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockedApi.delete).toHaveBeenCalledWith('/logs/log-biryani');
  });

  it('Undo brings the row back and never calls the server at all', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      fireEvent.press(deleteButtonFor(screen, 'Chicken biryani'));
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Undo'));
    });

    expect(screen.getByText('Chicken biryani')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  it('the accessible, non-gesture Delete button reaches the same action the swipe does', async () => {
    // Deleting is answered by a real, always-present Button in MealActions
    // (see the row's own comment on why), not only by a swipe someone using
    // a screen reader has no way to discover or perform. This is that path.
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    const button = deleteButtonFor(screen, 'Chicken biryani');
    // accessibilityRole lives on Button's own internal Pressable, not on
    // this outer composite instance's props, so it's read off the subtree
    // rather than off `button.props` directly.
    expect(button.findByProps({ accessibilityRole: 'button' })).toBeTruthy();

    await act(async () => {
      fireEvent.press(button);
    });
    expect(screen.queryByText('Chicken biryani')).toBeNull();
  });

  it('the swipe action reaches the same onDelete the button does', async () => {
    // Swipeable's revealed action renders regardless of an actual drag
    // having happened -- RNTL cannot simulate the gesture itself -- so this
    // checks that pressing it is wired to the real thing, not that the
    // gesture recognises a swipe.
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete Chicken biryani'));
    });

    expect(screen.queryByText('Chicken biryani')).toBeNull();
    expect(screen.getByText(/Deleted Chicken biryani/)).toBeTruthy();
  });
});

describe('the meal', () => {
  it('shows the AI source reported by health beside the estimate', async () => {
    const { getByText } = render(<MealScreen />, { wrapper });

    await waitFor(() => expect(getByText('Estimate: AI')).toBeTruthy());
  });

  it('leads with the photograph when there is one', async () => {
    const { getByLabelText, queryByRole } = render(<MealScreen />, { wrapper });

    await waitFor(() => expect(getByLabelText('Your photo of Nihari')).toBeTruthy());
    // The picture is the answer here, so the calorie figure is not the hero.
    expect(queryByRole('header')).toBeNull();
  });

  it('leads with the calorie figure when there is no photograph', async () => {
    detail = meal(mockDetailId, 'Nihari');

    const { getByRole, queryByLabelText } = render(<MealScreen />, { wrapper });

    await waitFor(() => expect(getByRole('header')).toBeTruthy());
    expect(getByRole('header')).toHaveTextContent('820');
    expect(queryByLabelText('Your photo of Nihari')).toBeNull();
  });

  it('keeps Save pressable and says what is missing instead of hiding it', async () => {
    const { getByDisplayValue, getByText } = render(<MealScreen />, { wrapper });

    await waitFor(() => expect(getByText('Save changes')).toBeTruthy());
    fireEvent.changeText(getByDisplayValue('Nihari'), '   ');
    fireEvent.press(getByText('Save changes'));

    // Live, and it answers. The old screen disabled itself and said nothing.
    await waitFor(() => expect(getByText(/needs a dish name/)).toBeTruthy());
    expect(mockedApi.patch).not.toHaveBeenCalled();
  });

  it('confirms a delete in a dialog on the page, not on one tap', async () => {
    const { getAllByText, getByText } = render(<MealScreen />, { wrapper });

    await waitFor(() => expect(getByText('Delete this log')).toBeTruthy());
    fireEvent.press(getByText('Delete this log'));

    expect(getByText('Delete this log?')).toBeTruthy();
    expect(mockedApi.delete).not.toHaveBeenCalled();

    // The second one is the dialog's, which is the only one that deletes.
    fireEvent.press(getAllByText('Delete this log')[1]);

    await waitFor(() =>
      expect(mockedApi.delete).toHaveBeenCalledWith('/logs/' + mockDetailId),
    );
  });
});
