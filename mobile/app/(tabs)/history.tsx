import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';

import {
  Button,
  Dialog,
  Empty,
  ErrorState,
  Icon,
  ListGroup,
  Loading,
  Screen,
  useScreenInsets,
  initialsOf,
} from '../../components/ui';
import { useInfiniteLogs, useRepeatLog } from '../../hooks/useLogs';
import { usePhotoSource } from '../../hooks/usePhoto';
import { describeError } from '../../lib/api';
import { SERVING_LABELS, formatNumber } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import type { FoodLog, Uuid } from '../../lib/types';
import { useTheme } from '../../theme';

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
 */

/** How long the confirmation stays on a row before the row goes quiet again. */
const CONFIRMED_MS = 4000;

/** The photo, square, large enough to recognise a dish and no larger. */
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

/**
 * One meal.
 *
 * Local to this screen rather than in components/ui because there is exactly
 * one caller: a meal row is a photo, a dish, a figure to compare and a repeat,
 * which is a different shape from the settings row `ListRow` exists for. If a
 * second screen ever needs it, it moves.
 */
function MealRowBase({ log, last, onOpen, onRepeat, sending, confirmed, error }: MealRowProps) {
  const { colors, radius, spacing, type } = useTheme();

  // Asked for only when the payload says there is one, so a meal without a
  // photo never fires a request that can only come back empty.
  const photo = usePhotoSource(log.has_photo ? log.id : null);

  const meta = [
    log.category?.name,
    log.restaurant?.name ?? log.area,
    SERVING_LABELS[log.serving_size],
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={() => onOpen(log.id)}
      accessibilityRole="button"
      accessibilityLabel={`${log.dish_name}, ${formatNumber(log.estimated_calories)} kcal`}
      accessibilityHint="Opens this meal"
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: spacing.lg,
        padding: spacing.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
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
        {photo ? (
          <Image
            source={photo}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          // Typographic, never a camera glyph in a grey box. A monogram is the
          // same fallback the profile picture uses, so a missing image reads as
          // a deliberate placeholder rather than as a failed load.
          <Text style={[type.title, { color: colors.muted }]}>{initialsOf(log.dish_name)}</Text>
        )}
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
                // Lining figures, so a column of digits stays a column.
                fontVariant: ['tabular-nums'],
              },
            ]}
          >
            {formatNumber(log.estimated_calories)}
          </Text>
          {/* The row is the way in to the meal, which nothing else here says
              out loud. */}
          <Icon name="forward" size={18} />
        </View>

        {meta ? <Text style={[type.caption, { color: colors.muted }]}>{meta}</Text> : null}

        {/* Every row gets its own control rather than a swipe or a long press.
            The whole point of repeating is to skip the trip through the meal,
            and a gesture nobody can see is not a shortcut, it is a secret. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: spacing.md,
            marginTop: spacing.sm,
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

        {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
      </View>
    </Pressable>
  );
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

export default function HistoryScreen() {
  const { colors, layout, spacing, type } = useTheme();
  const router = useRouter();
  const logs = useInfiniteLogs();
  const screenInsets = useScreenInsets();
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
              onAction={() => router.navigate('/log')}
            />
          ) : null
        }
        ListFooterComponent={
          // The end of the diary is a designed state too. Silence after the
          // last row reads the same as a list that failed to load more.
          logs.isFetchingNextPage ? (
            <Loading label="Reading further back" fill={false} />
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
          <ListGroup title={`${day.heading} · ${formatNumber(day.total)} kcal`}>
            {day.meals.map((log, index) => (
              <MealRow
                key={log.id}
                log={log}
                last={index === day.meals.length - 1}
                onOpen={openMeal}
                onRepeat={askToRepeat}
                sending={repeat.isPending && repeat.variables === log.id}
                confirmed={confirmed === log.id}
                error={
                  repeat.isError && repeat.variables === log.id
                    ? describeError(repeat.error)
                    : null
                }
              />
            ))}
          </ListGroup>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
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
