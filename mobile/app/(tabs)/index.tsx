import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, Text, View, useWindowDimensions } from 'react-native';

import { BurnDialog } from '../../components/BurnDialog';
import { CalorieBars } from '../../components/CalorieBars';
import {
  Button,
  Card,
  ErrorState,
  Hero,
  HeroWash,
  ListGroup,
  ListRow,
  Ring,
  Screen,
  Skeleton,
  SkeletonCard,
  SkeletonText,
} from '../../components/ui';
import { useMe } from '../../hooks/useAuth';
import { useDashboard, useTrend } from '../../hooks/useInsights';
import { describeError } from '../../lib/api';
import { formatNumber, formatRatio } from '../../lib/format';
import type { Today } from '../../lib/types';
import { useLayout, useTheme } from '../../theme';

/**
 * The dashboard: how today is going.
 *
 * Today's net calories against the daily target, as a hero figure inside a
 * ring, is the one thing this screen answers. Everything under it is a full
 * step quieter on the type scale and sits on a card, which the hero does not.
 * The ways onward (the plan, then the map) are rows in one group directly
 * under the hero; the fortnight chart and the month trend keep a card each
 * below them. Period totals, top categories and the like are reference
 * rather than an answer to "how is today going", so they live elsewhere --
 * the junk ratio survives as a row in the trend card, where a month-long
 * figure belongs.
 */

/** The ring at its full size, clamped on a narrow phone so it never overhangs. */
const RING_SIZE = 240;


/**
 * Everything the hero says, worked out in one place.
 *
 * The figure, the words beneath it and the sentence naming what the ring is
 * measuring all have to agree. Split across three call sites, this is where a
 * ring ends up measuring net while the line under it describes what was eaten,
 * and the reader has no way to tell which one is lying.
 */
function readToday(today: Today) {
  // Zero can be stored now that the floor is 0 rather than 800, and it is the
  // one value a meter cannot express: there is nothing to be a fraction of, and
  // every reading would be infinitely over. So any non-positive target reads as
  // no target here, which is the same thing the ring does with it, and the
  // screen falls back to the plain figure for the day.
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

  // The ring's own key, one short line under it. It used to be a full
  // sentence explaining net calories, under a status line, under a figure: three
  // readings of one question. With "left" as the figure, this only has to say
  // which number the ring is measuring, which section 9 still requires.
  const measures =
    target === null
      ? 'No daily target yet, so there is nothing to measure this against.'
      : `${formatNumber(today.net)} net of ${formatNumber(target)} kcal target`;

  // What the ring itself announces, once, rather than leaving a screen
  // reader to stitch the figure, the status line and the caption together
  // from three separately focusable pieces the ring's own accessible={true}
  // is about to collapse out of the focus order.
  const accessibilityLabel =
    target === null
      ? `${formatNumber(today.net)} kcal today. No daily target set.`
      : `Net calories: ${formatNumber(today.net)} of ${formatNumber(target)} kcal target. ${status}.`;

  return {
    target,
    over,
    status,
    measures,
    accessibilityLabel,
    // What is left is the hero, because it is the number someone opens the app
    // to see. Past the target it is how far past, and the caption says "over"
    // in words so the colour is never the only carrier. With no target there
    // is nothing to be left of, so the day's own figure stands in.
    figure:
      remaining === null ? formatNumber(today.net) : formatNumber(Math.abs(remaining)),
    caption: remaining === null ? 'kcal today' : over ? 'kcal over' : 'kcal left',
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
 * What the dashboard looks like before `data` has answered.
 *
 * Same wash, same ring size, same two cards below it -- a silent promise
 * about the layout rather than a spinner in the middle of an otherwise
 * blank screen, so landing the real response moves nothing. See
 * components/ui/Skeleton.tsx for why this exists instead of Loading here.
 */
function DashboardSkeleton() {
  const { spacing } = useTheme();

  return (
    <>
      <HeroWash pullUp={false}>
        <View style={{ alignItems: 'center', gap: spacing.xl, paddingBottom: spacing.xxxl }}>
          <Skeleton width={RING_SIZE} height={RING_SIZE} radius={RING_SIZE / 2} />
          <View style={{ alignItems: 'center', gap: spacing.sm }}>
            <SkeletonText width={140} fontSize={21} />
            <SkeletonText width={220} fontSize={16} />
          </View>
        </View>
      </HeroWash>

      <View style={{ gap: spacing.xxl }}>
        <SkeletonCard rows={3} />
        <SkeletonCard rows={4} />
      </View>
    </>
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
    /**
     * The warm field the rest of the app already had and this screen did not.
     *
     * HeroWash exists precisely for "the one number a screen leads with", and it
     * was used on the welcome screen and on a meal with no photo while the
     * dashboard, the screen with the largest hero in the app and the first one
     * anyone opens, sat on flat background. That is most of why the screen read
     * as grey: above the fold it painted thirteen things and exactly one of them
     * carried any colour at all.
     *
     * pullUp is off here. The wash normally reclaims the gutter above it, which
     * is right under a header; this screen has no header, so the only thing
     * above is the safe area inset and pulling up would put the ring under the
     * status bar on a notched phone.
     *
     * The wash brings its own vertical padding, so the 48 that used to sit above
     * the hero is gone and only the 48 below it remains. Two paddings stacked
     * would push the chart off the first screenful.
     */
    <HeroWash pullUp={false}>
      <View
        style={{
          alignItems: 'center',
          gap: spacing.xl,
          // 48 below. Nothing else on this screen gets more than 32.
          paddingBottom: spacing.xxxl,
        }}
      >
        {/* No target means no ring: a meter with no limit is a circle with
            nothing to fill, so the number stands on its own instead. */}
        {reading.target === null ? (
          figure
        ) : (
          <Ring
            value={today.net}
            max={reading.target}
            size={size}
            accessibilityLabel={reading.accessibilityLabel}
          >
            {figure}
          </Ring>
        )}

        <Text style={[type.caption, { color: colors.muted, textAlign: 'center' }]}>
          {reading.measures}
        </Text>

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
    </HeroWash>
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

/** Meals logged per day of the period, to one decimal place. */
function mealsPerDay(period: { meals_logged: number; days_counted: number }): number {
  if (period.days_counted <= 0) return 0;
  return Math.round((period.meals_logged / period.days_counted) * 10) / 10;
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
  // own days_counted, which the server sends for exactly this, so the two
  // figures cover equal footing whatever the date.
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
                ? `Daily averages from the ${formatNumber(now.days_counted)} ${now.days_counted === 1 ? 'day' : 'days'} of ${thisName} so far and all ${formatNumber(before.days_counted)} of ${lastName}.`
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
  const { colors, layout, spacing, type } = useTheme();
  const { isExpanded } = useLayout();
  const router = useRouter();
  const dashboard = useDashboard();
  // Held here rather than inside the card so a pull to refresh reloads both.
  const trend = useTrend();
  const me = useMe();

  const data = dashboard.data;

  // Burned calories can be entered before any meal is, so an untouched account
  // is one with neither, not merely one without logs.
  const hasAnything = data ? data.logs_count > 0 || data.total_burned > 0 : false;

  /*
   * The ways onward from here, as rows in one group rather than headlines.
   *
   * Two now, the plan first. The diary row is gone: Diary is a tab one tap
   * away in the bar under this screen, so a row here was a second, longer
   * route to the same place, and it pushed the plan further down.
   *
   * Each carries the glyph its destination owns elsewhere, and both carry one,
   * because ListRow lays the icon out as a sibling of the text column and a
   * bare row would start its label further left than its neighbour.
   */
  const destinations = (
    <ListGroup>
      <ListRow
        icon="plan"
        label="AI meal plan"
        // Three, because that is what the plan prompt asks for and what the
        // plan screen draws. This said "a week" and the plan never was.
        hint="Three days of meals shaped around your goal."
        onPress={() => router.push('/plan')}
      />
      <ListRow
        icon="map"
        label="Map"
        hint="Where you eat, grouped by area."
        onPress={() => router.push('/map')}
        last
      />
    </ListGroup>
  );

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
      <View
        style={{
          width: '100%',
          // Widened only at the one breakpoint with room for two real
          // content columns side by side, each still individually capped
          // below rather than left to stretch across half a wide window.
          maxWidth: isExpanded ? layout.contentWidth * 1.75 : layout.contentWidth,
          alignSelf: 'center',
        }}
      >
        {/* Only a password account can be unverified at all -- a Google row is
            verified the moment it exists -- and only until the link in the
            registration email is clicked, so this disappears for most
            accounts within minutes and isn't something the empty/loading
            states above need to make room for. Placed above everything else
            on purpose: the whole reason this matters is the account itself,
            which outranks today's number. */}
        {me.data?.email_verified === false ? (
          <Pressable
            onPress={() => router.navigate({ pathname: '/check-email', params: { email: me.data!.email } })}
            style={{
              backgroundColor: colors.dangerSoft,
              borderRadius: 12,
              padding: spacing.md,
              marginBottom: spacing.md,
            }}
          >
            <Text style={[type.caption, { color: colors.text }]}>
              Verify your email to keep your account secure. Tap to resend the link.
            </Text>
          </Pressable>
        ) : null}

        {dashboard.isLoading ? <DashboardSkeleton /> : null}

        {dashboard.isError && !data ? (
          <ErrorState
            title="Dashboard unavailable"
            message={describeError(dashboard.error)}
            onRetry={() => void dashboard.refetch()}
          />
        ) : null}

        {/* Nothing logged anywhere is an invitation, not a ring reading zero.
            No hero here on purpose: there is no focal value yet. */}
        {/* The first minute of a new account, and it used to be a dashed box.
            That box was the only thing a stranger saw on the screen this app is
            built around: the wash, the ring and the 64pt figure, which are the
            whole visual identity, did not appear until a meal existed. So the
            one state every user passes through showed none of the design.

            The wash and one sentence, which is what this needed, and nothing
            larger. `title` rather than `display`: an empty screen has no focal
            value, so nothing on it earns a size that competes with the figure
            this screen exists to show, and dashboard.test.tsx pins that as a
            rule rather than a preference. The words are unchanged. */}
        {data && !hasAnything ? (
          <>
            <HeroWash pullUp={false}>
              <View style={{ gap: spacing.md, paddingBottom: spacing.xl }}>
                <Text style={[type.title, { color: colors.text }]}>Nothing to count yet</Text>
                <Text style={[type.body, { color: colors.muted }]}>
                  Log one meal and this page starts answering how your day is going.
                </Text>
              </View>
            </HeroWash>

            <Button
              label="Log your first meal"
              icon="log"
              size="lg"
              full
              onPress={() => router.navigate('/log')}
            />
          </>
        ) : null}

        {data && hasAnything ? (
          // Row only at expanded: a small tablet in portrait (medium) still
          // has less width than two genuinely readable columns need, so it
          // keeps the single stacked column exactly as before. At expanded
          // each side gets its own flex share of the widened container above.
          <View
            style={
              isExpanded
                ? { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xxl }
                : undefined
            }
          >
            <View style={isExpanded ? { flex: 1 } : undefined}>
              <TodayHero
                today={data.today}
                onSetTarget={() => router.navigate('/profile')}
                onEditBurn={() => setBurnOpen(true)}
              />
            </View>

            <View style={[{ gap: spacing.xxl }, isExpanded ? { flex: 1 } : null]}>
              {/* Directly under the hero rather than after the chart and the
                  trend. The plan is the feature the app leads with, and at the
                  foot of the third screenful hardly anyone reached it. */}
              {destinations}

              <Card>
                <View style={{ gap: spacing.lg }}>
                  <Text style={[type.title, { color: colors.text }]}>Calories by day</Text>
                  <CalorieBars data={data.calories_by_day ?? []} target={data.today.target} />
                </View>
              </Card>

              <TrendCard trend={trend} />
            </View>
          </View>
        ) : null}

        {/* Before a first meal there is no chart or trend to sit above, so the
            ways onward stay where they always were, under everything. */}
        {data && hasAnything ? null : <View style={{ paddingTop: spacing.xxl }}>{destinations}</View>}
      </View>

      <BurnDialog visible={burnOpen} onDismiss={() => setBurnOpen(false)} />
    </Screen>
  );
}
