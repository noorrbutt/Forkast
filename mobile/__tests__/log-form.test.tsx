/**
 * Logging a meal: the picker, and the photo that has nowhere to go yet.
 *
 * Two things on this screen are easy to get wrong and impossible to see in a
 * screenshot. The first is the category picker: there are thirty eight
 * categories and ten cuisines, and someone logging dinner knows the cuisine
 * long before they know which bucket we filed it under, so the cuisine has to
 * be searchable and choosing a category has to answer it.
 *
 * The second is the photo. The photo API is addressed by log id and there is no
 * id until the log has been created, so the file is held on the device and sent
 * afterwards. That ordering is the feature, and a refused upload must leave the
 * meal saved rather than taking it down with it.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockNavigate = jest.fn();
const mockPush = jest.fn();
// What Home's ghost tile passes along; reset per test.
let mockParams: { slot?: string } = {};

jest.mock('expo-router', () => ({
  // A no-op is enough for every test here: nothing exercises what happens
  // when a screen loses focus, only that rendering a screen using the real
  // hook does not throw.
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: mockPush, navigate: mockNavigate, back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
    getAccessToken: () => 'test-token',
  };
});

import LogScreen from '../app/(tabs)/log';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';
import { ThemeProvider } from '../theme';

const mockedApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};
const mockedHydrate = hydrateTokens as jest.Mock;
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

/** An iPhone 14, so the safe area the screen lays out against is a real one. */
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

const CUISINES = [
  { id: 1, slug: 'desi', name: 'Desi', emoji: '🍛', sort_order: 1 },
  { id: 2, slug: 'italian', name: 'Italian', emoji: '🍝', sort_order: 2 },
  { id: 3, slug: 'japanese', name: 'Japanese', emoji: '🍣', sort_order: 3 },
];

const category = (id: number, cuisineId: number, name: string) => ({
  id,
  cuisine_id: cuisineId,
  slug: name.toLowerCase(),
  name,
  base_calorie_min: 400,
  base_calorie_max: 900,
  is_junk: false,
});

/** Nine of them, which is past the point where a picker has to be searchable. */
const CATEGORIES = [
  category(11, 1, 'Karahi'),
  category(12, 1, 'Biryani'),
  category(13, 1, 'Nihari'),
  category(21, 2, 'Pizza'),
  category(22, 2, 'Pasta'),
  category(23, 2, 'Risotto'),
  category(31, 3, 'Ramen'),
  category(32, 3, 'Sushi'),
  category(33, 3, 'Katsu'),
];

const DISH_HINTS = [
  { name: 'beef nihari', unit: 'plate', typical_qty: 1, kcal_min: 650, kcal_max: 950, category_id: 13 },
];

const SAVED = {
  id: 'log-new',
  has_photo: false,
  dish_name: 'Margherita',
  category_id: 21,
  restaurant_id: null,
  area: null,
  rating: 4,
  fun_scale: null,
  friend_scale: null,
  serving_size: 'medium',
  estimated_calories: 820,
  estimate_source: 'local',
  created_at: '2026-09-17T19:00:00Z',
  category: CATEGORIES[3],
  restaurant: null,
};

const recentMeal = (id: string, dishName: string, createdAt: string, calories = 600) => ({
  id,
  has_photo: false,
  dish_name: dishName,
  category_id: 11,
  restaurant_id: null,
  area: null,
  rating: 4,
  fun_scale: null,
  friend_scale: null,
  serving_size: 'medium',
  estimated_calories: calories,
  estimate_source: 'local',
  created_at: createdAt,
  category: CATEGORIES[0],
  restaurant: null,
});

/** Newest first, the same order GET /logs already answers in. "Karahi" and
 * "karahi" name the same dish with different casing, to exercise the
 * dedupe; "fries" is the fourth distinct dish once that dedupe runs, which
 * is what pushes "biryani" -- the fifth -- past the four-row cap. */
const RECENT_LOGS = [
  recentMeal('log-6', 'chicken tikka', '2026-09-20T19:00:00Z', 500),
  recentMeal('log-5', 'daal chawal', '2026-09-20T13:00:00Z', 450),
  recentMeal('log-4', 'Karahi', '2026-09-19T19:00:00Z', 820),
  recentMeal('log-3', 'karahi', '2026-09-19T13:00:00Z', 800),
  recentMeal('log-2', 'fries', '2026-09-18T19:00:00Z', 350),
  recentMeal('log-1', 'biryani', '2026-09-18T13:00:00Z', 700),
];

const REPEATED = { ...RECENT_LOGS[0], id: 'log-fresh', created_at: '2026-09-21T13:00:00Z' };

/** What a phone camera hands back: far too big for the server, before resizing. */
const CAMERA_SHOT = {
  canceled: false,
  assets: [{ uri: 'file:///DCIM/pizza.jpg', width: 4032, height: 3024 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/health')) return { data: { status: 'ok', ai_provider: 'fake' } };
    if (url === '/cuisines') return { data: CUISINES };
    if (url === '/categories') return { data: CATEGORIES };
    if (url === '/restaurants') return { data: [] };
    if (url === '/dishes') return { data: DISH_HINTS };
    // The real backend never answers with a bare null -- /search always
    // resolves to this shape, empty or not -- and typing into the merged
    // dish field (ManualLogForm) drives this query directly now, unlike
    // before the two fields were merged. A test double that fell through
    // to `{ data: null }` here used to go unnoticed because nothing read
    // it; it is read on every render of that field now.
    if (url === '/search') return { data: { cuisines: [], categories: [], dishes: [] } };
    return { data: null };
  });
  mockedApi.post.mockResolvedValue({ data: SAVED });
  mockedApi.put.mockResolvedValue({ data: { ...SAVED, has_photo: true } });
  picker.launchCameraAsync.mockResolvedValue(CAMERA_SHOT as never);
});

/**
 * Opens the category picker and waits for the list to be on screen.
 *
 * The field says how many categories it holds, which is also the signal that
 * the catalogue has arrived: until it does the field is inert and a press on it
 * opens nothing.
 */
async function openCategories(screen: ReturnType<typeof render>) {
  await waitFor(() =>
    expect(screen.getByText(`Search ${CATEGORIES.length} categories`)).toBeTruthy(),
  );
  fireEvent.press(screen.getByLabelText('Category'));
  await waitFor(() => expect(screen.getByText('Pizza')).toBeTruthy());
}

/**
 * The camera is the first thing the log screen shows now. Every test below
 * exercises the manual/text form specifically, so this reaches it the way a
 * real person would: past the capture screen, by tapping the escape hatch.
 */
function renderManualForm(): ReturnType<typeof render> {
  const initial = render(<LogScreen />, { wrapper });
  fireEvent.press(initial.getByText('Type it in instead'));
  return initial;
}

/** Fills in the two things the form refuses to be submitted without. */
async function fillTheMinimum(screen: ReturnType<typeof render>) {
  fireEvent.changeText(screen.getByPlaceholderText('Chicken karahi'), 'Margherita');
  await openCategories(screen);
  fireEvent.press(screen.getByText('Pizza'));
  await waitFor(() => expect(screen.queryByPlaceholderText('Search')).toBeNull());
}

describe('arriving from a ghost tile on Home', () => {
  afterEach(() => {
    mockParams = {};
  });

  it('names the slot it was sent for', () => {
    mockParams = { slot: 'lunch' };
    const screen = render(<LogScreen />, { wrapper });
    expect(screen.getByText('What did you have for lunch?')).toBeTruthy();
  });

  it('asks the plain question without one, or with one it does not know', () => {
    mockParams = { slot: '' };
    const plain = render(<LogScreen />, { wrapper });
    expect(plain.getByText('What did you eat?')).toBeTruthy();
    plain.unmount();

    mockParams = { slot: 'brunch' };
    const unknown = render(<LogScreen />, { wrapper });
    expect(unknown.getByText('What did you eat?')).toBeTruthy();
  });
});

describe('the one dish field', () => {
  it('has a single dish field, not a separate lookup and name', () => {
    const screen = renderManualForm();

    expect(screen.getByText('Dish name')).toBeTruthy();
    expect(screen.queryByText('Find a dish others have logged (optional)')).toBeNull();
    expect(screen.queryByText('Search')).toBeNull();
  });

  it('searches the catalog off the one field, not a second one', async () => {
    const screen = renderManualForm();

    fireEvent.changeText(screen.getByPlaceholderText('Chicken karahi'), 'pizza');

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith('/search', expect.anything()));
  });
});

describe('choosing a category', () => {
  it('finds a cuisine by name, not only the category names under it', async () => {
    const screen = renderManualForm();
    await openCategories(screen);

    fireEvent.changeText(screen.getByPlaceholderText('Search'), 'italian');

    await waitFor(() => expect(screen.queryByText('Karahi')).toBeNull());
    expect(screen.getByText('Pizza')).toBeTruthy();
    expect(screen.getByText('Pasta')).toBeTruthy();
    expect(screen.getByText('Risotto')).toBeTruthy();
  });

  it('fills the cuisine in too, because picking one answers both', async () => {
    const screen = renderManualForm();
    await openCategories(screen);

    fireEvent.press(screen.getByText('Pizza'));

    await waitFor(() =>
      expect(screen.getByLabelText('Category').props.accessibilityValue).toEqual({ text: 'Pizza' }),
    );
    expect(screen.getByLabelText('Cuisine').props.accessibilityValue).toEqual({ text: 'Italian' });
  });

  it('says what the calorie estimate will be built from', async () => {
    const screen = renderManualForm();
    await openCategories(screen);

    fireEvent.press(screen.getByText('Pizza'));

    await waitFor(() => expect(screen.getByText(/Usually 400 to 900 kcal/)).toBeTruthy());
  });
});

describe('the saved estimate', () => {
  it('shows the estimator reported by health beside the saved estimate', async () => {
    const screen = renderManualForm();
    await fillTheMinimum(screen);

    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() => expect(screen.getByText('Estimate: local')).toBeTruthy());
    expect(mockedApi.get.mock.calls.filter(([url]) => url.endsWith('/health'))).toHaveLength(1);
  });

  it('reacts to the category actually logged, not a generic success line', async () => {
    const screen = renderManualForm();
    await fillTheMinimum(screen);

    fireEvent.press(screen.getByText('Log it'));

    // SAVED carries the Pizza category, which is neither junk nor one of the
    // light categories in this fixture, so it gets the plain acknowledgement.
    await waitFor(() => expect(screen.getByText('Nice, pizza is on the board.')).toBeTruthy());
  });
});

describe('desi dish hint chips and the portion stepper', () => {
  it('offers a chip from the desi dish table', async () => {
    const screen = renderManualForm();

    await waitFor(() => expect(screen.getByText('beef nihari')).toBeTruthy());
    expect(screen.getByText('Common desi dishes')).toBeTruthy();
  });

  it('picking a chip fills the dish name, category, and starts the stepper', async () => {
    const screen = renderManualForm();
    await waitFor(() => expect(screen.getByText('beef nihari')).toBeTruthy());

    fireEvent.press(screen.getByText('beef nihari'));

    await waitFor(() =>
      expect(screen.getByLabelText('Category').props.accessibilityValue).toEqual({
        text: 'Nihari',
      }),
    );
    expect(screen.getByDisplayValue('beef nihari')).toBeTruthy();
    expect(screen.getByText('1 plate')).toBeTruthy();
  });

  it('stepping the portion up changes the serving size sent on save', async () => {
    const screen = renderManualForm();
    await waitFor(() => expect(screen.getByText('beef nihari')).toBeTruthy());
    fireEvent.press(screen.getByText('beef nihari'));
    await waitFor(() => expect(screen.getByText('1 plate')).toBeTruthy());

    fireEvent.press(screen.getByText('+'));
    await waitFor(() => expect(screen.getByText('2 plates')).toBeTruthy());

    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ dish_name: 'beef nihari', serving_size: 'large' }),
      ),
    );
  });

  it('editing the dish name away from the chip drops the stepper', async () => {
    const screen = renderManualForm();
    await waitFor(() => expect(screen.getByText('beef nihari')).toBeTruthy());
    fireEvent.press(screen.getByText('beef nihari'));
    await waitFor(() => expect(screen.getByText('1 plate')).toBeTruthy());

    fireEvent.changeText(screen.getByDisplayValue('beef nihari'), 'beef nihari with extra naan');

    expect(screen.queryByText('1 plate')).toBeNull();
  });
});

describe('a photo picked before there is a meal to put it on', () => {
  it('waits for the log id and then uploads against it', async () => {
    let releaseLog: ((value: { data: typeof SAVED }) => void) | undefined;
    mockedApi.post.mockImplementation(
      () =>
        new Promise<{ data: typeof SAVED }>((resolve) => {
          releaseLog = resolve;
        }),
    );

    const screen = renderManualForm();

    fireEvent.press(screen.getByText('Take a photo'));
    await waitFor(() => expect(screen.getByText('Retake')).toBeTruthy());
    // Nothing has been sent yet: there is no meal to send it to.
    expect(mockedApi.put).not.toHaveBeenCalled();

    await fillTheMinimum(screen);
    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ dish_name: 'Margherita', category_id: 21 }),
      ),
    );
    expect(mockedApi.put).not.toHaveBeenCalled();

    await act(async () => {
      releaseLog?.({ data: SAVED });
    });

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalled());
    const [url, form] = mockedApi.put.mock.calls[0];
    // The id the server just handed back, which is the only one that exists.
    expect(url).toBe('/logs/log-new/photo');
    expect(form).toBeInstanceOf(FormData);
  });

  it('sends the shrunk copy, not the four thousand pixel original', async () => {
    const screen = renderManualForm();

    fireEvent.press(screen.getByText('Take a photo'));
    await waitFor(() => expect(screen.getByText('Retake')).toBeTruthy());
    await fillTheMinimum(screen);
    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalled());
    const manipulator = jest.requireMock('expo-image-manipulator');
    expect(manipulator.manipulateAsync).toHaveBeenCalledWith(
      'file:///DCIM/pizza.jpg',
      [{ resize: { width: 1280 } }],
      expect.objectContaining({ compress: 0.7 }),
    );
  });

  it('keeps the meal when the upload is refused, and says the photo missed', async () => {
    mockedApi.put.mockRejectedValue(new Error('Request failed with status 413'));

    const screen = renderManualForm();

    fireEvent.press(screen.getByText('Take a photo'));
    await waitFor(() => expect(screen.getByText('Retake')).toBeTruthy());
    await fillTheMinimum(screen);
    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() => expect(screen.getByText(/did not attach/)).toBeTruthy());
    // The meal itself landed: the estimate is on screen and the form has moved
    // on to what to do next.
    expect(screen.getByText('820')).toBeTruthy();
    expect(screen.getByText('Log another')).toBeTruthy();
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
  });

  it('submits without a photo, which is the ordinary case', async () => {
    const screen = renderManualForm();

    await fillTheMinimum(screen);
    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() => expect(screen.getByText('820')).toBeTruthy());
    expect(mockedApi.put).not.toHaveBeenCalled();
  });
});

describe('Recent, on the capture screen', () => {
  it('is hidden when there is no history', async () => {
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return { data: { status: 'ok', ai_provider: 'fake' } };
      if (url === '/logs') return { data: { items: [], total: 0 } };
      return { data: null };
    });

    const screen = render(<LogScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText('What did you eat?')).toBeTruthy());
    expect(screen.queryByText('Recent')).toBeNull();
  });

  it('shows up to four dishes, newest first, deduped case-insensitively', async () => {
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return { data: { status: 'ok', ai_provider: 'fake' } };
      if (url === '/logs') return { data: { items: RECENT_LOGS, total: RECENT_LOGS.length } };
      return { data: null };
    });

    const screen = render(<LogScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText('Recent')).toBeTruthy());
    // "Karahi" and "karahi" are the same dish said twice; the newer of the
    // two (log-4, 820 kcal) is the one that should survive the dedupe.
    expect(screen.getByText('820 kcal')).toBeTruthy();
    expect(screen.queryByText('800 kcal')).toBeNull();
    expect(screen.getByText('fries')).toBeTruthy();
    // Five distinct dishes survive the dedupe, capped at four: "biryani"
    // (log-1, the oldest) is the one that should have been dropped.
    expect(screen.queryByText('biryani')).toBeNull();
  });

  it('repeats a tapped dish with no confirmation, through the same endpoint Log again uses', async () => {
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return { data: { status: 'ok', ai_provider: 'fake' } };
      if (url === '/logs') return { data: { items: RECENT_LOGS, total: RECENT_LOGS.length } };
      return { data: null };
    });
    mockedApi.post.mockResolvedValue({ data: REPEATED });

    const screen = render(<LogScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('chicken tikka')).toBeTruthy());

    fireEvent.press(screen.getByText('chicken tikka'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/logs/log-6/repeat'),
    );
    // Lands on the ordinary saved state, the same one a typed or photo save
    // reaches, with Undo offered on top of it.
    await waitFor(() => expect(screen.getByText('500')).toBeTruthy());
    expect(screen.getByText('Undo')).toBeTruthy();
  });

  it('Undo deletes the meal the tap just created', async () => {
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) return { data: { status: 'ok', ai_provider: 'fake' } };
      if (url === '/logs') return { data: { items: RECENT_LOGS, total: RECENT_LOGS.length } };
      return { data: null };
    });
    mockedApi.post.mockResolvedValue({ data: REPEATED });

    const screen = render(<LogScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('chicken tikka')).toBeTruthy());
    fireEvent.press(screen.getByText('chicken tikka'));
    await waitFor(() => expect(screen.getByText('Undo')).toBeTruthy());

    fireEvent.press(screen.getByText('Undo'));

    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith('/logs/log-fresh'));
  });
});
