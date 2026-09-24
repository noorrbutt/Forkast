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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate, back: jest.fn(), canGoBack: () => true }),
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

/** What a phone camera hands back: far too big for the server, before resizing. */
const CAMERA_SHOT = {
  canceled: false,
  assets: [{ uri: 'file:///DCIM/pizza.jpg', width: 4032, height: 3024 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/cuisines') return { data: CUISINES };
    if (url === '/categories') return { data: CATEGORIES };
    if (url === '/restaurants') return { data: [] };
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

/** Fills in the two things the form refuses to be submitted without. */
async function fillTheMinimum(screen: ReturnType<typeof render>) {
  fireEvent.changeText(screen.getByPlaceholderText('Chicken karahi'), 'Margherita');
  await openCategories(screen);
  fireEvent.press(screen.getByText('Pizza'));
  await waitFor(() => expect(screen.queryByPlaceholderText('Search')).toBeNull());
}

describe('choosing a category', () => {
  it('finds a cuisine by name, not only the category names under it', async () => {
    const screen = render(<LogScreen />, { wrapper });
    await openCategories(screen);

    fireEvent.changeText(screen.getByPlaceholderText('Search'), 'italian');

    await waitFor(() => expect(screen.queryByText('Karahi')).toBeNull());
    expect(screen.getByText('Pizza')).toBeTruthy();
    expect(screen.getByText('Pasta')).toBeTruthy();
    expect(screen.getByText('Risotto')).toBeTruthy();
  });

  it('fills the cuisine in too, because picking one answers both', async () => {
    const screen = render(<LogScreen />, { wrapper });
    await openCategories(screen);

    fireEvent.press(screen.getByText('Pizza'));

    await waitFor(() =>
      expect(screen.getByLabelText('Category').props.accessibilityValue).toEqual({ text: 'Pizza' }),
    );
    expect(screen.getByLabelText('Cuisine').props.accessibilityValue).toEqual({ text: 'Italian' });
  });

  it('says what the calorie estimate will be built from', async () => {
    const screen = render(<LogScreen />, { wrapper });
    await openCategories(screen);

    fireEvent.press(screen.getByText('Pizza'));

    await waitFor(() => expect(screen.getByText(/Usually 400 to 900 kcal/)).toBeTruthy());
  });
});

describe('the saved estimate', () => {
  it('shows the local estimate badge', async () => {
    const screen = render(<LogScreen />, { wrapper });
    await fillTheMinimum(screen);

    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() => expect(screen.getByText('Estimated')).toBeTruthy());
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

    const screen = render(<LogScreen />, { wrapper });

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
    const screen = render(<LogScreen />, { wrapper });

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

    const screen = render(<LogScreen />, { wrapper });

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
    const screen = render(<LogScreen />, { wrapper });

    await fillTheMinimum(screen);
    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() => expect(screen.getByText('820')).toBeTruthy());
    expect(mockedApi.put).not.toHaveBeenCalled();
  });
});
