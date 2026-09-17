/**
 * The floating tab bar: which cut of each glyph is drawn for which state, and
 * the raised centre action.
 *
 * Reanimated is mocked in this runner, so nothing here proves that a fade runs
 * or that it takes the 220ms it is configured with; only a device answers
 * that. What these can prove is that both cuts of every destination glyph are
 * mounted and ready to be cross faded, that the selected tab is the filled one
 * while every other is the outline, and that the raised button in the middle
 * still navigates rather than being decoration.
 *
 * The bar is driven here with a fabricated navigation state rather than
 * through the real navigator, because what is under test is the bar, not
 * expo-router's routing.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { FloatingTabBar } from '../app/(tabs)/_layout';
import { ThemeProvider } from '../theme';

const mockedHaptics = Haptics as jest.Mocked<typeof Haptics>;

/** The five routes in the order the layout declares them, log dead centre. */
const TABS = [
  { route: 'index', title: 'Home', glyph: 'dashboard' },
  { route: 'history', title: 'Meals', glyph: 'history' },
  { route: 'log', title: 'Log', glyph: 'log' },
  { route: 'streaks', title: 'Streaks', glyph: 'streaks' },
  { route: 'profile', title: 'You', glyph: 'profile' },
];

/** Every glyph that gets the outline treatment, so the raised one is excluded. */
const NAVIGATION_GLYPHS = ['dashboard', 'history', 'streaks', 'profile'];

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

function mountBar(selected: number) {
  const navigate = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const routes = TABS.map((tab) => ({
    key: `${tab.route}-key`,
    name: tab.route,
    params: undefined,
  }));
  const descriptors = Object.fromEntries(
    routes.map((route, index) => [route.key, { options: { title: TABS[index].title } }]),
  );

  const props = {
    state: { index: selected, routes },
    descriptors,
    navigation: { navigate, emit },
    // An iPhone 14, so the bar floats above a real home indicator.
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
  } as unknown as BottomTabBarProps;

  return { screen: render(<FloatingTabBar {...props} />, { wrapper }), navigate, emit };
}

/** What the cross fade left this layer at, once the style array is flattened. */
function opacityOf(screen: ReturnType<typeof render>, testID: string): number {
  const style = StyleSheet.flatten(screen.getByTestId(testID).props.style) as { opacity: number };
  return style.opacity;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the glyph the selection draws', () => {
  it('fills the tab you are on and outlines the ones you are not', () => {
    const { screen } = mountBar(0);

    expect(opacityOf(screen, 'tab-glyph-dashboard-filled')).toBe(1);
    expect(opacityOf(screen, 'tab-glyph-dashboard-outline')).toBe(0);

    for (const glyph of NAVIGATION_GLYPHS.filter((name) => name !== 'dashboard')) {
      expect(opacityOf(screen, `tab-glyph-${glyph}-filled`)).toBe(0);
      expect(opacityOf(screen, `tab-glyph-${glyph}-outline`)).toBe(1);
    }
  });

  it('moves the fill when a different tab is the selected one', () => {
    const { screen } = mountBar(3);

    expect(opacityOf(screen, 'tab-glyph-streaks-filled')).toBe(1);
    expect(opacityOf(screen, 'tab-glyph-dashboard-filled')).toBe(0);
    expect(opacityOf(screen, 'tab-glyph-dashboard-outline')).toBe(1);
  });

  it('keeps both cuts mounted, which is what lets the change be faded', () => {
    // A swap would put one glyph in the tree and replace it. Two glyphs with
    // opposite opacities is the thing that can cross fade at all.
    const { screen } = mountBar(0);

    const drawn = screen.UNSAFE_getAllByType(Ionicons).map((node) => node.props.name);

    expect(drawn).toEqual(
      expect.arrayContaining([
        'home',
        'home-outline',
        'flame',
        'flame-outline',
        'time',
        'time-outline',
        'person',
        'person-outline',
      ]),
    );
  });

  it('tells assistive tech which tab is selected, rather than leaving it to the fill', () => {
    const { screen } = mountBar(1);

    expect(screen.getByLabelText('Meals').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Home').props.accessibilityState.selected).toBe(false);
  });
});

describe('moving between tabs', () => {
  it('navigates to the tab that was tapped', () => {
    const { screen, navigate } = mountBar(0);

    fireEvent.press(screen.getByLabelText('Meals'));

    expect(navigate).toHaveBeenCalledWith('history', undefined);
  });

  it('bumps only when the tap actually goes somewhere', () => {
    const { screen, navigate } = mountBar(0);

    fireEvent.press(screen.getByLabelText('Home'));

    expect(navigate).not.toHaveBeenCalled();
    expect(mockedHaptics.impactAsync).not.toHaveBeenCalled();
  });

  it('respects a tab press the navigator cancelled', () => {
    const { screen, navigate, emit } = mountBar(0);
    emit.mockReturnValue({ defaultPrevented: true });

    fireEvent.press(screen.getByLabelText('Streaks'));

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('the raised centre button', () => {
  it('still navigates to the log tab', () => {
    const { screen, navigate } = mountBar(0);

    fireEvent.press(screen.getByLabelText('Log a meal'));

    expect(navigate).toHaveBeenCalledWith('log', undefined);
  });

  it('says what it does, since a plus sign on its own does not', () => {
    const { screen } = mountBar(0);

    expect(screen.getByLabelText('Log a meal').props.accessibilityHint).toBe(
      'Record something you ate',
    );
  });

  it('does not sit in the row it is raised above, so the other tabs stay even', () => {
    // The centre route renders a spacer in the row and the button over it, so
    // there is no fourth pressable label in the strip.
    const { screen } = mountBar(0);

    expect(screen.queryByLabelText('Log')).toBeNull();
  });
});
