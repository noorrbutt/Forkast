import { Text, View } from 'react-native';

import { Card, ErrorState, SkeletonCard } from '../ui';
import { useTrend } from '../../hooks/useInsights';
import { describeError } from '../../lib/api';
import { formatNumber, formatRatio } from '../../lib/format';
import { useTheme } from '../../theme';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The month name behind the backend's first of the month date.
 *
 * Split by hand rather than handed to Date, which reads a date only string as
 * UTC midnight and would name the month before it for anyone west of Greenwich.
 */
function monthName(month: string): string {
  const index = Number(month.split('-')[1]) - 1;
  return MONTHS[index] ?? month;
}

/**
 * Whether a movement was good, where the app is entitled to an opinion.
 *
 * Only the junk ratio gets one. Calories and meals genuinely have no direction
 * that counts as progress: someone bulking wants the number up, someone cutting
 * wants it down, and this card does not know which. Eating a smaller share of
 * junk is the one movement Forkast's own model calls an improvement, which is
 * why the whole chart is split by it.
 */
type Verdict = 'good' | 'bad' | 'level' | 'none';

/**
 * How a number moved, with no verdict attached.
 *
 * Fewer calories is not automatically progress and more is not automatically a
 * failure. Someone bulking wants the number up, someone cutting wants it down,
 * and this card does not know which, so it reports the direction and stops.
 */
function describeChange(change: number, unit: string, against: string): string {
  if (change === 0) return `Level with ${against}`;
  return `${change > 0 ? 'Up' : 'Down'} ${formatNumber(Math.abs(change))} ${unit} on ${against}`;
}

/**
 * Meals logged per logged day, to one decimal place.
 *
 * Divided by days_logged, not the period's calendar length: a day with
 * nothing logged is not a day eating zero meals, it is a day with no data,
 * and counting it as zero understated everyone who ever skipped a day.
 */
function mealsPerDay(period: { meals_logged: number; days_logged: number }): number {
  if (period.days_logged <= 0) return 0;
  return Math.round((period.meals_logged / period.days_logged) * 10) / 10;
}

/**
 * This calendar month against the last one.
 *
 * Third level and drawn like it. The figures used to sit at `numeral`, 26,
 * which put a month long total within a hair of the two numbers the hero is
 * made of. They are `subtitle` now and carry their weight rather than their
 * size.
 */
export function TrendCard({ trend }: { trend: ReturnType<typeof useTrend> }) {
  const { colors, spacing, type } = useTheme();
  const data = trend.data;

  if (trend.isLoading) {
    return <SkeletonCard rows={4} />;
  }

  if (trend.isError && !data) {
    return (
      <ErrorState
        title="Trend unavailable"
        message={describeError(trend.error)}
        onRetry={() => void trend.refetch()}
      />
    );
  }

  if (!data) return null;

  const now = data.this_month;
  const before = data.last_month;
  const thisName = monthName(now.month);
  const lastName = monthName(before.month);
  // A month with no meals in it reports a junk ratio of zero because there was
  // nothing that could be junk, so comparing against it would invent movement
  // nobody made. Nothing logged means nothing to compare, and it says so.
  const comparable = before.meals_logged > 0;

  // The same rounded points the sentence is built from, so the colour and the
  // words can never disagree about which way the month went.
  const junkPoints = Math.round(now.junk_ratio * 100) - Math.round(before.junk_ratio * 100);

  // Calories and meals are compared as a pace per day, never as totals. The
  // current month is only as old as today, so its total against a whole
  // finished month always read as a collapse ("Down 11,113 kcal" on the 8th)
  // that a footnote then had to walk back. Both periods are divided by their
  // own days_logged (not days_counted: a day with nothing logged is missing
  // data, not a zero-calorie day, and counting it as one understated anyone
  // who skipped a day), so the two figures cover equal footing whatever the
  // date and whatever got missed.
  const caloriesPace = Math.round(now.avg_calories_per_day);
  const caloriesChange = caloriesPace - Math.round(before.avg_calories_per_day);
  const nowMeals = mealsPerDay(now);
  const mealsChange = Math.round((nowMeals - mealsPerDay(before)) * 10) / 10;

  const rows: { label: string; value: string; change: string; verdict: Verdict }[] = [
    {
      label: 'Calories a day',
      value: formatNumber(caloriesPace),
      change: describeChange(caloriesChange, 'kcal a day', lastName),
      verdict: 'none',
    },
    {
      label: 'Meals a day',
      value: nowMeals.toFixed(1),
      change:
        mealsChange === 0
          ? `Level with ${lastName}`
          : `${mealsChange > 0 ? 'Up' : 'Down'} ${Math.abs(mealsChange).toFixed(1)} a day on ${lastName}`,
      verdict: 'none',
    },
    {
      // "Junk meals", not "junk ratio", because that is what the figure counts:
      // junk logs over total logs. The chart directly above this splits each
      // day by junk CALORIES, so the two answer different questions and can
      // disagree on screen. One fries against one biryani is half the meals and
      // about a quarter of the calories, and the card used to imply the chart
      // was wrong about it.
      label: 'Junk meals',
      value: formatRatio(now.junk_ratio),
      // Points taken from the two percentages that actually get printed, so the
      // direction can never disagree with the number sitting beside it.
      change: describeChange(junkPoints, 'points', lastName),
      verdict: junkPoints === 0 ? 'level' : junkPoints < 0 ? 'good' : 'bad',
    },
  ];

  const nothingEither = now.meals_logged === 0 && !comparable;

  return (
    <Card>
      <View style={{ gap: spacing.lg }}>
        {/* Sentence case, no eyebrow, no icon. The heading is the words. */}
        <Text style={[type.title, { color: colors.text }]}>
          {`${thisName} against ${lastName}`}
        </Text>

        {nothingEither ? (
          <Text style={[type.caption, { color: colors.muted }]}>
            {`Nothing logged in ${thisName} or ${lastName}, so there is nothing to compare yet.`}
          </Text>
        ) : (
          <>
            {rows.map((row) => (
              <View
                key={row.label}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}
              >
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={[type.body, { color: colors.text }]}>{row.label}</Text>
                  {/* Coloured only where there is a verdict to carry, which is
                      the junk ratio alone. The words already say "Up" or
                      "Down", so the colour is a second reading of the same
                      fact rather than the only one: nothing here is carried by
                      colour by itself. The value beside it stays ink on
                      purpose, so one row never says the same thing twice. */}
                  {comparable ? (
                    <Text
                      style={[
                        type.caption,
                        {
                          color:
                            row.verdict === 'good'
                              ? colors.success
                              : row.verdict === 'bad'
                                ? colors.danger
                                : colors.muted,
                        },
                      ]}
                    >
                      {row.change}
                    </Text>
                  ) : null}
                </View>
                {/* Right aligned so three figures in a column can be compared. */}
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

            <Text style={[type.caption, { color: colors.muted }]}>
              {comparable
                ? `Averages from days actually logged: ${formatNumber(now.days_logged)} of ${formatNumber(now.days_counted)} in ${thisName} so far, ${formatNumber(before.days_logged)} of ${formatNumber(before.days_counted)} in ${lastName}.`
                : `Nothing logged in ${lastName}, so there is nothing to compare against. Next month this fills in.`}
            </Text>
          </>
        )}
      </View>
    </Card>
  );
}
