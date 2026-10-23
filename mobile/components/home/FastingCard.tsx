import { useEffect, useState } from 'react';
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
 */
export function FastingCard({
  window,
  city,
}: {
  window: { fajr: Date; maghrib: Date };
  city: City;
}) {
  const { colors, spacing, type } = useTheme();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const title = countdownText(now, window);

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
