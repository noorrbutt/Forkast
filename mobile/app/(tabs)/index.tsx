import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, Text, View, useWindowDimensions } from 'react-native';

import { BurnDialog } from '../../components/BurnDialog';
import { CalorieBars } from '../../components/CalorieBars';
import {
  Button,
  Card,
  Empty,
  ErrorState,
  Hero,
  ListGroup,
  ListRow,
  Loading,
  Ring,
  Screen,
} from '../../components/ui';
import { useDashboard, useTrend } from '../../hooks/useInsights';
import { describeError } from '../../lib/api';
import { formatNumber, formatRatio } from '../../lib/format';
import type { Today } from '../../lib/types';
import { useTheme } from '../../theme';

/**
 * The dashboard.
 *
 * THE ONE THING: today's net calories against the daily target, as a hero
 * figure inside a ring meter. Everything under it is quieter by a full step of
 * the type scale and lives on a card, which the hero does not.
 *
 * Section 13 critique of what this replaced.
 *
 * 1. What it was. A vertical stack of eleven cards and four stat tiles, every
 *    one of them at radius 28, padding 24 and a 1pt border, each introduced by
 *    an 11px uppercase letterspaced label with an icon beside it.
 *
 * 2. Which rules it broke.
 *    - Section 6: eleven Card elements on a screen that mixes a headline stat
 *      with secondary data. The ceiling is six and the rule says a dashboard is
 *      never one uniform stack.
 *    - Section 4 and Section 2 contrast: the largest thing on the screen was
 *      `display` at 48, spent on a period total, and `hero` at 64 was never
 *      used. There was no gap at all between the first and second elements, so
 *      nothing was dominant and a stranger could not name the one thing.
 *    - Section 9: the one ratio against a limit was drawn as a 14px bar, the
 *      same weight as everything else on the screen, while 48pt was spent on a
 *      number that is not the question this screen answers.
 *    - Section 10: an icon beside all ten section headings, via the local
 *      IconLabel helper.
 *    - Section 4: `SectionLabel`, the 11px uppercase eyebrow, above ten blocks
 *      plus the page itself.
 *    - Section 5: every gap in the scroll was `lg`, 16, so nothing had more air
 *      than anything else and `xxxl` was unspent.
 *    - Section 7: four stat tiles in two equal rows and three equal nav cards.
 *      Equal weight everywhere, which is the failure mode the guide exists to
 *      prevent.
 *    - Section 11: seven sections wrapped in a staggered fade and lift on mount.
 *    - Section 8 and 9: the chart drew one series and silently dropped the
 *      `burned` figure that is in the same payload, carried no legend, and
 *      labelled its axis in the 11px uppercase style.
 *
 * 3. What the one thing is now. Today's net calories against the daily target,
 *    as a hero figure inside a ring, with 48 of space above and below it and
 *    nothing else on the screen above 34.
 *
 * 4. What was demoted, and what was cut.
 *    Demoted: the fortnight chart, the month against month trend and the three
 *    navigation cards. The chart and the trend keep a card each and drop to
 *    `title` and `subtitle`; the nav cards become three rows in one group,
 *    because three destinations are a list and not three headlines.
 *    Cut: the period total card, which was a second hero at 48 reporting a
 *    window this screen does not ask about; the junk ratio, meals logged and
 *    burned stat tiles; the top category and top spot tiles; the burn
 *    equivalents, which restate a number already on screen in minutes; and the
 *    most fun meals list. All of them are reference rather than an answer to
 *    "how is today going", and a reader who wants them is asking a different
 *    question on a different screen. The junk ratio survives as a row in the
 *    trend card, which is where a month long figure belongs.
 */

/** The ring at its full size, clamped on a narrow phone so it never overhangs. */
const RING_SIZE = 240;

/** One content column, capped so a tablet does not stretch it into a banner. */
const CONTENT_MAX = 560;

/**
 * Everything the hero says, worked out in one place.
 *
 * The figure, the words beneath it and the sentence naming what the ring is
 * measuring all have to agree. Split across three call sites, this is where a
 * ring ends up measuring net while the line under it describes what was eaten,
 * and the reader has no way to tell which one is lying.
 */
function readToday(today: Today) {
  // A zero target cannot be stored and dividing by one would produce nothing
  // readable, so anything that is not a positive number reads as no target.
  const target =
    today.target !== null && Number.isFinite(today.target) && today.target > 0
      ? today.target
      : null;

  const remaining = target === null ? null : target - today.net;
  const over = remaining !== null && remaining < 0;

  // Word for word what the progress bar says elsewhere in the app, because one
  // action and one state keep one name through the whole product.
  const status =
    remaining === null
      ? null
      : over
        ? `Over by ${formatNumber(-remaining)} kcal`
        : remaining === 0
          ? 'Right on target, 0 kcal left'
          : `${formatNumber(remaining)} kcal left`;

  const measures =
    target === null
      ? 'No daily target yet, so there is nothing to measure this against.'
      : today.burned > 0
        ? 'The ring measures net calories, what you ate less what you burned, against your daily target.'
        : 'The ring measures net calories against your daily target. Nothing burned logged today, so net is what you ate.';

  return {
    target,
    over,
    status,
    measures,
    figure: formatNumber(today.net),
    caption: target === null ? 'kcal today' : `of ${formatNumber(target)} kcal today`,
  };
}

/**
 * One of the two numbers the hero is made of.
 *
 * `displaySm` rather than `numeral` so the second level of the hierarchy is a
 * full step under the hero and a full step over everything below it.
 */
function Supporting({
  value,
  caption,
  onPress,
}: {
  value: string;
  caption: string;
  onPress?: () => void;
}) {
  const { colors, spacing, type } = useTheme();

  const body = (
    <>
      <Text style={[type.displaySm, { color: colors.text }]}>{value}</Text>
      <Text style={[type.caption, { color: colors.muted, textAlign: 'center' }]}>{caption}</Text>
    </>
  );

  if (!onPress) {
    return <View style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}>{body}</View>;
  }

  // The figure is the control. A dashboard shows what is true; asking for a
  // number belongs behind a tap, not in a form parked on the screen.
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${caption}`}
      accessibilityHint="Opens a box to change what you burned today"
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: spacing.xs,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {body}
    </Pressable>
  );
}

/**
 * The focal block: the ring, the words, and the two numbers the ring is made of.
 *
 * The only thing on the screen that gets `xxxl`, and the only thing that is not
 * on a card. That reservation is what makes it read as the hero before its size
 * is even considered.
 */
function TodayHero({
  today,
  onSetTarget,
  onEditBurn,
}: {
  today: Today;
  onSetTarget: () => void;
  onEditBurn: () => void;
}) {
  const { colors, layout, spacing, type } = useTheme();
  const { width } = useWindowDimensions();
  const reading = readToday(today);

  const size = Math.min(RING_SIZE, width - layout.screenPadding * 2);

  const figure = (
    <Hero
      value={reading.figure}
      caption={reading.caption}
      color={reading.over ? colors.danger : undefined}
      align="center"
    />
  );

  return (
    <View
      style={{
        alignItems: 'center',
        gap: spacing.xl,
        // 48 above and below. Nothing else on this screen gets more than 32.
        paddingTop: spacing.xxl,
        paddingBottom: spacing.xxxl,
      }}
    >
      {/* No target means no ring: a meter with no limit is a circle with
          nothing to fill, so the number stands on its own instead. */}
      {reading.target === null ? (
        figure
      ) : (
        <Ring value={today.net} max={reading.target} size={size}>
          {figure}
        </Ring>
      )}

      <View style={{ alignItems: 'center', gap: spacing.xs }}>
        {reading.status ? (
          <Text
            style={[type.title, { color: reading.over ? colors.danger : colors.text }]}
          >
            {reading.status}
          </Text>
        ) : null}
        <Text style={[type.caption, { color: colors.muted, textAlign: 'center' }]}>
          {reading.measures}
        </Text>
      </View>

      {/* Centred, because everything above it in this block is: the ring, the
          status line and the caption all sit on the column's centre line, and a
          left aligned button under them broke that axis at the one point the
          eye is already travelling down it. */}
      {reading.target === null ? (
        <Button
          label="Set a daily target"
          variant="secondary"
          align="center"
          onPress={onSetTarget}
        />
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
        <Supporting value={formatNumber(today.consumed)} caption="kcal eaten" />
        <View
          style={{
            width: layout.hairline,
            alignSelf: 'stretch',
            backgroundColor: colors.border,
          }}
        />
        <Supporting
            value={formatNumber(today.burned)}
            caption="kcal burned"
            onPress={onEditBurn}
          />
      </View>
    </View>
  );
}

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
 * This calendar month against the last one.
 *
 * Third level and drawn like it. The figures used to sit at `numeral`, 26,
 * which put a month long total within a hair of the two numbers the hero is
 * made of. They are `subtitle` now and carry their weight rather than their
 * size.
 */
function TrendCard({ trend }: { trend: ReturnType<typeof useTrend> }) {
  const { colors, spacing, type } = useTheme();
  const data = trend.data;

  if (trend.isLoading) {
    return (
      <Card>
        <Loading label="Comparing your months" fill={false} />
      </Card>
    );
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

  const rows = [
    {
      label: 'Calories',
      value: formatNumber(now.total_calories),
      change: describeChange(data.change.total_calories, 'kcal', lastName),
    },
    {
      label: 'Meals',
      value: formatNumber(now.meals_logged),
      change: describeChange(
        data.change.meals_logged,
        Math.abs(data.change.meals_logged) === 1 ? 'meal' : 'meals',
        lastName
      ),
    },
    {
      label: 'Junk ratio',
      value: formatRatio(now.junk_ratio),
      // Points taken from the two percentages that actually get printed, so the
      // direction can never disagree with the number sitting beside it.
      change: describeChange(
        Math.round(now.junk_ratio * 100) - Math.round(before.junk_ratio * 100),
        'points',
        lastName
      ),
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
                  {comparable ? (
                    <Text style={[type.caption, { color: colors.muted }]}>{row.change}</Text>
                  ) : null}
                </View>
                {/* Right aligned so three figures in a column can be compared. */}
                <Text style={[type.subtitle, { color: colors.text, textAlign: 'right' }]}>
                  {row.value}
                </Text>
              </View>
            ))}

            <Text style={[type.caption, { color: colors.muted }]}>
              {comparable
                ? `Counting ${formatNumber(now.days_counted)} ${now.days_counted === 1 ? 'day' : 'days'} of ${thisName} against all of ${lastName}.`
                : `Nothing logged in ${lastName}, so there is nothing to compare against. Next month this fills in.`}
            </Text>
          </>
        )}
      </View>
    </Card>
  );
}

export default function DashboardScreen() {
  // Burned is asked for, never parked on the screen as a form.
  const [burnOpen, setBurnOpen] = useState(false);
  const { colors, spacing, type } = useTheme();
  const router = useRouter();
  const dashboard = useDashboard();
  // Held here rather than inside the card so a pull to refresh reloads both.
  const trend = useTrend();

  const data = dashboard.data;

  // Burned calories can be entered before any meal is, so an untouched account
  // is one with neither, not merely one without logs.
  const hasAnything = data ? data.logs_count > 0 || data.total_burned > 0 : false;

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching || trend.isRefetching}
          onRefresh={() => void Promise.all([dashboard.refetch(), trend.refetch()])}
          tintColor={colors.accent}
        />
      }
    >
      <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' }}>
        {dashboard.isLoading ? <Loading label="Reading your day" /> : null}

        {dashboard.isError && !data ? (
          <ErrorState
            title="Dashboard unavailable"
            message={describeError(dashboard.error)}
            onRetry={() => void dashboard.refetch()}
          />
        ) : null}

        {/* Nothing logged anywhere is an invitation, not a ring reading zero.
            No hero here on purpose: there is no focal value yet. */}
        {data && !hasAnything ? (
          <View style={{ paddingTop: spacing.xxl, paddingBottom: spacing.xxl }}>
            <Empty
              icon="chart"
              title="Nothing to count yet"
              message="Log one meal and this page starts answering how your day is going."
              actionLabel="Log your first meal"
              actionIcon="log"
              onAction={() => router.navigate('/log')}
            />
          </View>
        ) : null}

        {data && hasAnything ? (
          <>
            <TodayHero
              today={data.today}
              onSetTarget={() => router.navigate('/profile')}
              onEditBurn={() => setBurnOpen(true)}
            />

            <View style={{ gap: spacing.xxl }}>
              {/* The one action on this screen that changes the hero, so it
                  sits directly under it rather than below the reference. */}

              <Card>
                <View style={{ gap: spacing.lg }}>
                  <Text style={[type.title, { color: colors.text }]}>Calories by day</Text>
                  <CalorieBars data={data.calories_by_day ?? []} />
                </View>
              </Card>

              <TrendCard trend={trend} />
            </View>
          </>
        ) : null}

        {/* Three destinations are a list, not three headlines. One surface, one
            left edge, no eyebrow above it, and a 56pt row apiece. */}
        <View style={{ paddingTop: spacing.xxl }}>
          <ListGroup>
            <ListRow
              label="Your diary"
              hint="Past meals, with a typo to fix or a double log to delete."
              onPress={() => router.push('/history')}
            />
            <ListRow
              label="Map"
              hint="Where you eat, grouped by area."
              onPress={() => router.push('/map')}
            />
            <ListRow
              label="AI meal plan"
              hint="A week of suggestions shaped around your goal."
              onPress={() => router.push('/plan')}
              last
            />
          </ListGroup>
        </View>
      </View>

      <BurnDialog visible={burnOpen} onDismiss={() => setBurnOpen(false)} />
    </Screen>
  );
}
