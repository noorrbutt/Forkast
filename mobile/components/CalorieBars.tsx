import { Text, View } from 'react-native';

import { formatNumber, shortDay } from '../lib/format';
import type { CaloriesByDay } from '../lib/types';
import { split, useTheme } from '../theme';

const CHART_HEIGHT = 120;

/**
 * Section 9: a 2px surface gap between adjacent fills so they never merge.
 * Eaten and burned sit side by side inside one day, and without this the two
 * read as a single taller bar on a phone.
 */
const SERIES_GAP = 2;

/**
 * The same 2px, between the two stacked halves of the eaten bar.
 *
 * Here it is doing more than keeping two fills from merging. Junk and not-junk
 * are only 6.3 apart in OKLab under simulated red-green colour blindness, which
 * the guide allows solely when something other than colour also separates them.
 * This gap is one of the three things that does.
 */
const STACK_GAP = 2;

/**
 * Half the space between one day and the next, carried as padding on the column
 * rather than as a row gap on the parent.
 *
 * The reason is alignment: a gap changes how flex distributes the remaining
 * width, so an axis row with seven ticks and a bar row with fourteen columns
 * would drift apart and a tick would stop sitting under the day it names.
 * Padding is inside the flex share, so both rows divide the width identically.
 * It is also three times the gap inside a pair, which is what makes the pair
 * read as one day rather than as two neighbours.
 */
const DAY_INSET = 3;

/** So a small but non zero day still draws a mark. A zero day draws nothing. */
const MIN_MARK = 2;

/** At most this many ticks on the axis, whatever the window length. */
const MAX_TICKS = 7;

/**
 * One day per column: what was eaten, split by whether it was junk, and what
 * was burned beside it.
 *
 * Both series are kcal, so they share one scale and one axis. A second y axis
 * would let the two be drawn at whatever relative height flattered the day, and
 * the style guide bans it outright for exactly that reason.
 *
 * Both series are always drawn, even on a day with nothing burned. A chart that
 * silently changes which series it carries is the same failure as a bar that
 * moves for an unexplained reason: the shape means one thing today and another
 * thing tomorrow, and nothing on screen says which.
 *
 * No chart library. It keeps the bundle small and lets the marks inherit the
 * same radius language as everything else.
 */
export function CalorieBars({ data }: { data: CaloriesByDay[] }) {
  const { colors, isDark, layout, radius, spacing, type } = useTheme();
  const half = isDark ? split.dark : split.light;

  if (data.length === 0) {
    return (
      <Text style={[type.caption, { color: colors.muted }]}>
        No days logged yet, your fortnight will draw itself in here.
      </Text>
    );
  }

  // One scale across both series, so a burned bar and an eaten bar of the same
  // height are the same number of calories.
  const peak = Math.max(
    1,
    ...data.map((entry) => Math.max(entry.calories ?? 0, entry.burned ?? 0)),
  );

  // Thin the ticks rather than the labels. Shrinking or clipping a weekday name
  // is how "Maintain" became "Maint...", so a label is either drawn in full or
  // not drawn at all.
  const step = Math.max(1, Math.ceil(data.length / MAX_TICKS));
  const chunks: CaloriesByDay[][] = [];
  for (let i = 0; i < data.length; i += step) chunks.push(data.slice(i, i + step));

  const heightOf = (value: number) =>
    value <= 0 ? 0 : Math.max(MIN_MARK, (value / peak) * CHART_HEIGHT);

  /**
   * Clamped to the day's total, rather than trusted.
   *
   * junk_calories arrives from the server as its own figure, and a build
   * talking to an older one does not get it at all. Without the clamp a value
   * larger than the total would draw a cap taller than the bar it sits on, and
   * the missing field would make `calories - undefined` NaN, which lays out as
   * a bar of no height at all with nothing on screen saying why.
   */
  const junkOf = (entry: CaloriesByDay) =>
    Math.max(0, Math.min(entry.junk_calories ?? 0, entry.calories ?? 0));
  const cleanOf = (entry: CaloriesByDay) => Math.max(0, (entry.calories ?? 0) - junkOf(entry));

  // Said once, in the spoken summary. Fourteen columns read out one by one tell
  // nobody the shape of the fortnight; the proportion does.
  const totalEaten = Math.max(1, data.reduce((sum, entry) => sum + (entry.calories ?? 0), 0));
  const totalJunk = data.reduce((sum, entry) => sum + junkOf(entry), 0);

  /**
   * Three marks, and the eaten bar carries two of them.
   *
   * It used to be one saffron bar for everything eaten. Saffron is the brand
   * colour, reserved for "you can press this", and spending it on a chart both
   * weakened that and said nothing about the food. Splitting the bar is the
   * whole point of the chart: a 2,000 kcal day of nothing but junk and a 2,000
   * kcal day of none is the same bar otherwise.
   *
   * Burned stays neutral on purpose. It is a different measure rather than a
   * third category of food, and outline is the one grey held at 3:1 against the
   * card, so the mark is visible without claiming a meaning it does not have.
   */
  const series = [
    { key: 'junk', label: 'Junk', color: half.junk },
    { key: 'clean', label: 'Everything else', color: half.clean },
    { key: 'burned', label: 'Burned', color: colors.outline },
  ];

  return (
    <View style={{ gap: spacing.md }}>
      {/* Identity is the swatch plus the word, never the colour alone, and the
          words wear a text token rather than the colour of their series. */}
      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        {series.map((entry) => (
          <View
            key={entry.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
          >
            <View
              style={{
                width: spacing.md,
                height: spacing.md,
                borderRadius: radius.pill,
                backgroundColor: entry.color,
              }}
            />
            <Text style={[type.caption, { color: colors.muted }]}>{entry.label}</Text>
          </View>
        ))}
      </View>

      <View
        // Collapsed into one reading. Fourteen days announced column by column
        // is a minute of speech that tells nobody the shape of the fortnight.
        accessible
        accessibilityLabel={`Calories by day, ${data.length} ${data.length === 1 ? 'day' : 'days'}. Each day splits into junk and everything else, with burned beside it on the same scale. ${totalJunk === 0 ? 'No junk in this window.' : `${Math.round((totalJunk / totalEaten) * 100)} percent junk across the window.`} Tallest bar ${formatNumber(peak)} kcal.`}
        style={{ gap: spacing.sm }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT }}>
          {data.map((entry, index) => (
            <View
              key={`bars-${entry.day}-${index}`}
              style={{
                flex: 1,
                height: '100%',
                paddingHorizontal: DAY_INSET,
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: SERIES_GAP,
              }}
            >
              {/* The eaten bar, stacked. Junk sits on top, always, which is
                  the position half of the secondary encoding: whatever the
                  colours look like to a given pair of eyes, the cap is the
                  junk. The base carries the radius when there is no cap. */}
              <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                {junkOf(entry) > 0 ? (
                  <View
                    style={{
                      height: heightOf(junkOf(entry)),
                      backgroundColor: half.junk,
                      borderTopLeftRadius: radius.pill,
                      borderTopRightRadius: radius.pill,
                      marginBottom: cleanOf(entry) > 0 ? STACK_GAP : 0,
                    }}
                  />
                ) : null}
                {cleanOf(entry) > 0 ? (
                  <View
                    style={{
                      height: heightOf(cleanOf(entry)),
                      backgroundColor: half.clean,
                      borderTopLeftRadius: junkOf(entry) > 0 ? 0 : radius.pill,
                      borderTopRightRadius: junkOf(entry) > 0 ? 0 : radius.pill,
                    }}
                  />
                ) : null}
              </View>
              <View
                style={{
                  flex: 1,
                  height: heightOf(entry.burned ?? 0),
                  backgroundColor: colors.outline,
                  borderTopLeftRadius: radius.pill,
                  borderTopRightRadius: radius.pill,
                }}
              />
            </View>
          ))}
        </View>

        {/* The axis, kept to a hairline. A grid heavy enough to read against is
            a grid competing with the marks. */}
        <View style={{ height: layout.hairline, backgroundColor: colors.border }} />

        <View style={{ flexDirection: 'row' }}>
          {chunks.map((chunk, index) => (
            <Text
              key={`tick-${chunk[0].day}-${index}`}
              // Deliberately no numberOfLines. A tick either fits or wraps; it
              // never truncates.
              style={[
                type.caption,
                { color: colors.muted, flex: chunk.length, paddingHorizontal: DAY_INSET },
              ]}
            >
              {shortDay(chunk[0].day)}
            </Text>
          ))}
        </View>
      </View>

      {/* One number rather than a full scale, which is all a fortnight of bars
          needs to stop being decoration. */}
      <Text style={[type.caption, { color: colors.muted }]}>
        {`Tallest bar ${formatNumber(peak)} kcal.`}
      </Text>
    </View>
  );
}
