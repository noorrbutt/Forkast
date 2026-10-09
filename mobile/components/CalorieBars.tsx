import { Text, View } from 'react-native';

import { formatDate, formatNumber } from '../lib/format';
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
const DAY_INSET = 1;

/** So a small but non zero day still draws a mark. A zero day draws nothing. */
const MIN_MARK = 2;

/**
 * At most this many ticks on the axis, whatever the window length.
 *
 * Five, not seven, now that a tick is a date ("Sep 24") rather than a weekday
 * ("Thu"): seven dates do not fit across a phone without wrapping.
 */
const MAX_TICKS = 5;

/** Room for the y axis labels to the left of the plot. */
const Y_GUTTER = 36;

/** The target line's weight: thin and quiet, a reference rather than a
 * fourth series outweighing the data it sits over. */
const TARGET_LINE = 1;

/** The ink cap on a junk segment. Same 2px. */
const JUNK_CAP = 2;

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
export function CalorieBars({
  data,
  target,
}: {
  data: CaloriesByDay[];
  /** The daily target, drawn as a reference line. Null or zero draws none. */
  target?: number | null;
}) {
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

  // The target is drawn on the same scale, so the scale has to reach it even
  // on a fortnight that never came near it. The ceiling sits 15% above
  // whichever of the two is taller, not rounded up to the next whole
  // gridline step: that rounding alone could put the axis a third again
  // past the data, so every bar and the target line both sat in the bottom
  // half of the chart with empty space above them that nothing explained.
  const goal = target !== null && target !== undefined && target > 0 ? target : null;
  const { top, gridlines } = scaleFor(Math.max(peak, goal ?? 0) * 1.15);

  // Thin the ticks rather than the labels. Shrinking or clipping a date is how
  // "Maintain" became "Maint...", so a label is either drawn in full or not
  // drawn at all.
  const step = Math.max(1, Math.ceil(data.length / MAX_TICKS));
  const chunks: CaloriesByDay[][] = [];
  for (let i = 0; i < data.length; i += step) chunks.push(data.slice(i, i + step));

  const heightOf = (value: number) =>
    value <= 0 ? 0 : Math.max(MIN_MARK, (value / top) * CHART_HEIGHT);
  const offsetOf = (value: number) => (value / top) * CHART_HEIGHT;

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
   * third category of food, so it is grey rather than a hue. It wears `muted`
   * rather than `outline`: outline only just clears 3:1 against the card, and
   * a narrow bar at that contrast read as a disabled control rather than data.
   */
  const series = [
    { key: 'junk', label: 'Junk', color: half.junk, cap: true },
    { key: 'clean', label: 'Everything else', color: half.clean, cap: false },
    { key: 'burned', label: 'Burned', color: colors.muted, cap: false },
  ];

  return (
    <View style={{ gap: spacing.md }}>
      {/* Identity is the swatch plus the word, never the colour alone, and the
          words wear a text token rather than the colour of their series. */}
      {/* Wraps. Four entries, one of them reading "Everything else", do not
          fit across a narrow phone once the system text size goes up, and a
          legend that runs off the card explains nothing. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
        {series.map((entry) => (
          <View
            key={entry.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
          >
            {/* A small bar rather than a dot, so the junk swatch can carry the
                same ink cap the junk segments do. */}
            <View style={{ width: spacing.sm + 2, height: spacing.md }}>
              {entry.cap ? <JunkCap color={colors.text} /> : null}
              <View
                style={{
                  flex: 1,
                  backgroundColor: entry.color,
                  borderTopLeftRadius: entry.cap ? 0 : radius.pill,
                  borderTopRightRadius: entry.cap ? 0 : radius.pill,
                }}
              />
            </View>
            <Text style={[type.caption, { color: colors.muted }]}>{entry.label}</Text>
          </View>
        ))}
      </View>

      <View
        // Collapsed into one reading. Fourteen days announced column by column
        // is a minute of speech that tells nobody the shape of the fortnight.
        accessible
        accessibilityLabel={`Calories by day, ${data.length} ${data.length === 1 ? 'day' : 'days'}. Each day splits into junk and everything else, with burned beside it on the same scale. ${totalJunk === 0 ? 'No junk in this window.' : `${Math.round((totalJunk / totalEaten) * 100)} percent junk across the window.`} Tallest bar ${formatNumber(peak)} kcal.${goal !== null ? ` Daily target ${formatNumber(goal)} kcal.` : ''}`}
        style={{ gap: spacing.sm }}
      >
        <View style={{ flexDirection: 'row' }}>
          {/* The y axis: a label per gridline, in a gutter the x axis below
              mirrors so the two rows still divide the width identically. */}
          <View style={{ width: Y_GUTTER, height: CHART_HEIGHT }}>
            {gridlines.map((value) => (
              <Text
                key={`y-${value}`}
                style={[
                  type.caption,
                  {
                    position: 'absolute',
                    right: spacing.xs,
                    bottom: offsetOf(value) - type.caption.lineHeight / 2,
                    color: colors.muted,
                    fontVariant: ['tabular-nums'],
                  },
                ]}
              >
                {formatAxis(value)}
              </Text>
            ))}
          </View>
          <View style={{ flex: 1, height: CHART_HEIGHT }}>
            {/* Recessive gridlines, drawn first so every mark sits over them. */}
            {gridlines.map((value) => (
              <View
                key={`grid-${value}`}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: offsetOf(value),
                  height: layout.hairline,
                  backgroundColor: colors.border,
                }}
              />
            ))}
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
                    {/* The ink cap is the cue that does not depend on colour. On a
                        split day position already says which half is junk, but a
                        day that is all one or all the other is a lone bar, and junk
                        against everything else is only about 1.1:1 in luminance:
                        without the cap those two bars differ by hue alone. */}
                    {junkOf(entry) > 0 ? <JunkCap color={colors.text} /> : null}
                    {junkOf(entry) > 0 ? (
                      <View
                        style={{
                          height: heightOf(junkOf(entry)),
                          backgroundColor: half.junk,
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
                      backgroundColor: colors.muted,
                      borderTopLeftRadius: radius.pill,
                      borderTopRightRadius: radius.pill,
                    }}
                  />
                </View>
              ))}
            </View>

            {/* The target, as a reference line across every day. Thin and
                muted rather than in ink, so it reads as a line to measure
                against without outweighing the bars it supports, and
                labelled in place instead of in a separate legend row, so the
                line says what it is on its own. */}
            {goal !== null ? (
              <>
                <View
                  testID="calorie-target-line"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: offsetOf(goal),
                    borderTopWidth: TARGET_LINE,
                    borderStyle: 'dashed',
                    borderColor: colors.muted,
                  }}
                />
                <Text
                  style={[
                    type.caption,
                    {
                      position: 'absolute',
                      right: 0,
                      bottom: Math.min(offsetOf(goal) + 2, CHART_HEIGHT - 12),
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
        </View>

        {/* The axis, kept to a hairline. A grid heavy enough to read against is
            a grid competing with the marks. */}
        <View
          style={{ height: layout.hairline, backgroundColor: colors.border, marginLeft: Y_GUTTER }}
        />

        <View style={{ flexDirection: 'row', paddingLeft: Y_GUTTER }}>
          {chunks.map((chunk, index) => (
            <Text
              key={`tick-${chunk[0].day}-${index}`}
              // Deliberately no numberOfLines. A tick either fits or wraps; it
              // never truncates.
              //
              // A date rather than a weekday. Over fourteen days a weekday
              // name comes round twice, so "Fri" named two different bars and
              // said nothing about which. Each tick starts at the left edge of
              // the first bar it names, because the column it sits in is that
              // chunk's exact share of the width.
              style={[
                type.caption,
                { color: colors.muted, flex: chunk.length, paddingHorizontal: DAY_INSET },
              ]}
            >
              {formatDate(chunk[0].day)}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

/** The 2px ink line that sits on every junk segment, and on its legend swatch. */
function JunkCap({ color }: { color: string }) {
  return <View style={{ height: JUNK_CAP, backgroundColor: color }} />;
}

/**
 * A y scale with round gridlines, at most three of them above zero.
 *
 * Steps are 1, 2, 2.5 or 5 of a power of ten, so the labels read as numbers a
 * person would have picked ("500, 1,000, 1,500") rather than a third of the
 * tallest bar.
 */
export function scaleFor(max: number): { top: number; gridlines: number[] } {
  const safe = Math.max(1, max);
  const raw = safe / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((value) => value >= raw) ?? raw;
  // The top is exactly what the caller asked for, not rounded up to the next
  // step: a gridline at a round number is worth having, a ceiling pushed a
  // whole step past the data is not. The last gridline can land short of the
  // top, which is fine, since nothing requires one to sit at the very edge.
  const gridlines: number[] = [];
  for (let value = step; value < safe; value += step) gridlines.push(value);
  return { top: safe, gridlines };
}

/** "1,500", or "2k" once the figure is a round thousand and the gutter is narrow. */
function formatAxis(value: number): string {
  return value >= 1000 && value % 1000 === 0 ? `${value / 1000}k` : formatNumber(value);
}
