import { Text, View } from 'react-native';

import { Button, Card } from '../ui';
import { formatNumber, shortDay } from '../../lib/format';
import type { CaloriesByDay } from '../../lib/types';
import { useTheme } from '../../theme';

/**
 * The last seven days as seven small bars against the target, below the fold.
 *
 * A glance, not an analysis: the fortnight chart with its junk split, axis
 * and legend lives on Trends, one tap away through "See trends". Each bar is
 * a day measured against its target, which is the ring's own question asked
 * seven times, so it wears the ring's status colours (success inside,
 * danger past) rather than a data series; the dashed target line is the
 * second cue, so a bar over target also visibly crosses it.
 */

const CHART_HEIGHT = 72;
const BAR_WIDTH = 14;
/** A day with nothing logged still gets a stub, so the week has seven places. */
const STUB = 2;
/** The target line: 2px dashed in text, as on the calorie chart (section 8). */
const TARGET_LINE = 2;

export function WeekStrip({
  days,
  target,
  onSeeTrends,
}: {
  days: CaloriesByDay[];
  target: number | null;
  onSeeTrends: () => void;
}) {
  const { colors, spacing, type } = useTheme();
  const week = days.slice(-7);
  const goal = target !== null && target > 0 ? target : null;
  const top = Math.max(1, goal !== null ? goal * 1.2 : 0, ...week.map((day) => day.calories));

  const summary = week
    .map((day) => `${shortDay(day.day)} ${formatNumber(day.calories)} kcal`)
    .join(', ');

  return (
    <Card>
      <View style={{ gap: spacing.lg }}>
        <Text style={[type.title, { color: colors.text }]}>This week</Text>

        <View
          testID="week-strip"
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Last seven days: ${summary}.${goal !== null ? ` Target ${formatNumber(goal)} kcal.` : ''}`}
          style={{ gap: spacing.sm }}
        >
          <View style={{ height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end' }}>
            {week.map((day) => {
              const over = goal !== null && day.calories > goal;
              const fill =
                day.calories === 0
                  ? colors.meterTrack
                  : goal === null
                    ? colors.muted
                    : over
                      ? colors.danger
                      : colors.success;
              return (
                <View key={day.day} style={{ flex: 1, alignItems: 'center' }}>
                  <View
                    testID={`week-bar-${day.day}`}
                    style={{
                      width: BAR_WIDTH,
                      height: Math.max(STUB, (day.calories / top) * CHART_HEIGHT),
                      borderRadius: BAR_WIDTH / 2,
                      backgroundColor: fill,
                    }}
                  />
                </View>
              );
            })}

            {goal !== null ? (
              <View
                testID="week-target-line"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: (goal / top) * CHART_HEIGHT,
                  borderTopWidth: TARGET_LINE,
                  borderStyle: 'dashed',
                  borderColor: colors.text,
                }}
              />
            ) : null}
          </View>

          <View style={{ flexDirection: 'row' }}>
            {week.map((day) => (
              <Text
                key={day.day}
                style={[type.labelSoft, { flex: 1, textAlign: 'center', color: colors.muted }]}
              >
                {shortDay(day.day)}
              </Text>
            ))}
          </View>
        </View>

        <View style={{ alignSelf: 'flex-start' }}>
          <Button label="See trends" variant="ghost" onPress={onSeeTrends} />
        </View>
      </View>
    </Card>
  );
}
