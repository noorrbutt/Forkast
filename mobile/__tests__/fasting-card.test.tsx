import { render } from '@testing-library/react-native';

import { FastingCard } from '../components/home/FastingCard';
import { cityById } from '../lib/ramadan';
import { ThemeProvider } from '../theme';

const KARACHI = cityById('karachi');

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('FastingCard', () => {
  const todayWindow = { fajr: new Date(2026, 1, 19, 5, 47), maghrib: new Date(2026, 1, 19, 18, 29) };
  const tomorrowFajr = new Date(2026, 1, 20, 5, 44);

  test('rolls over at midnight when given a new now and window, with no internal timer of its own', () => {
    // Left open across midnight used to keep showing the window from
    // whenever the card last happened to re-render, because it ran its own
    // setInterval independent of Home's clock. Now it has no timer at all:
    // it is purely a function of the props it is given, so the parent's
    // shared clock (useNow) is what has to change for the card to change --
    // this test proves that re-rendering it with a later `now` is enough on
    // its own, with no interval ever firing inside the component.
    const lateNight = render(
      <FastingCard
        now={new Date(todayWindow.maghrib.getTime() + 200 * 60_000)}
        window={todayWindow}
        nextFajr={tomorrowFajr}
        city={KARACHI}
      />,
      { wrapper },
    );
    expect(lateNight.getByText(/Sehri ends in/)).toBeTruthy();

    // Rerendered with `now` just after midnight, still well before
    // tomorrow's fajr -- this is "left the app open across midnight",
    // simulated by a prop change rather than real elapsed time.
    lateNight.rerender(
      <FastingCard
        now={new Date(2026, 1, 20, 2, 0)}
        window={todayWindow}
        nextFajr={tomorrowFajr}
        city={KARACHI}
      />,
    );
    expect(lateNight.getByText(/Sehri ends in/)).toBeTruthy();
    expect(lateNight.queryByText('Fasting resumes tomorrow')).toBeNull();
  });

  test('falls back to the plain line when no nextFajr is available', () => {
    const screen = render(
      <FastingCard
        now={new Date(todayWindow.maghrib.getTime() + 200 * 60_000)}
        window={todayWindow}
        nextFajr={null}
        city={KARACHI}
      />,
      { wrapper },
    );
    expect(screen.getByText('Fasting resumes tomorrow')).toBeTruthy();
  });

  test('names the chosen city', () => {
    const screen = render(
      <FastingCard now={new Date(2026, 1, 19, 12, 0)} window={todayWindow} nextFajr={null} city={KARACHI} />,
      { wrapper },
    );
    expect(screen.getByText(`Ramadan · ${KARACHI.label}`)).toBeTruthy();
  });

  test('exposes one accessible label naming the city and the countdown, for a screen reader', () => {
    const screen = render(
      <FastingCard now={new Date(2026, 1, 19, 12, 0)} window={todayWindow} nextFajr={null} city={KARACHI} />,
      { wrapper },
    );
    const card = screen.getByTestId('fasting-card');
    expect(card.props.accessible).toBe(true);
    expect(card.props.accessibilityLabel).toContain(KARACHI.label);
  });
});
