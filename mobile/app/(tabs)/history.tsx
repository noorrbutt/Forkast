import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button, Dialog, Empty, ErrorState, EstimateBadge, FormError, Icon, initialsOf, ListGroup, Loading, Screen, useScreenInsets } from '../../components/ui';
import { useInfiniteLogs, useRepeatLog } from '../../hooks/useLogs';
import { usePhotoSource } from '../../hooks/usePhoto';
import { describeError } from '../../lib/api';
import { SERVING_LABELS, formatNumber } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import type { FoodLog, Uuid } from '../../lib/types';
import { useTheme } from '../../theme';
import { quick } from '../../theme/motion';
import { elevation } from '../../theme/tokens';

/**
 * The diary.
 *
 * THE ONE THING: the newest meal, at the head of a single column, carried by
 * its own photo. There is deliberately no hero figure here, and that is the
 * whole argument of this file.
 *
 * Why this screen is a list and must stay one. Section 6 says lead with a focal
 * element when the screen answers a single question, and use a list when the
 * items are genuinely repetitive and of equal weight. A diary is the second
 * case by definition: every meal is one meal, the twentieth is worth exactly
 * what the first is, and nothing in the payload ranks them. Promoting one to a
 * hero would invent a hierarchy the content does not have, and it would push
 * the rest below the fold to make room for a number nobody asked this screen
 * for. The guide names a diary of past meals as a list in so many words. So the
 * work here was never to find a hero. It was to stop the rows being a hundred
 * identical cards and make the column readable down its length.
 *
 * Section 13 critique of what this replaced.
 *
 * 1. What it was. One Card per meal, up to a hundred of them, every one at
 *    radius 28, padding 24 and a 1pt border, each carrying its own date
 *    heading, a dish name at `title`, a calorie figure at `numeral` in accent,
 *    a chevron, a meta line and a button row.
 *
 * 2. Which rules it broke.
 *    - Section 6: a hundred cards against a ceiling of six. A card exists to
 *      give a group its own surface, and one meal is a row, not a group. The
 *      repetition was real but the container was wrong, which is what made a
 *      legitimate list read as a stack.
 *    - Section 5 proximity: the date sat inside the card with its meal at a gap
 *      of `xs`, so five meals over two days printed a date five times and
 *      grouped nothing. The gap inside the group equalled the gap around it, so
 *      the grouping said nothing.
 *    - Section 2 contrast: the dish name at 21 and the calorie figure at 26 sat
 *      adjacent, with the smaller of the two carrying the name. The number was
 *      the loudest thing on every row and the only accent coloured thing on the
 *      screen, so a hundred meals read as a column of orange numerals.
 *    - Section 3 and Section 14: `numberOfLines={1}` on both the dish name and
 *      the meta line, so any dish or restaurant past roughly twenty characters
 *      was cut rather than wrapped.
 *    - Section 10: the user's own photos are the only images this app has, and
 *      the diary did not show them at all, although `has_photo` arrives on
 *      every row of the payload already.
 *
 * 3. What the one thing is now. The newest meal row, at the top of one column,
 *    with its photo beside it. Below it the rows repeat identically, which is
 *    what the guide asks for when two things genuinely are equal.
 *
 * 4. What was demoted, and why that is correct. The calorie figure drops from
 *    `numeral` in accent to `body` in ink, right aligned in a shared column: it
 *    is there to be compared down the page rather than read as a headline, and
 *    alignment does that job better than size ever did. The date leaves the row
 *    and becomes one quiet heading per day, which is also where the day's total
 *    now lives, so the repetition buys something. The cards are gone: a day is
 *    one surface with hairlines between its meals, so the screen holds one
 *    surface per day rather than one per meal.
 *
 * 5. The one exception to "every row is equal weight", and why it is not one.
 *    A meal WITH a photo now renders as a full width photo card instead of the
 *    compact row, taller than its neighbours. That is not a rank between
 *    meals -- the guide's argument in section 3 above still holds, and a
 *    photoless meal is not treated as lesser content. It is a rank between
 *    the two things a row can be MADE OF: a photograph is the one piece of
 *    genuinely rich content this app has anywhere, thumbnail-sized it was
 *    being thrown away, and letting it stay small was the actual default no
 *    one had decided on. The list is still one column of meals in the order
 *    they happened; it is only the row's own height that now follows what it
 *    has to show, which FlatList already handles per item without any of the
 *    fixed-height assumptions a `getItemLayout` would have needed.
 */

/** How long the confirmation stays on a row before the row goes quiet again. */
const CONFIRMED_MS = 4000;

/** The photo, square, large enough to recognise a dish and no larger. Used
 * only by the compact, photoless row; a meal with a photo gets the full width
 * card below instead. */
const THUMB = 64;

/**
 * The width the calorie figures share.
 *
 * A minimum rather than a fixed width. The point of the column is that 820 and
 * 1,240 line up on their right edges and can be read down the page, and this is
 * wide enough for every figure the server will store; a pinned width would make
 * an outlier wrap onto two lines at large system text sizes instead.
 */
const CALORIES = 64;

/** Inlined so the photo card does not pull in StyleSheet for one constant;
 * `absoluteFill` exists as a style id but not as a typed plain object on
 * this RN version, so this is the literal it resolves to. */
const ABSOLUTE_FILL = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};


type DiaryDay = {
  key: string;
  heading: string;
  total: number;
  meals: FoodLog[];
};

/**
 * Which local day a timestamp belongs to.
 *
 * Built from the local parts rather than from toISOString, which would file a
 * late dinner under tomorrow for anyone east of Greenwich and split one evening
 * across two headings.
 */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayHeading(date: Date, now: Date): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(yesterday)) return 'Yesterday';

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  };
  // The year only earns its place once the meal is not from this one.
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('en-US', options);
}

/**
 * The flat newest first list, cut into days.
 *
 * Encounter order is kept rather than sorted, so the server stays the one thing
 * deciding what order meals are read in.
 */
function groupByDay(items: FoodLog[], now: Date): DiaryDay[] {
  const days: DiaryDay[] = [];
  const byKey = new Map<string, DiaryDay>();

  for (const log of items) {
    const parsed = new Date(log.created_at);
    const readable = !Number.isNaN(parsed.getTime());
    // A timestamp this cannot read still belongs somewhere, so it gets its own
    // group under whatever the server sent rather than being dropped.
    const key = readable ? dayKey(parsed) : `unparsed:${log.created_at}`;

    let day = byKey.get(key);
    if (!day) {
      day = {
        key,
        heading: readable ? dayHeading(parsed, now) : log.created_at,
        total: 0,
        meals: [],
      };
      byKey.set(key, day);
      days.push(day);
    }

    day.meals.push(log);
    day.total += log.estimated_calories;
  }

  return days;
}

type MealRowProps = {
  log: FoodLog;
  /** Drops the divider, so the last row in a day does not draw a line to nothing. */
  last: boolean;
  /**
   * Both take the id rather than closing over it.
   *
   * The screen used to hand each row `() => router.push(...)` and
   * `() => logAgain(log.id)`, built fresh on every render, which meant a
   * memoised row would still see two new props every time and re-render
   * anyway. Taking the id lets the parent keep one stable function for the
   * whole list.
   */
  onOpen: (id: Uuid) => void;
  onRepeat: (id: Uuid) => void;
  sending: boolean;
  confirmed: boolean;
  error: string | null;
};

/** How long the "Refined" tag stays up after a number changes underneath it. */
const REFINED_TAG_MS = 4000;

/**
 * True for one brief window: the render where a log's number just changed
 * because its background refinement landed, or the response to Log again
 * came back photo-priced and instantly refined.
 *
 * Compares against a ref rather than the previous props, because a memoised
 * row does not necessarily re-render on every parent pass -- React Query
 * swapping the cached log in is what has to be caught here, not a React
 * lifecycle event. Never true for a log that has always been refined (a
 * fresh mount with `refined: true` and nothing to compare against yet): the
 * point is to mark a change happening, not to claim credit for one that
 * happened before this row ever rendered.
 */
function useJustRefined(log: FoodLog): boolean {
  const previous = useRef<{ calories: number; refined: boolean } | null>(null);
  const [justRefined, setJustRefined] = useState(false);

  useEffect(() => {
    const prior = previous.current;
    previous.current = { calories: log.estimated_calories, refined: log.refined };
    if (
      prior &&
      !prior.refined &&
      log.refined &&
      prior.calories !== log.estimated_calories
    ) {
      setJustRefined(true);
      const timer = setTimeout(() => setJustRefined(false), REFINED_TAG_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [log.estimated_calories, log.refined]);

  return justRefined;
}

/**
 * The acknowledgement that a number just moved, instead of the silent swap
 * this replaced: `estimated_calories` used to change underneath whatever was
 * on screen the moment the background refinement landed, with nothing on the
 * row saying so.
 */
function RefinedTag() {
  const { colors, radius, spacing, type } = useTheme();
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, quick);
    return () => {
      opacity.value = 0;
    };
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessible
      accessibilityRole="text"
      accessibilityLabel="Estimate refined"
      style={[
        {
          alignSelf: 'flex-start',
          borderRadius: radius.pill,
          backgroundColor: colors.successSoft,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        style,
      ]}
    >
      <Text style={[type.caption, { color: colors.success }]}>Refined</Text>
    </Animated.View>
  );
}

/**
 * The row useCreateLog inserts the instant a meal is logged, before the
 * server has answered at all. Neutral rather than success or danger colouring
 * on purpose: this is not yet a fact about the meal, it is a fact about the
 * connection, and it clears itself the moment either resolves.
 */
function PendingBadge() {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel="Saving, will sync when back online"
      style={{
        alignSelf: 'flex-start',
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceAlt,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={[type.caption, { color: colors.muted }]}>Pending sync</Text>
    </View>
  );
}

/**
 * Log again, the confirmation and the error. Shared between both row shapes
 * because it is identical either way: repeating a meal is not a different
 * action depending on whether it has a photo.
 */
function MealActions({
  log,
  onRepeat,
  sending,
  confirmed,
  error,
}: Pick<MealRowProps, 'log' | 'onRepeat' | 'sending' | 'confirmed' | 'error'>) {
  const { colors, spacing, type } = useTheme();

  return (
    <View style={{ gap: spacing.sm }}>
      {/* Every row gets its own control rather than a swipe or a long press.
          The whole point of repeating is to skip the trip through the meal,
          and a gesture nobody can see is not a shortcut, it is a secret. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: spacing.md,
        }}
      >
        <Button
          // Deliberately never disabled, however much a spinner would suit
          // it. A disabled Pressable does not claim the touch, so the row
          // underneath would take the second tap and open the meal, which is
          // the one thing this button must not do. It stays live, absorbs the
          // tap, and the guard in the screen refuses the duplicate. The label
          // carries the state instead.
          label={sending ? 'Logging' : 'Log again'}
          variant="secondary"
          icon="log"
          onPress={() => onRepeat(log.id)}
          accessibilityHint={`Adds ${log.dish_name} to today, with the time you tap it`}
        />

        {confirmed ? (
          <Text style={[type.caption, { color: colors.success, flex: 1 }]}>
            Logged again for today.
          </Text>
        ) : null}
      </View>

      {error ? <FormError>{error}</FormError> : null}
    </View>
  );
}

/**
 * A meal with no photo. Compact: a monogram, the dish, the figure to compare,
 * the way in.
 */
function CompactMealRow({ log, last, onOpen, onRepeat, sending, confirmed, error }: MealRowProps) {
  const { colors, radius, spacing, type } = useTheme();
  const justRefined = useJustRefined(log);

  const meta = [
    log.category?.name,
    log.restaurant?.name ?? log.area,
    SERVING_LABELS[log.serving_size],
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      // No real id to open yet -- this row is the client_id, and the meal
      // it names does not exist on the server until the save settles.
      onPress={() => !log.pending && onOpen(log.id)}
      disabled={log.pending}
      accessibilityRole="button"
      accessibilityLabel={
        log.pending
          ? `${log.dish_name}, saving`
          : `${log.dish_name}, ${formatNumber(log.estimated_calories)} kcal`
      }
      accessibilityHint={log.pending ? undefined : 'Opens this meal'}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: spacing.lg,
        padding: spacing.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed && !log.pending ? colors.surfaceAlt : 'transparent',
        opacity: log.pending ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: THUMB,
          height: THUMB,
          borderRadius: radius.tile,
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Typographic, never a camera glyph in a grey box. A monogram is the
            same fallback the profile picture uses, so a missing image reads
            as a deliberate placeholder rather than as a failed load. */}
        <Text style={[type.title, { color: colors.muted }]}>{initialsOf(log.dish_name)}</Text>
      </View>

      <View style={{ flex: 1, gap: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
          {/* The primary line, and it wraps: a dish nobody can read is worse
              than a row two lines tall. */}
          <Text style={[type.subtitle, { color: colors.text, flex: 1 }]}>{log.dish_name}</Text>
          <Text
            style={[
              type.body,
              {
                color: colors.text,
                minWidth: CALORIES,
                textAlign: 'right',
                // Lining figures, so a column of digits stays a column. This
                // lives here rather than on the token because `body` is the
                // reading text token and sets prose everywhere else.
                fontVariant: ['tabular-nums'],
              },
            ]}
          >
            {formatNumber(log.estimated_calories)}
          </Text>
          {log.estimate_source === 'local' ? <EstimateBadge /> : null}
          {/* The row is the way in to the meal, which nothing else here says
              out loud -- except while pending, when there is nowhere to go yet. */}
          {log.pending ? null : <Icon name="forward" size={18} />}
        </View>

        {log.pending ? <PendingBadge /> : justRefined ? <RefinedTag /> : null}

        {meta ? <Text style={[type.caption, { color: colors.muted }]}>{meta}</Text> : null}

        {/* Repeating or acting on a meal that does not exist on the server
            yet has nothing to act on. */}
        {log.pending ? null : (
          <View style={{ marginTop: spacing.sm }}>
            <MealActions
              log={log}
              onRepeat={onRepeat}
              sending={sending}
              confirmed={confirmed}
              error={error}
            />
          </View>
        )}
      </View>
    </Pressable>
  );
}

/**
 * A meal WITH a photo. Full width, taller, the picture doing the work a
 * 64pt square never could: dish name, figure and meta sit over the bottom of
 * the image itself rather than beside a thumbnail of it.
 *
 * The gradient uses `colors.scrim`, the same token a modal backdrop sits on,
 * not a one-off value invented here: the job is identical, making whatever is
 * under a dark layer readable against it. What changes is what sits under it,
 * a photograph instead of a screen, so the white text on top is a fixed
 * value rather than a theme token -- a photo carries its own colours and
 * `colors.text`, tuned to sit on this app's own two backgrounds, has no
 * reason to be legible against someone's dinner.
 */
function PhotoMealRow({ log, last, onOpen, onRepeat, sending, confirmed, error }: MealRowProps) {
  const { colors, isDark, radius, spacing, type } = useTheme();
  const photo = usePhotoSource(log.id);
  const justRefined = useJustRefined(log);

  const meta = [
    log.category?.name,
    log.restaurant?.name ?? log.area,
    SERVING_LABELS[log.serving_size],
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={{ gap: spacing.md, paddingBottom: last ? 0 : spacing.lg }}>
      <Pressable
        onPress={() => onOpen(log.id)}
        accessibilityRole="button"
        accessibilityLabel={`${log.dish_name}, ${formatNumber(log.estimated_calories)} kcal`}
        accessibilityHint="Opens this meal"
        style={({ pressed }) => [
          {
            borderRadius: radius.card,
            overflow: 'hidden',
            backgroundColor: colors.surfaceAlt,
            opacity: pressed ? 0.92 : 1,
          },
          // Same primary-surface treatment Card reserves for prominent
          // content: this photo is the one piece of rich content the diary
          // has, so it gets the full radius and, on light, the shadow that
          // lifts it off the page.
          !isDark ? elevation.light : null,
        ]}
      >
        <View style={{ width: '100%', aspectRatio: 4 / 3 }}>
          {photo ? (
            <Image
              source={photo}
              style={ABSOLUTE_FILL}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ) : null}

          {/* Only over the lower part of the photo, not the whole frame: the
              food itself should read clearly, and the gradient exists solely
              to buy the two lines of text at the bottom their contrast. */}
          <LinearGradient
            colors={['transparent', colors.scrim]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            locations={[0.4, 1]}
            style={ABSOLUTE_FILL}
          />

          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: spacing.lg,
              gap: spacing.xs,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md }}>
              <Text
                style={[type.subtitle, { color: '#FFFFFF', flex: 1 }]}
                numberOfLines={2}
              >
                {log.dish_name}
              </Text>
              <Text
                style={[
                  type.body,
                  { color: '#FFFFFF', fontVariant: ['tabular-nums'] },
                ]}
              >
                {formatNumber(log.estimated_calories)}
              </Text>
            </View>
            {meta ? (
              <Text style={[type.caption, { color: 'rgba(255, 255, 255, 0.85)' }]}>{meta}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        {log.estimate_source === 'local' ? <EstimateBadge /> : null}
        {justRefined ? <RefinedTag /> : null}
        <MealActions
          log={log}
          onRepeat={onRepeat}
          sending={sending}
          confirmed={confirmed}
          error={error}
        />
      </View>
    </View>
  );
}

/** One meal, shaped by whether it has a photo. See section 5 of the note
 * above this file's rules. */
function MealRowBase(props: MealRowProps) {
  return props.log.has_photo ? <PhotoMealRow {...props} /> : <CompactMealRow {...props} />;
}

/**
 * Memoised, because the diary holds a hundred of these.
 *
 * Every row renders a Button, and Button allocates an animated value and an
 * animated style, so a hundred rows is a hundred of each. Nothing here was
 * memoised, so a single "Log again" tap re-rendered all hundred about four
 * times over: once when the mutation goes pending, once on success, once when
 * the acknowledgement is set, and once more four seconds later when it clears,
 * plus a pass when the refetch lands. That is the stutter after tapping.
 *
 * The props are all primitives, the log object, and two functions the screen
 * now keeps stable, so the default shallow comparison is enough and a custom
 * comparator would only be one more thing to get wrong.
 */
const MealRow = memo(MealRowBase);

/**
 * A day's meals, cut into runs of consecutive photoless meals and single
 * photo meals, in the order they happened.
 *
 * A photo card carries its own rounded corners and, on light, its own
 * shadow, which is the whole point of it. Sitting it inside ListGroup's
 * bordered, overflow-hidden box -- the compact row's surface -- would mean
 * nesting one card's chrome inside another's and clipping the photo card's
 * shadow at the group's edge. So only a run of compact rows gets a
 * ListGroup; a photo meal stands on its own between runs, which still
 * renders every meal in encounter order and still groups the ones that share
 * a surface, it just no longer forces every meal in a day onto one surface
 * regardless of what kind of row it is.
 */
type MealSegment =
  | { kind: 'group'; items: FoodLog[] }
  | { kind: 'photo'; item: FoodLog };

function segmentMeals(meals: FoodLog[]): MealSegment[] {
  const segments: MealSegment[] = [];
  for (const log of meals) {
    if (log.has_photo) {
      segments.push({ kind: 'photo', item: log });
      continue;
    }
    const current = segments[segments.length - 1];
    if (current?.kind === 'group') {
      current.items.push(log);
    } else {
      segments.push({ kind: 'group', items: [log] });
    }
  }
  return segments;
}

function DayGroup({
  day,
  onOpen,
  onRepeat,
  confirmed,
  repeat,
}: {
  day: DiaryDay;
  onOpen: (id: Uuid) => void;
  onRepeat: (id: Uuid) => void;
  confirmed: Uuid | null;
  repeat: ReturnType<typeof useRepeatLog>;
}) {
  const { colors, spacing, type } = useTheme();
  const segments = useMemo(() => segmentMeals(day.meals), [day.meals]);

  const rowProps = (log: FoodLog) => ({
    onOpen,
    onRepeat,
    sending: repeat.isPending && repeat.variables === log.id,
    confirmed: confirmed === log.id,
    error:
      repeat.isError && repeat.variables === log.id ? describeError(repeat.error) : null,
  });

  return (
    <View style={{ gap: spacing.sm }}>
      {/* The heading ListGroup used to print via its own `title` prop, moved
          out here now that a day can hold more than one surface: it names
          the day once, above all of them, rather than repeating per run or
          being unreachable for a day that opens on a photo. */}
      <Text style={[type.labelSoft, { color: colors.muted, paddingHorizontal: spacing.xs }]}>
        {`${day.heading} · ${formatNumber(day.total)} kcal`}
      </Text>

      <View style={{ gap: spacing.md }}>
        {segments.map((segment, index) =>
          segment.kind === 'photo' ? (
            <PhotoMealRow key={segment.item.id} log={segment.item} last {...rowProps(segment.item)} />
          ) : (
            <ListGroup key={`group-${index}`}>
              {segment.items.map((log, i) => (
                <MealRow
                  key={log.id}
                  log={log}
                  last={i === segment.items.length - 1}
                  {...rowProps(log)}
                />
              ))}
            </ListGroup>
          ),
        )}
      </View>
    </View>
  );
}

/**
 * The diary list.
 *
 * A component rather than inline JSX for one specific reason: it needs the
 * padding Screen would otherwise have applied, and Screen publishes that
 * through a context whose provider is inside Screen itself. Read from the
 * screen component, which is Screen's parent, the hook returns the default of
 * zero, the list starts underneath the frosted header, and the first day
 * heading is hidden behind it. Rendered here, as Screen's child, it is inside
 * the provider and gets the real value.
 */
function DiaryList({
  days,
  logs,
  loadMore,
  items,
  repeat,
  confirmed,
  onOpen,
  onRepeat,
  onLogFirst,
}: {
  days: DiaryDay[];
  logs: ReturnType<typeof useInfiniteLogs>;
  loadMore: () => void;
  items: FoodLog[];
  repeat: ReturnType<typeof useRepeatLog>;
  confirmed: Uuid | null;
  onOpen: (id: Uuid) => void;
  onRepeat: (id: Uuid) => void;
  onLogFirst: () => void;
}) {
  const { colors, layout, spacing, type } = useTheme();
  const screenInsets = useScreenInsets();

  return (
  <FlatList<DiaryDay>
    testID="diary"
    data={days}
    keyExtractor={(day) => day.key}
    refreshControl={
      <RefreshControl
        refreshing={logs.isRefetching && !logs.isFetchingNextPage}
        onRefresh={() => void logs.refetch()}
        tintColor={colors.accent}
      />
    }
    // The column cap lives on the content container, which is the one box
    // a list lets you centre.
    contentContainerStyle={{
      width: '100%',
      maxWidth: layout.contentWidth,
      alignSelf: 'center',
      paddingTop: screenInsets.top,
      paddingHorizontal: layout.screenPadding,
      paddingBottom: layout.scrollBottomInset + screenInsets.bottom,
      gap: spacing.lg,
    }}
    showsVerticalScrollIndicator={false}
    onEndReached={loadMore}
    // Half a screen out, so the next page is usually there by the time the
    // last row is.
    onEndReachedThreshold={0.5}
    ListHeaderComponent={
      <>
        {logs.isPending ? <Loading label="Reading your diary" /> : null}

        {logs.isError && !logs.data ? (
          <ErrorState
            title="Diary unavailable"
            message={describeError(logs.error)}
            onRetry={() => void logs.refetch()}
          />
        ) : null}
      </>
    }
    ListEmptyComponent={
      logs.data && items.length === 0 ? (
        <Empty
          icon="empty"
          title="Your diary is empty"
          message="Every meal you log lands here, newest first, with its photo and its calories. Tap one to fix a typo or delete it."
          actionLabel="Log your first meal"
          actionIcon="log"
          onAction={onLogFirst}
        />
      ) : null
    }
    ListFooterComponent={
      // The end of the diary is a designed state too. Silence after the
      // last row reads the same as a list that failed to load more.
      logs.isFetchingNextPage ? (
        <Loading label="Reading further back" />
      ) : items.length > 0 && !logs.hasNextPage ? (
        <Text
          style={[
            type.caption,
            { color: colors.muted, textAlign: 'center', paddingTop: spacing.lg },
          ]}
        >
          That is every meal you have logged.
        </Text>
      ) : null
    }
    /* A full step between days, against hairlines inside one, so a day
       reads as a group before a single word of it is read.

       Section 4 says a section heading should be `title`, and these are
       the group's own quieter label instead. The reason: a date is not a
       headline, it is the coordinate the meals under it share, and at 21pt
       it would outweigh every dish name on the screen. The grouping is
       already carried by the surface and the space around it, so the
       heading only has to name the day and say what it came to. */
    renderItem={({ item: day }) => (
      <DayGroup day={day} onOpen={onOpen} onRepeat={onRepeat} confirmed={confirmed} repeat={repeat} />
    )}
    ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
  />
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const logs = useInfiniteLogs();
  const repeat = useRepeatLog();

  const [confirmed, setConfirmed] = useState<Uuid | null>(null);

  /**
   * The only thing stopping a meal being logged twice.
   *
   * The usual answer, disabling the button while the request is out, is not
   * available on a row that is itself pressable: see the button above. And
   * isPending would only reach it a render later anyway, which is long after an
   * impatient second tap has landed. So the duplicate is refused here, before
   * anything is sent.
   */
  const inFlight = useRef<Uuid | null>(null);

  useEffect(() => {
    if (confirmed === null) return;
    // This line acknowledges a tap, it is not the row's status, so it steps
    // back out instead of sitting on a list the user has long scrolled past.
    const timer = setTimeout(() => setConfirmed(null), CONFIRMED_MS);
    return () => clearTimeout(timer);
  }, [confirmed]);

  /**
   * Which meal is waiting to be confirmed, or null when nothing is asked.
   *
   * Logging again used to fire on the tap. It writes a real row that then has
   * to be found and deleted, and the button sits on a row that is itself
   * pressable, so it is easy to hit by accident while scrolling. One question
   * is cheaper than an undo that does not exist.
   */
  const [pending, setPending] = useState<FoodLog | null>(null);

  const openMeal = useCallback((id: Uuid) => router.push(`/logs/${id}`), [router]);

  // Stable, so the memoised rows above actually stay memoised.
  const askToRepeat = useCallback((id: Uuid) => {
    setPending(itemsRef.current.find((log) => log.id === id) ?? null);
  }, []);

  const logAgain = (log: FoodLog) => {
    if (inFlight.current !== null) return;
    inFlight.current = log.id;
    setConfirmed(null);
    setPending(null);
    repeat.mutate(log.id, {
      onSuccess: () => {
        haptics.success();
        setConfirmed(log.id);
      },
      onError: () => haptics.error(),
      onSettled: () => {
        inFlight.current = null;
      },
    });
  };

  const items: FoodLog[] = useMemo(
    () => (logs.data?.pages ?? []).flatMap((page) => page.items),
    [logs.data],
  );
  /** The real number the server holds, which the header reports. */
  const total = logs.data?.pages[0]?.total ?? 0;

  // Read by askToRepeat, which has to stay stable for the memo above to hold
  // and therefore cannot close over `items`.
  const itemsRef = useRef<FoodLog[]>(items);
  itemsRef.current = items;

  // Today is read at grouping time rather than held in state: this query is the
  // only thing that moves the list, and it refetches when the screen comes back
  // into view, so a heading cannot sit on "Today" into the next morning without
  // the data under it being refreshed at the same moment.
  const days = useMemo(() => groupByDay(items, new Date()), [items]);

  const loadMore = useCallback(() => {
    if (logs.hasNextPage && !logs.isFetchingNextPage) void logs.fetchNextPage();
  }, [logs]);

  return (
    <Screen
      // The list does its own scrolling, because a hundred rows in a ScrollView
      // are a hundred mounted rows, each holding a photo request, on the one
      // screen in this app built to be scrolled for a long time. A FlatList
      // over days keeps a day's worth of rows mounted around the viewport and
      // lets the rest go.
      scroll={false}
      padded={false}
      title="Your diary"
      eyebrow={logs.data ? `${formatNumber(total)} logged` : undefined}
    >
      <DiaryList
        days={days}
        logs={logs}
        loadMore={loadMore}
        items={items}
        repeat={repeat}
        confirmed={confirmed}
        onOpen={openMeal}
        onRepeat={askToRepeat}
        onLogFirst={() => router.navigate('/log')}
      />

      {/* At screen level rather than inside the row, which is what every other
          confirmation in this app does. A dialog mounted per row would be a
          hundred modals, and it would unmount underneath itself the moment the
          list refetched. */}
      <Dialog
        visible={pending !== null}
        onDismiss={() => !repeat.isPending && setPending(null)}
        title="Log this again?"
        message={
          pending
            ? `${pending.dish_name} goes into today at ${formatNumber(
                pending.estimated_calories
              )} kcal. You can edit or delete it afterwards.`
            : undefined
        }
        actions={[
          {
            label: 'Log it again',
            variant: 'primary',
            onPress: () => pending && logAgain(pending),
            disabled: repeat.isPending,
            loading: repeat.isPending,
          },
          {
            label: 'Cancel',
            variant: 'secondary',
            onPress: () => setPending(null),
            disabled: repeat.isPending,
          },
        ]}
      />
    </Screen>
  );
}
