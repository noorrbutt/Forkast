import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { groupByDay, segmentMeals, type DiaryDay } from '../../components/diary/diaryDays';
import { MealRow } from '../../components/diary/MealRow';
import { PhotoMealRow } from '../../components/diary/PhotoMealRow';
import { THUMB } from '../../components/diary/rowProps';
import { Dialog, Empty, ErrorState, ListGroup, Loading, Screen, Skeleton, SkeletonText, UndoSnackbar, useScreenInsets } from '../../components/ui';
import { useDeleteLog, useInfiniteLogs, useRepeatLog } from '../../hooks/useLogs';
import { useSoftDelete } from '../../hooks/useSoftDelete';
import { describeError } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import type { FoodLog, Uuid } from '../../lib/types';
import { useLayout, useTheme } from '../../theme';

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

/**
 * One day's worth of the shape DayGroup actually draws -- a heading line
 * above a card of row-shaped placeholders -- rather than a spinner sitting
 * alone in the middle of the screen before the first page has answered.
 */
function DiaryDaySkeleton() {
  const { colors, radius, spacing } = useTheme();

  return (
    <View style={{ gap: spacing.sm }}>
      <SkeletonText width={120} fontSize={11} />
      <View
        style={{
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          padding: spacing.lg,
          gap: spacing.lg,
        }}
      >
        {[0, 1].map((row) => (
          <View key={row} style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
            <Skeleton width={THUMB} height={THUMB} radius={radius.tile} />
            <View style={{ flex: 1, gap: spacing.sm }}>
              <SkeletonText width="70%" fontSize={16} />
              <SkeletonText width="40%" fontSize={13} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function DayGroup({
  day,
  onOpen,
  onRepeat,
  onDelete,
  onAskDelete,
  onLongPress,
  confirmed,
  repeat,
}: {
  day: DiaryDay;
  onOpen: (id: Uuid) => void;
  onRepeat: (id: Uuid) => void;
  onDelete: (id: Uuid) => void;
  onAskDelete: (id: Uuid) => void;
  onLongPress: (id: Uuid) => void;
  confirmed: Uuid | null;
  repeat: ReturnType<typeof useRepeatLog>;
}) {
  const { colors, spacing, type } = useTheme();
  const segments = useMemo(() => segmentMeals(day.meals), [day.meals]);

  const rowProps = (log: FoodLog) => ({
    onOpen,
    onRepeat,
    onDelete,
    onAskDelete,
    onLongPress,
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
  onDelete,
  onAskDelete,
  onLongPress,
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
  onDelete: (id: Uuid) => void;
  onAskDelete: (id: Uuid) => void;
  onLongPress: (id: Uuid) => void;
  onLogFirst: () => void;
}) {
  const { colors, layout, spacing, type } = useTheme();
  const screenInsets = useScreenInsets();
  const { isExpanded } = useLayout();
  const numColumns = isExpanded ? 2 : 1;

  return (
  <FlatList<DiaryDay>
    testID="diary"
    // FlatList remounts on a numColumns change rather than reflowing in
    // place -- required by the library, not a choice made here -- so the
    // key has to change with it or rotating a tablet mid-scroll throws.
    key={numColumns}
    numColumns={numColumns}
    columnWrapperStyle={numColumns > 1 ? { gap: spacing.lg } : undefined}
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
    // a list lets you centre. Widened at expanded for the same reason the
    // dashboard's is: two real day cards side by side need more than the
    // single-column measure, each one still individually readable rather
    // than the pair stretching edge to edge.
    contentContainerStyle={{
      width: '100%',
      maxWidth: isExpanded ? layout.contentWidth * 1.6 : layout.contentWidth,
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
        {logs.isPending ? (
          <View style={{ gap: spacing.lg }}>
            <DiaryDaySkeleton />
            <DiaryDaySkeleton />
          </View>
        ) : null}

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
    renderItem={({ item: day }) =>
      numColumns > 1 ? (
        // flex: 1 so two cards in a row share it evenly rather than each
        // sizing to its own content -- otherwise a short day and a long one
        // paired together left a gap that read as a third, empty column.
        <View style={{ flex: 1 }}>
          <DayGroup day={day} onOpen={onOpen} onRepeat={onRepeat} onDelete={onDelete} onAskDelete={onAskDelete} onLongPress={onLongPress} confirmed={confirmed} repeat={repeat} />
        </View>
      ) : (
        <DayGroup day={day} onOpen={onOpen} onRepeat={onRepeat} onDelete={onDelete} onAskDelete={onAskDelete} onLongPress={onLongPress} confirmed={confirmed} repeat={repeat} />
      )
    }
    ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
  />
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const logs = useInfiniteLogs();
  const repeat = useRepeatLog();
  const deleteLog = useDeleteLog();

  const [confirmed, setConfirmed] = useState<Uuid | null>(null);

  /**
   * The undo window a swiped-away (or "Delete" button) row sits in before
   * it actually leaves the server. See useSoftDelete's own note on why
   * flush has to be wired to more than just its own five second timer.
   */
  const softDelete = useSoftDelete<Uuid>(
    useCallback((id: Uuid) => deleteLog.mutate(id), [deleteLog]),
  );

  // Leaving the tab is "navigation" the same way closing the app is
  // "background": both are ways of looking away without pressing Undo, and
  // expo-router keeps tab screens mounted across a switch, so unmounting
  // alone would never catch this one.
  useFocusEffect(
    useCallback(() => {
      return () => softDelete.flush();
    }, [softDelete]),
  );

  /** What the snackbar at the bottom of the screen says right now, and what
   * Undo undoes -- the most recently swiped row, not every pending one, so
   * swiping three rows in a row and pressing Undo once has one clear,
   * predictable target rather than an ambiguous "undo something". */
  const [lastDeleted, setLastDeleted] = useState<{ id: Uuid; dishName: string } | null>(null);

  const deleteMeal = useCallback(
    (id: Uuid) => {
      const log = itemsRef.current.find((item) => item.id === id);
      if (!log) return;
      softDelete.schedule(id);
      setLastDeleted({ id, dishName: log.dish_name });
      haptics.tap();
    },
    [softDelete],
  );

  const undoDelete = useCallback(() => {
    if (!lastDeleted) return;
    softDelete.cancel(lastDeleted.id);
    setLastDeleted(null);
    haptics.tap();
  }, [lastDeleted, softDelete]);

  // The snackbar clears itself once its own row has actually committed
  // (the undo window elapsed, or a flush forced it sooner), rather than
  // running a second timer of its own that could drift out of sync with
  // useSoftDelete's.
  useEffect(() => {
    if (lastDeleted && !softDelete.isPending(lastDeleted.id)) setLastDeleted(null);
  }, [lastDeleted, softDelete]);

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

  /**
   * Which meal the footer's Delete button is asking about, or null when
   * nothing is asked. The swipe and the long-press menu skip this and call
   * deleteMeal directly -- both are already a deliberate step on their own,
   * the same reasoning askToRepeat's own comment gives for why a standing,
   * one-tap button is the one that needs the question in front of it.
   */
  const [confirmingDelete, setConfirmingDelete] = useState<FoodLog | null>(null);

  const askToDelete = useCallback((id: Uuid) => {
    setConfirmingDelete(itemsRef.current.find((log) => log.id === id) ?? null);
  }, []);

  /**
   * The non-gesture path to a row's actions: a long press, or the custom
   * accessibility action every row also carries -- alongside the swipe, the
   * footer's own standing Delete button, and the detail screen's own
   * Delete, this is one more way Delete stays reachable without a gesture
   * no one can see coming.
   */
  const [menuLog, setMenuLog] = useState<FoodLog | null>(null);
  const askMenu = useCallback((id: Uuid) => {
    setMenuLog(itemsRef.current.find((log) => log.id === id) ?? null);
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

  // Gone from the list the instant it's swiped, not merely greyed out: the
  // server hasn't actually deleted it yet (see useSoftDelete), but showing
  // a row that visually still exists while its own Delete button no longer
  // does anything would read as broken rather than as undoable.
  const visibleItems = useMemo(
    () => items.filter((item) => !softDelete.isPending(item.id)),
    [items, softDelete],
  );

  // Today is read at grouping time rather than held in state: this query is the
  // only thing that moves the list, and it refetches when the screen comes back
  // into view, so a heading cannot sit on "Today" into the next morning without
  // the data under it being refreshed at the same moment.
  const days = useMemo(() => groupByDay(visibleItems, new Date()), [visibleItems]);

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
        items={visibleItems}
        repeat={repeat}
        confirmed={confirmed}
        onOpen={openMeal}
        onRepeat={askToRepeat}
        onDelete={deleteMeal}
        onAskDelete={askToDelete}
        onLongPress={askMenu}
        onLogFirst={() => router.navigate('/log')}
      />

      <UndoSnackbar
        message={lastDeleted ? `Deleted ${lastDeleted.dishName}.` : null}
        onUndo={undoDelete}
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

      {/* Delete's own confirmation, the same reasoning as Log again's just
          above: the footer button is one plain tap on every row, which is
          exactly why it asks first. The swipe and the long-press menu don't
          -- both are already a deliberate step, and the undo snackbar is
          still there underneath this as the second safety net either way. */}
      <Dialog
        visible={confirmingDelete !== null}
        onDismiss={() => setConfirmingDelete(null)}
        title="Delete this meal?"
        message={
          confirmingDelete
            ? `${confirmingDelete.dish_name} will be removed from your diary. You can undo it for a few seconds afterwards.`
            : undefined
        }
        actions={[
          {
            label: 'Delete',
            variant: 'danger',
            icon: 'trash',
            onPress: () => {
              if (confirmingDelete) deleteMeal(confirmingDelete.id);
              setConfirmingDelete(null);
            },
          },
          {
            label: 'Cancel',
            variant: 'secondary',
            onPress: () => setConfirmingDelete(null),
          },
        ]}
      />

      {/* The accessible, non-gesture equivalent of the swipe: a long press,
          or the same custom accessibility action, opens this instead of
          reaching for a hidden panel off the edge of the row. */}
      <Dialog
        visible={menuLog !== null}
        onDismiss={() => setMenuLog(null)}
        title={menuLog?.dish_name ?? ''}
        actions={[
          {
            label: 'Log again',
            icon: 'log',
            onPress: () => {
              if (menuLog) askToRepeat(menuLog.id);
              setMenuLog(null);
            },
          },
          {
            label: 'Delete',
            icon: 'trash',
            variant: 'danger',
            onPress: () => {
              if (menuLog) deleteMeal(menuLog.id);
              setMenuLog(null);
            },
          },
          {
            label: 'Cancel',
            onPress: () => setMenuLog(null),
          },
        ]}
      />
    </Screen>
  );
}
