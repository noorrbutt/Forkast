/**
 * The Ramadan share card and the row that offers it: visibility rules, and
 * the hard requirement that the captured image carries aggregates only.
 */

import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { RamadanShareCard } from '../components/trends/RamadanShareCard';
import { RamadanShareRow } from '../components/trends/RamadanShareRow';
import type { RamadanSummary } from '../hooks/useRamadanSummary';
import { ThemeProvider } from '../theme';

const SUMMARY: RamadanSummary = {
  daysLogged: 12,
  avgSehriKcal: 410,
  avgIftarKcal: 680,
  lateNightSharePct: 15,
  junkShareAtIftarPct: 20,
  junkShareRestPct: 5,
};

const mockUseRamadanSummary = jest.fn();
jest.mock('../hooks/useRamadanSummary', () => ({
  useRamadanSummary: () => mockUseRamadanSummary(),
}));

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('RamadanShareCard: aggregates only', () => {
  test('renders only numbers and fixed labels -- nothing identifying', () => {
    const { toJSON } = render(<RamadanShareCard summary={SUMMARY} />, { wrapper });
    const rendered = JSON.stringify(toJSON());

    // Every string literal this card can ever show is fixed copy or a
    // number derived from `summary`, which itself carries no photo, dish
    // name, restaurant, email or name (see useRamadanSummary's own type).
    // This asserts the negative directly: none of those four words -- the
    // things a leak would actually look like -- appear anywhere in the
    // rendered tree.
    for (const forbidden of ['@', 'dish', 'restaurant', 'photo']) {
      expect(rendered.toLowerCase()).not.toContain(forbidden);
    }
  });

  test('shows the four aggregate figures the summary carries', () => {
    const { getByText } = render(<RamadanShareCard summary={SUMMARY} />, { wrapper });
    expect(getByText('12')).toBeTruthy();
    expect(getByText('410')).toBeTruthy();
    expect(getByText('680')).toBeTruthy();
    expect(getByText('15%')).toBeTruthy();
  });

  test('a missing sehri or iftar average renders as a dash, not null or undefined', () => {
    const { getAllByText } = render(
      <RamadanShareCard summary={{ ...SUMMARY, avgSehriKcal: null, avgIftarKcal: null }} />,
      { wrapper },
    );
    expect(getAllByText('—')).toHaveLength(2);
  });
});

describe('RamadanShareRow visibility', () => {
  const realPlatformOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => realPlatformOS });
    jest.useRealTimers();
  });

  test('hidden with no summary (fewer than 5 logged days)', () => {
    mockUseRamadanSummary.mockReturnValue({ summary: null });
    const { queryByText } = render(<RamadanShareRow />, { wrapper });
    expect(queryByText('Share this Ramadan')).toBeNull();
  });

  test('hidden before the offered date even with a summary', () => {
    mockUseRamadanSummary.mockReturnValue({ summary: SUMMARY });
    jest.useFakeTimers().setSystemTime(new Date(2027, 1, 20)); // well before the end
    const { queryByText } = render(<RamadanShareRow />, { wrapper });
    expect(queryByText('Share this Ramadan')).toBeNull();
  });

  test('shown from 3 days before the end, with a summary', () => {
    mockUseRamadanSummary.mockReturnValue({ summary: SUMMARY });
    jest.useFakeTimers().setSystemTime(new Date(2027, 2, 8)); // 2 days before 2027-03-10
    const { getByText } = render(<RamadanShareRow />, { wrapper });
    expect(getByText('Share this Ramadan')).toBeTruthy();
  });

  test('hidden on web regardless of date or summary', () => {
    mockUseRamadanSummary.mockReturnValue({ summary: SUMMARY });
    jest.useFakeTimers().setSystemTime(new Date(2027, 2, 8));
    Object.defineProperty(Platform, 'OS', { get: () => 'web' });
    const { queryByText } = render(<RamadanShareRow />, { wrapper });
    expect(queryByText('Share this Ramadan')).toBeNull();
  });
});
