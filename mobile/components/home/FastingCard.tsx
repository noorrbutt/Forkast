import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '../ui';
import { phase, type City } from '../../lib/ramadan';
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
  const { t } = useTranslation();
  const { colors, spacing, type } = useTheme();
  const dayPhase = phase(now, window);
  const countdownTarget =
    dayPhase === 'before_sehri'
      ? window.fajr
      : dayPhase === 'fasting'
        ? window.maghrib
        : dayPhase === 'night'
          ? nextFajr
          : null;
  const durationMinutes =
    countdownTarget === null ? 0 : Math.max(0, Math.round((countdownTarget.getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  const duration =
    hours === 0
      ? t('home.durationMinutes', { minutes })
      : t('home.durationHoursMinutes', {
          hours,
          minutes: String(minutes).padStart(2, '0'),
        });
  const title =
    dayPhase === 'before_sehri'
      ? t('home.sehriEndsIn', { duration })
      : dayPhase === 'fasting'
        ? t('home.iftarIn', { duration })
        : dayPhase === 'iftar'
          ? t('home.iftarTime')
          : nextFajr
            ? t('home.sehriEndsIn', { duration })
            : t('home.fastingResumes');
  const cityLabel = t(`home.cities.${city.id}`, { defaultValue: city.label });

  return (
    <Card>
      <View
        testID="fasting-card"
        style={{ gap: spacing.xs }}
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('home.fastingA11y', {
          city: cityLabel,
          title,
        })}
      >
        <Text style={[type.labelSoft, { color: colors.muted }]}>
          {t('home.ramadanCity', { city: cityLabel })}
        </Text>
        <Text style={[type.subtitle, { color: colors.text }]}>{title}</Text>
        <Text style={[type.caption, { color: colors.muted }]}>
          {t('home.timetableNote')}
        </Text>
      </View>
    </Card>
  );
}
