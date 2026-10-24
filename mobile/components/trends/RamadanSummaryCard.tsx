import { Text, View } from 'react-native';

import { Card, SkeletonCard } from '../ui';
import { useRamadanSummary } from '../../hooks/useRamadanSummary';
import { formatNumber } from '../../lib/format';
import { useTheme } from '../../theme';

/**
 * Ramadan's own retrospective on Trends: how sehri, iftar and the nights in
 * between actually went this Ramadan, from logs already on the server.
 *
 * Neutral throughout, on purpose. This card does not know whether someone is
 * fasting for the whole month or logging normally with the mode simply left
 * on, and it has no goal to measure either figure against -- so every row
 * reports a number and stops, the same restraint TrendCard's own calorie and
 * meal rows already use for figures with no built-in direction.
 */
export function RamadanSummaryCard() {
  const { colors, spacing, type } = useTheme();
  const { summary, isLoading } = useRamadanSummary();

  if (isLoading) return <SkeletonCard rows={4} />;

  // Hidden under five logged days: see useRamadanSummary's own threshold.
  // Not an error state and not an empty state either, just nothing shown,
  // since there is nothing yet worth saying.
  if (!summary) return null;

  const rows: { label: string; value: string }[] = [
    { label: 'Days logged this Ramadan', value: formatNumber(summary.daysLogged) },
    {
      label: 'Average sehri',
      value: summary.avgSehriKcal !== null ? `${formatNumber(summary.avgSehriKcal)} kcal` : 'Not logged yet',
    },
    {
      label: 'Average iftar',
      value: summary.avgIftarKcal !== null ? `${formatNumber(summary.avgIftarKcal)} kcal` : 'Not logged yet',
    },
    { label: 'Logged late at night', value: `${summary.lateNightSharePct}%` },
  ];

  return (
    <Card>
      <View style={{ gap: spacing.lg }}>
        <Text style={[type.title, { color: colors.text }]}>This Ramadan</Text>

        {rows.map((row) => (
          <View
            key={row.label}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}
          >
            <Text style={[type.body, { color: colors.text, flex: 1 }]}>{row.label}</Text>
            <Text
              style={[
                type.subtitle,
                { color: colors.text, textAlign: 'right', fontVariant: ['tabular-nums'] },
              ]}
            >
              {row.value}
            </Text>
          </View>
        ))}

        {summary.junkShareAtIftarPct !== null && summary.junkShareRestPct !== null ? (
          <Text style={[type.caption, { color: colors.muted }]}>
            {`Junk share of what was logged: ${summary.junkShareAtIftarPct}% at iftar, ${summary.junkShareRestPct}% at other times.`}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
