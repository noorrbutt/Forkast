import { Pressable, Text, View } from 'react-native';

import { Card, Icon } from '../ui';
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
 *
 * Titled "Last 7 days" rather than "This week": the window is a rolling
 * seven days ending today, Saturday to Friday on a Friday, not the calendar
 * week, and calling it a week promised a boundary it does not have.
 */

const CHART_HEIGHT = 72;
const BAR_WIDTH = 18;
/** A day with nothing logged still gets a stub, so the week has seven places. */
const STUB = 2;
/** The target line: a thin, quiet dash, so it reads as a reference rather
 * than outweighing the bars it is there to support. */
const TARGET_LINE = 1;

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
  const targetBottom = goal !== null ? (goal / top) * CHART_HEIGHT : 0;

  const summary = week
    .map((day) => `${shortDay(day.day)} ${formatNumber(day.calories)} kcal`)
    .join(', ');

  // Seven empty dashes and one bar say almost nothing on their own, so the
  // chart is backed by one sentence: how many of the seven days actually
  // landed on target. A day with nothing logged is not on target, it is
  // missing, and counts against the total the same as a day that went over.
  const onTargetDays = week.filter((day) => day.calories > 0 && day.calories <= (goal ?? Infinity)).length;
  const loggedDays = week.filter((day) => day.calories > 0).length;
  const pace =
    goal === null
      ? null
      : loggedDays === 0
        ? 'Nothing logged this week yet.'
        : `${onTargetDays} of ${week.length} days on target.`;

  return (
    <Card>
      <View style={{ gap: spacing.lg }}>
        <Text style={[type.title, { color: colors.text }]}>Last 7 days</Text>

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
              <>
                <View
                  testID="week-target-line"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: targetBottom,
                    borderTopWidth: TARGET_LINE,
                    borderStyle: 'dashed',
                    borderColor: colors.muted,
                  }}
                />
                {/* Labelled in place rather than in a separate legend row, so
                    the line reads as "this is the target" on its own. */}
                <Text
                  style={[
                    type.labelSoft,
                    {
                      position: 'absolute',
                      right: 0,
                      bottom: Math.min(targetBottom + 2, CHART_HEIGHT - 12),
                      color: colors.muted,
                      backgroundColor: colors.surface,
                      paddingLeft: spacing.xs,
                    },
                  ]}
                >
                  {`Target ${formatNumber(goal)}`}
                </Text>
              </>
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

          {pace ? (
            <Text style={[type.caption, { color: colors.muted }]}>{pace}</Text>
          ) : null}
        </View>

        {/* A chevron link rather than a second outlined pill: "See the plan"
            above it already carries that weight, and two heavy buttons
            stacked in cards was noise, not emphasis. */}
        <Pressable
          onPress={onSeeTrends}
          accessibilityRole="button"
          accessibilityLabel="See trends"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: spacing.xs,
            opacity: pressed ? 0.6 : 1,
            minHeight: 44,
          })}
        >
          <Text style={[type.body, { color: colors.accent, fontWeight: '600' }]}>See trends</Text>
          <Icon name="forward" size={16} color={colors.accent} />
        </Pressable>
      </View>
    </Card>
  );
}
