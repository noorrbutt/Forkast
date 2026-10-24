import { Text, View } from 'react-native';

import { Card } from '../ui';
import { countdownText, type City } from '../../lib/ramadan';
import { useTheme } from '../../theme';

/**
 * Home's Ramadan-mode card: today's fasting window, as a live countdown.
 *
 * Sits above the Today strip rather than folded into HomeHero -- the hero's
 * figure is still what is left of the calorie target, which Ramadan mode does
 * not change, so the fasting window gets its own card rather than crowding
 * the one HomeHero already has a licence for.
 *
 * `now` is Home's own shared clock (useNow), not a timer of this card's own:
 * a card that ticks on its own schedule is exactly how this used to go stale
 * at midnight while every other screen that reads the same window had
 * already moved on. `nextFajr` is tomorrow's fajr, needed only for the night
 * phase's "Sehri ends in..." countdown -- see countdownText's own note.
 */
export function FastingCard({
  now,
  window,
  nextFajr,
  city,
}: {
  now: Date;
  window: { fajr: Date; maghrib: Date };
  nextFajr: Date | null;
  city: City;
}) {
  const { colors, spacing, type } = useTheme();
  const title = countdownText(now, window, nextFajr ?? undefined);

  return (
    <Card>
      <View testID="fasting-card" style={{ gap: spacing.xs }}>
        <Text style={[type.labelSoft, { color: colors.muted }]}>Ramadan · {city.label}</Text>
        <Text style={[type.subtitle, { color: colors.text }]}>{title}</Text>
        <Text style={[type.caption, { color: colors.muted }]}>
          Times are calculated; follow your local timetable.
        </Text>
      </View>
    </Card>
  );
}
