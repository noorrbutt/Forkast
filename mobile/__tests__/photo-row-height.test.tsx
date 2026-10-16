/**
 * PhotoMealRow's photo trims down on a narrow phone so more of the diary
 * fits on one screen, without touching the wide-phone height everyone else
 * already had.
 */

import { render } from '@testing-library/react-native';

// A mutable width the mock reads live, rather than resetModules + a fresh
// require per test: resetModules duplicates React's own module instance,
// which breaks every hook in the tree with "Cannot read properties of null
// (reading 'useMemo')" since the rendered tree and the test's React are then
// two different copies.
let mockWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 3, fontScale: 1 }),
}));

import { PhotoMealRow } from '../components/diary/PhotoMealRow';
import { ThemeProvider } from '../theme';
import type { MealRowProps } from '../components/diary/rowProps';

const LOG = {
  id: 'log-1',
  has_photo: true,
  dish_name: 'Chicken Biryani',
  category_id: 1,
  restaurant_id: null,
  area: null,
  rating: 4,
  fun_scale: null,
  friend_scale: null,
  serving_size: 'medium',
  estimated_calories: 750,
  estimate_source: 'local',
  calorie_source: null,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
  refined: false,
  created_at: '2026-09-17T19:00:00Z',
  category: null,
  restaurant: null,
} as const;

const NOOP_PROPS: Omit<MealRowProps, 'log' | 'last'> = {
  onOpen: jest.fn(),
  onRepeat: jest.fn(),
  onDelete: jest.fn(),
  onAskDelete: jest.fn(),
  onLongPress: jest.fn(),
  sending: false,
  confirmed: false,
  error: null,
};

/** The height a style array actually resolves to. */
function heightOf(node: { props: { style?: unknown } }): number | undefined {
  const flat = Object.assign({}, ...[node.props.style].flat(4).filter((s) => s && typeof s === 'object'));
  return flat.height;
}

describe('the photo card height', () => {
  it('is 240 on an ordinary phone width', () => {
    mockWidth = 390;
    const { getByTestId } = render(
      <ThemeProvider>
        <PhotoMealRow log={LOG} last {...NOOP_PROPS} />
      </ThemeProvider>,
    );

    expect(heightOf(getByTestId('photo-card-frame'))).toBe(240);
  });

  it('drops to 180 below the narrow-phone width', () => {
    mockWidth = 360;
    const { getByTestId } = render(
      <ThemeProvider>
        <PhotoMealRow log={LOG} last {...NOOP_PROPS} />
      </ThemeProvider>,
    );

    expect(heightOf(getByTestId('photo-card-frame'))).toBe(180);
  });
});
