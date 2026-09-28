/**
 * The log screen now opens on the camera, not the form.
 *
 * Three screens worth pinning down: capture (the camera is the one thing),
 * confirm (what a photo alone can answer, plus the fastest way to resolve a
 * category), and the escape hatch back to the manual form at every point,
 * including the one a rate limit forces automatically.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn(), canGoBack: () => true }),
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
};
const mockedHydrate = hydrateTokens as jest.Mock;
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

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
  { id: 2, slug: 'italian', name: 'Italian', emoji: '🍝', sort_order: 2 },
  { id: 5, slug: 'continental', name: 'Continental', emoji: '🍽️', sort_order: 5 },
];
const PIZZA = {
  id: 21,
  cuisine_id: 2,
  slug: 'pizza',
  name: 'Pizza',
  base_calorie_min: 400,
  base_calorie_max: 900,
  is_junk: false,
};
// A category the search-against-the-guess fixture never matches, standing in
// for a dish the catalogue has no obvious category for at all -- a banana is
// the real example, this is its equivalent for the test.
const FRUIT = {
  id: 40,
  cuisine_id: 5,
  slug: 'fruit',
  name: 'Fruit',
  base_calorie_min: 70,
  base_calorie_max: 140,
  is_junk: false,
};
const CATEGORIES = [PIZZA, FRUIT];

const ESTIMATE = {
  dish_guess: 'pepperoni pizza',
  calories: 780,
  macros: { protein_g: 32, carbs_g: 88, fat_g: 30 },
  confidence: 'high',
  portion_ambiguous: false,
  portion_options: [],
  reasoning: 'full slice, visible cheese',
};

// Confidence about the dish and ambiguity about its portion are independent,
// so this is deliberately "high" on the dish and still ambiguous on scale.
const AMBIGUOUS_ESTIMATE = {
  dish_guess: 'pepperoni pizza',
  calories: 550,
  macros: { protein_g: 22, carbs_g: 62, fat_g: 21 },
  confidence: 'high',
  portion_ambiguous: true,
  portion_options: [
    { label: 'small', calories: 350 },
    { label: 'medium', calories: 550 },
    { label: 'large', calories: 750 },
  ],
  reasoning: 'no plate edge or hand in frame to judge scale',
};

const SAVED = {
  id: 'log-new',
  has_photo: false,
  dish_name: 'pepperoni pizza',
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
  category: PIZZA,
  restaurant: null,
};

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
    if (url === '/search') {
      return { data: { cuisines: [], categories: [PIZZA], dishes: [{ dish_name: 'pepperoni pizza', category_id: 21 }] } };
    }
    return { data: null };
  });
  mockedApi.post.mockImplementation(async (url: string) => {
    if (url === '/logs/estimate-photo') return { data: ESTIMATE };
    if (url === '/logs') return { data: SAVED };
    return { data: null };
  });
  mockedApi.put.mockResolvedValue({ data: { ...SAVED, has_photo: true } });
  picker.launchCameraAsync.mockResolvedValue(CAMERA_SHOT as never);
});

function openLogScreen() {
  return render(<LogScreen />, { wrapper });
}

async function takeAPhoto(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getByText('Take a photo'));
  await waitFor(() => expect(screen.getByText('Is this right?')).toBeTruthy());
}

describe('the capture screen', () => {
  it('is the first thing the log screen shows', () => {
    const screen = openLogScreen();

    expect(screen.getByText('Take a photo')).toBeTruthy();
    expect(screen.getByText('Choose from library')).toBeTruthy();
    expect(screen.getByText('Type it in instead')).toBeTruthy();
    // The manual form is not mounted yet at all.
    expect(screen.queryByPlaceholderText('Chicken karahi')).toBeNull();
  });

  it('opens the manual form when typing is chosen instead', () => {
    const screen = openLogScreen();

    fireEvent.press(screen.getByText('Type it in instead'));

    expect(screen.getByPlaceholderText('Chicken karahi')).toBeTruthy();
  });

  it('does nothing when the picker is cancelled', async () => {
    picker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: null } as never);
    const screen = openLogScreen();

    fireEvent.press(screen.getByText('Take a photo'));

    await waitFor(() => expect(mockedApi.post).not.toHaveBeenCalled());
    expect(screen.getByText('Take a photo')).toBeTruthy();
  });
});

describe('the confirm screen', () => {
  it('shows the photo estimate with the dish name prefilled', async () => {
    const screen = openLogScreen();

    await takeAPhoto(screen);

    expect(screen.getByDisplayValue('pepperoni pizza')).toBeTruthy();
    expect(screen.getByText('About 780 kcal')).toBeTruthy();
    expect(screen.getByText(/32g protein/)).toBeTruthy();
  });

  it('resolves a category from a quick-tap match and saves through it', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);

    // The search against the guess is debounced, so the match chips arrive a
    // beat after the confirm screen itself does.
    await waitFor(() => expect(screen.getByText('Matches this dish')).toBeTruthy());
    fireEvent.press(screen.getByText('pepperoni pizza'));
    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ dish_name: 'pepperoni pizza', category_id: 21 }),
      ),
    );
  });

  it('resolves a category from the category chip too', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);

    await waitFor(() => expect(screen.getByText('Or the category')).toBeTruthy());
    fireEvent.press(screen.getByText('Pizza'));
    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ category_id: 21 }),
      ),
    );
  });

  it('refuses to save with no category resolved, the same as the manual form', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);

    fireEvent.press(screen.getByText('Log it'));

    expect(screen.getByText(/Still needs a category/)).toBeTruthy();
    expect(mockedApi.post).not.toHaveBeenCalledWith('/logs', expect.anything());
  });

  it('drops to the manual form, dish name carried over, when told the guess is wrong', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);

    fireEvent.press(screen.getByText('Not right? Edit manually'));

    expect(screen.getByPlaceholderText('Chicken karahi').props.value).toBe('pepperoni pizza');
  });

  it('does not ask about portion when the estimate is not ambiguous', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);

    expect(screen.queryByText('Which portion is closest?')).toBeNull();
  });
});

describe('an ambiguous portion', () => {
  beforeEach(() => {
    mockedApi.post.mockImplementation(async (url: string) => {
      if (url === '/logs/estimate-photo') return { data: AMBIGUOUS_ESTIMATE };
      if (url === '/logs') return { data: SAVED };
      return { data: null };
    });
  });

  it('shows portion chips instead of a single trusted number', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);

    expect(screen.getByText('Which portion is closest?')).toBeTruthy();
    expect(screen.getByText('small (~350 kcal)')).toBeTruthy();
    expect(screen.getByText('medium (~550 kcal)')).toBeTruthy();
    expect(screen.getByText('large (~750 kcal)')).toBeTruthy();
    // The model's own single guess, shown until a chip is tapped.
    expect(screen.getByText('About 550 kcal')).toBeTruthy();
  });

  it('is one tap: picking a portion updates the preview and nothing else', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);

    fireEvent.press(screen.getByText('large (~750 kcal)'));

    expect(screen.getByText('About 750 kcal')).toBeTruthy();
    // Macros move with it, scaled by the same ratio, so the two numbers on
    // screen never describe two different portions.
    expect(screen.getByText(/30g protein/)).toBeTruthy();
  });

  it('saving does not require a portion to have been picked', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);
    await waitFor(() => expect(screen.getByText('Matches this dish')).toBeTruthy());
    fireEvent.press(screen.getByText('pepperoni pizza'));

    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ category_id: 21 }),
      ),
    );
  });
});

describe('a rate-limited estimate', () => {
  it('shows a friendly message and falls back to the manual form', async () => {
    const error = Object.assign(new Error('Too many attempts'), {
      isAxiosError: true,
      response: { status: 429, data: { detail: 'Too many attempts. Try again shortly.' } },
    });
    mockedApi.post.mockImplementation(async (url: string) => {
      if (url === '/logs/estimate-photo') throw error;
      return { data: SAVED };
    });

    const screen = openLogScreen();
    fireEvent.press(screen.getByText('Take a photo'));

    await waitFor(() =>
      expect(screen.getByText(/hit the photo-scan limit/)).toBeTruthy(),
    );
    // Landed on the manual form, not stuck on a capture screen whose one
    // button just told them no.
    expect(screen.getByPlaceholderText('Chicken karahi')).toBeTruthy();
  });
});

describe('a failed estimate that is not a rate limit', () => {
  it('stays on the capture screen and says what went wrong', async () => {
    const error = Object.assign(new Error('bad gateway'), {
      isAxiosError: true,
      response: { status: 502, data: { detail: 'The photo estimator is unavailable.' } },
    });
    mockedApi.post.mockImplementation(async (url: string) => {
      if (url === '/logs/estimate-photo') throw error;
      return { data: SAVED };
    });

    const screen = openLogScreen();
    fireEvent.press(screen.getByText('Take a photo'));

    await waitFor(() =>
      expect(screen.getByText('The photo estimator is unavailable.')).toBeTruthy(),
    );
    expect(screen.getByText('Take a photo')).toBeTruthy();
  });
});

describe('a dish the catalogue has no chip match for', () => {
  it('can still be filed under a category, picked directly', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);

    // The search-against-the-guess fixture only ever matches Pizza, so Fruit
    // never shows up as a quick-tap chip -- the whole point of this path.
    fireEvent.press(screen.getByLabelText('Category'));
    await waitFor(() => expect(screen.getByText('Fruit')).toBeTruthy());
    fireEvent.press(screen.getByText('Fruit'));
    fireEvent.press(screen.getByText('Log it'));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ category_id: 40 }),
      ),
    );
  });
});

describe('removing the photo on the confirm screen', () => {
  it('drops the photo but keeps whatever category was already resolved', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);
    await waitFor(() => expect(screen.getByText('Matches this dish')).toBeTruthy());
    fireEvent.press(screen.getByText('pepperoni pizza'));

    fireEvent.press(screen.getByText('Remove'));

    // The photo and its Retake/Choose/Remove row are gone...
    expect(screen.queryByText('Retake')).toBeNull();
    // ...but the category picked before removing it is still good enough to save.
    fireEvent.press(screen.getByText('Log it'));
    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/logs',
        expect.objectContaining({ category_id: 21 }),
      ),
    );
  });

  it('asks for a fresh photo and a fresh estimate on retake', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);
    expect(picker.launchCameraAsync).toHaveBeenCalledTimes(1);
    expect(mockedApi.post).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Retake'));

    await waitFor(() => expect(picker.launchCameraAsync).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mockedApi.post.mock.calls.filter(([url]) => url === '/logs/estimate-photo')).toHaveLength(2),
    );
  });
});

describe('cancelling mid-log', () => {
  it('goes back to the capture screen from confirm, and forgets the photo', async () => {
    const screen = openLogScreen();
    await takeAPhoto(screen);

    fireEvent.press(screen.getByLabelText('Go back'));

    expect(screen.getByText('What did you eat?')).toBeTruthy();
    expect(screen.queryByText('Is this right?')).toBeNull();
  });

  it('goes back to the capture screen from the manual form too', () => {
    const screen = openLogScreen();
    fireEvent.press(screen.getByText('Type it in instead'));
    fireEvent.changeText(screen.getByPlaceholderText('Chicken karahi'), 'Something typed');

    fireEvent.press(screen.getByLabelText('Go back'));

    expect(screen.getByText('What did you eat?')).toBeTruthy();
    // Cancelling actually discards it, not just hides the form behind it.
    fireEvent.press(screen.getByText('Type it in instead'));
    expect(screen.getByPlaceholderText('Chicken karahi').props.value).toBe('');
  });
});
