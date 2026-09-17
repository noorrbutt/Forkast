import { Text, View } from 'react-native';

import { formatNumber, shortDay } from '../lib/format';
import type { CaloriesByDay } from '../lib/types';
import { useTheme } from '../theme';

const CHART_HEIGHT = 120;

/**
 * Section 9: a 2px surface gap between adjacent fills so they never merge.
 * Eaten and burned sit side by side inside one day, and without this the two
 * read as a single taller bar on a phone.
 */
const SERIES_GAP = 2;

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
 * Two series, eaten and burned, one day per column.
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
  const { colors, layout, radius, spacing, type } = useTheme();

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

  const series = [
    { key: 'eaten', label: 'Eaten', color: colors.accentFill },
    // Not success and not danger: both are reserved states in this palette and
    // neither may be a series colour. outline is the one remaining token held
    // at 3:1 against the card, so a grey mark is visible without borrowing a
    // meaning it does not have.
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
        accessibilityLabel={`Calories by day, ${data.length} ${data.length === 1 ? 'day' : 'days'}. Each day splits into junk and everything else, with burned beside it on the same scale. Tallest bar ${formatNumber(peak)} kcal.`}
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
              <View
                style={{
                  flex: 1,
                  height: heightOf(entry.calories ?? 0),
                  backgroundColor: colors.accentFill,
                  borderTopLeftRadius: radius.pill,
                  borderTopRightRadius: radius.pill,
                }}
              />
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
