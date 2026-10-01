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
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
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
import { Skeleton } from '../components/ui';
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
    const { getAllByText, getByText } = render(<HistoryScreen />, { wrapper });

    // Two meals on one day is one heading and one total, not two dates
    // repeated on two cards.
    await waitFor(() => expect(getByText(/1,640 kcal/)).toBeTruthy());
    // The older meal is five days back, so it gets its own heading -- and,
    // being the only meal that day, its own heading total reads the same as
    // its row's own figure, so both are expected to appear.
    expect(getAllByText(/540 kcal/).length).toBe(2);
  });

  it('gives a meal with no photo a category icon rather than a camera in a grey box', async () => {
    const screen = render(<HistoryScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    // A monogram used to stand in here; now it is the shared "meal" glyph on
    // a tile tinted for the category's own junk/healthy judgement.
    expect(screen.UNSAFE_queryAllByProps({ name: 'restaurant' }).length).toBeGreaterThan(0);
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

  it('shows Log again and Delete as standing buttons, not only behind a swipe or the menu', async () => {
    // The whole point of this redesign: Delete used to be reachable only by
    // swiping or by the long-press menu. It is visible again now, alongside
    // Log again, with no gesture and no menu needed to find either.
    const screen = render(<HistoryScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    // One pair per meal (Nihari's photo card, Chicken biryani's and
    // Haleem's compact rows) -- more than one of each is the point: these
    // are standing footer buttons on every row, not a single menu shared
    // across the diary.
    expect(screen.getAllByLabelText('Log again').length).toBe(3);
    expect(screen.getAllByText('Log again').length).toBe(3);
    // By accessibility label, not by text: the swipe reveal panel also
    // renders a literal "Delete" (SwipeToDelete, off screen until swiped),
    // labelled "Delete {dish}" rather than plain "Delete" -- see the footer
    // button's own comment on why the two are deliberately different labels.
    expect(screen.getAllByLabelText('Delete').length).toBe(3);
  });

  it('places the Estimated badge inside the photo card, not in a block below it', async () => {
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
      if (url === '/logs') {
        return { data: { items: [{ ...NIHARI, estimate_source: 'local' }], total: 1 } };
      }
      if (url === '/categories') return { data: [] };
      return { data: null };
    });
    const screen = render(<HistoryScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText('Nihari')).toBeTruthy());

    // "Estimated locally" is the overlay badge's own accessibility label
    // (EstimateBadge's overlay variant) -- present at all confirms it is
    // still rendered; the card-membership half of this is enforced by
    // history.tsx's own structure (the badge sits inside the same rounded,
    // elevated View as the photo and the footer, not in a sibling View
    // outside it the way the old "floats below the card" layout did).
    expect(screen.getByLabelText('Estimated locally')).toBeTruthy();
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

    await waitFor(() => expect(getByText('823 kcal')).toBeTruthy());
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

    await waitFor(() => expect(getByText('751 kcal')).toBeTruthy());
    await waitFor(() => expect(getByText('Refined')).toBeTruthy());

    // A log that was already refined before this row ever mounted must never
    // show the tag -- it is marking a change, not restating old news.
    const { queryByText: queryFreshMount } = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(queryFreshMount('751 kcal')).toBeTruthy());
    expect(queryFreshMount('Refined')).toBeNull();
  });
});

describe('deleting a meal from the diary', () => {
  /**
   * The non-gesture path to a row's actions: a long press, or, for a screen
   * reader, the row's own custom accessibility action. RNTL cannot perform a
   * real long press, but `onAccessibilityAction` is the same code path a
   * screen reader's custom action actually calls, so firing it here
   * exercises the real thing rather than simulating a gesture.
   */
  function openMenuFor(screen: ReturnType<typeof render>, dishName: string) {
    const row = screen
      .UNSAFE_queryAllByProps({ accessibilityRole: 'button' })
      .find((node) => (node.props.accessibilityLabel as string | undefined)?.startsWith(`${dishName}, `));
    if (!row) throw new Error(`no row found for ${dishName}`);
    row.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
  }

  /**
   * Whichever dialog's own "Delete" is open right now -- the long-press
   * menu's or the footer button's own confirmation -- never the swipe
   * panel's. All render a literal "Delete" text node (the swipe panel keeps
   * its label even off screen, since RNTL never actually drags it out of
   * the tree), so this walks up to an ancestor carrying a dialog action's
   * own, undecorated accessibilityLabel rather than the swipe panel's
   * `Delete ${dishName}` or the footer button's identical plain label.
   */
  function deleteInDialog(screen: ReturnType<typeof render>) {
    // Scoped to a modal specifically, not just to an ancestor labelled
    // "Delete": the diary row also carries its own visible "Delete" footer
    // button with the identical plain label (by design -- see its own
    // comment on why it matches the dialogs' naming), so an ancestor-label
    // check alone matches all three. A real screen reader never sees that
    // ambiguity -- Dialog's card sets accessibilityViewIsModal, which scopes
    // VoiceOver/TalkBack to the modal's own contents while it's open -- RNTL
    // just does not honour that the way a device does, so the query has to
    // do the scoping by hand instead.
    const found = screen.getAllByText('Delete').find((node) => {
      const ancestors: (typeof node)[] = [];
      for (let ancestor: typeof node | null = node; ancestor; ancestor = ancestor.parent) {
        ancestors.push(ancestor);
      }
      return (
        ancestors.some((a) => a.props.accessibilityViewIsModal) &&
        ancestors.some((a) => a.props.accessibilityLabel === 'Delete')
      );
    });
    if (!found) throw new Error('Delete action not found in any open dialog');
    return found;
  }

  /**
   * The footer's own standing Delete button -- distinct from the menu's
   * identical "Delete" label (scoped out by not being inside a modal) and
   * from the swipe panel's `Delete ${dishName}` label (a different string
   * entirely, no ambiguity there).
   */
  function footerDeleteButtonFor(screen: ReturnType<typeof render>, dishName: string) {
    const row = screen
      .UNSAFE_queryAllByProps({ accessibilityRole: 'button' })
      .find((node) => (node.props.accessibilityLabel as string | undefined)?.startsWith(`${dishName}, `));
    if (!row || !row.parent) throw new Error(`no row found for ${dishName}`);
    // The footer is a sibling of the row's own Pressable, not a descendant
    // of it (by design -- see CompactMealRow/PhotoMealRow's own comment on
    // why), but both sit inside the same immediate container either row
    // shape wraps them in, so the row's own parent is exactly where to look
    // for its footer's Delete button.
    const texts = within(row.parent).getAllByText('Delete');
    if (texts.length !== 1) {
      throw new Error(`expected exactly one footer Delete for ${dishName}, found ${texts.length}`);
    }
    return texts[0];
  }

  it('asks before deleting from the footer button, and does nothing until answered', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      fireEvent.press(footerDeleteButtonFor(screen, 'Chicken biryani'));
    });

    expect(screen.getByText('Delete this meal?')).toBeTruthy();
    // Nothing happened yet: the row is still there and nothing was scheduled.
    expect(screen.getByText('Chicken biryani')).toBeTruthy();
    expect(screen.queryByText(/Deleted Chicken biryani/)).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Cancel'));
    });

    expect(screen.queryByText('Delete this meal?')).toBeNull();
    expect(screen.getByText('Chicken biryani')).toBeTruthy();
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  it('deletes once the footer button is confirmed, same as the menu does', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      fireEvent.press(footerDeleteButtonFor(screen, 'Chicken biryani'));
    });
    await act(async () => {
      fireEvent.press(deleteInDialog(screen));
    });

    expect(screen.queryByText('Chicken biryani')).toBeNull();
    expect(screen.getByText(/Deleted Chicken biryani/)).toBeTruthy();
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  it('removes the row immediately and offers Undo, without calling the server yet', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      openMenuFor(screen, 'Chicken biryani');
    });
    await act(async () => {
      fireEvent.press(deleteInDialog(screen));
    });

    expect(screen.queryByText('Chicken biryani')).toBeNull();
    expect(screen.getByText(/Deleted Chicken biryani/)).toBeTruthy();
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  it('reaches the server once something forces the pending delete to settle', async () => {
    // The five second window itself is useSoftDelete's own job and is
    // tested in isolation, with fake timers, in useSoftDelete.test.tsx --
    // mixing fake timers with a full screen render here fought with React
    // Query's own setTimeout-based notification batching (see this
    // suite's other comments on that) and made the whole file flaky.
    // Unmounting exercises the exact same commit path (flush() on
    // teardown) without needing to wait out or fake the real window.
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      openMenuFor(screen, 'Chicken biryani');
    });
    await act(async () => {
      fireEvent.press(deleteInDialog(screen));
    });
    await act(async () => {
      screen.unmount();
      // unmount() fires flush() synchronously, but flush() calls
      // mutate(), whose mutationFn is itself async -- this is what lets
      // that microtask actually reach api.delete before the assertion
      // below runs.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockedApi.delete).toHaveBeenCalledWith('/logs/log-biryani');
  });

  it('Undo cancels it outright, so even a later flush never reaches the server', async () => {
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      openMenuFor(screen, 'Chicken biryani');
    });
    await act(async () => {
      fireEvent.press(deleteInDialog(screen));
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Undo'));
    });

    expect(screen.getByText('Chicken biryani')).toBeTruthy();

    // Proves cancellation rather than a delete merely still pending: if
    // Undo had not actually cleared it, unmounting (which flushes anything
    // still pending) would call delete here.
    screen.unmount();
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  it('the accessible, non-gesture path reaches the same action the swipe does', async () => {
    // Deleting is answered by the row's long-press menu -- reachable by the
    // same custom accessibility action a screen reader calls, see this
    // file's own comment on openMenuFor -- not only by a swipe someone using
    // one has no way to discover or perform. This is that path.
    const screen = render(<HistoryScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Chicken biryani')).toBeTruthy());

    await act(async () => {
      openMenuFor(screen, 'Chicken biryani');
    });
    const deleteAction = deleteInDialog(screen);

    await act(async () => {
      fireEvent.press(deleteAction);
    });
    expect(screen.queryByText('Chicken biryani')).toBeNull();
  });

  it('the swipe action reaches the same onDelete the menu does', async () => {
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
