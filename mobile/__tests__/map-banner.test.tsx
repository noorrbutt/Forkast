import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';

jest.mock('../components/MapCanvas', () => ({
  MAPS_UNAVAILABLE: true,
  MapView: null,
  Marker: null,
  PROVIDER_DEFAULT: undefined,
}));
jest.mock('../hooks/useLogs', () => ({ useLogs: jest.fn() }));
jest.mock('../hooks/useRestaurants', () => ({ useVisitedRestaurants: jest.fn() }));

import { MapScreen } from '../components/MapScreen';
import { useLogs } from '../hooks/useLogs';
import { useVisitedRestaurants } from '../hooks/useRestaurants';
import { ThemeProvider } from '../theme';

const mockedUseLogs = useLogs as jest.Mock;
const mockedUseVisitedRestaurants = useVisitedRestaurants as jest.Mock;
const originalPlatform = Platform.OS;

beforeEach(() => {
  mockedUseLogs.mockReturnValue({
    data: { items: [], total: 0 },
    isLoading: false,
    isError: false,
  });
  mockedUseVisitedRestaurants.mockReturnValue({
    data: [
      {
        id: 'spot-1',
        name: 'Cafe Forkast',
        area: 'Gulberg',
        latitude: null,
        longitude: null,
        visit_count: 1,
      },
    ],
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { get: () => originalPlatform, configurable: true });
});

function renderMapScreen() {
  return render(
    <ThemeProvider>
      <MapScreen />
    </ThemeProvider>,
  );
}

describe('Android map fallback notice', () => {
  it('shows a dismissible notice on the unavailable Android path', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
    const screen = renderMapScreen();

    expect(
      screen.getByText('Pins and map are unavailable in this build on this device.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Dismiss map availability notice' }));
    expect(
      screen.queryByText('Pins and map are unavailable in this build on this device.'),
    ).toBeNull();
  });

  it('does not show the Android notice on the web fallback', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'web', configurable: true });
    const screen = renderMapScreen();

    expect(
      screen.queryByText('Pins and map are unavailable in this build on this device.'),
    ).toBeNull();
    expect(
      screen.getByText('Grouped by area. The map itself is native only, so it does not draw in a browser.'),
    ).toBeTruthy();
  });
});