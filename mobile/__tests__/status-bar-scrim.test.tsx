/**
 * Screen's status-bar scrim, and the HeroWash pullUp math it relies on.
 *
 * Without a frosted header, nothing covers the status bar, and a screen
 * whose content (or, on Home, a HeroWash pulled up to y=0) scrolls under it
 * prints over the clock and carrier text. The scrim is a plain strip exactly
 * insets.top tall, shown only where there is genuinely nothing else already
 * covering that space.
 */

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Screen } from '../components/ui/Screen';
import { ThemeProvider } from '../theme';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrap({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
    </ThemeProvider>
  );
}

describe('Screen status-bar scrim', () => {
  it('is shown when there is no header', () => {
    const { getByTestId } = render(
      <Screen>
        <Text>content</Text>
      </Screen>,
      { wrapper: wrap },
    );

    expect(getByTestId('status-bar-scrim')).toBeTruthy();
  });

  it('is exactly insets.top tall', () => {
    const { getByTestId } = render(
      <Screen>
        <Text>content</Text>
      </Screen>,
      { wrapper: wrap },
    );

    const flat = Object.assign({}, ...[getByTestId('status-bar-scrim').props.style].flat(4));
    expect(flat.height).toBe(METRICS.insets.top);
  });

  it('is absent when the screen has a frosted header', () => {
    const { queryByTestId } = render(
      <Screen title="Settings">
        <Text>content</Text>
      </Screen>,
      { wrapper: wrap },
    );

    expect(queryByTestId('status-bar-scrim')).toBeNull();
  });

  it('is absent when the screen has a back button header', () => {
    const { queryByTestId } = render(
      <Screen onBack={() => {}}>
        <Text>content</Text>
      </Screen>,
      { wrapper: wrap },
    );

    expect(queryByTestId('status-bar-scrim')).toBeNull();
  });

  it('is absent on a bleed-top screen, which draws its own art under the status bar', () => {
    const { queryByTestId } = render(
      <Screen bleedTop>
        <Text>content</Text>
      </Screen>,
      { wrapper: wrap },
    );

    expect(queryByTestId('status-bar-scrim')).toBeNull();
  });

  it('never intercepts touches', () => {
    const { getByTestId } = render(
      <Screen>
        <Text>content</Text>
      </Screen>,
      { wrapper: wrap },
    );

    expect(getByTestId('status-bar-scrim').props.pointerEvents).toBe('none');
  });
});
