import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { DayGroup } from '../../components/diary/DayGroup';
import { groupByDay, type DiaryDay } from '../../components/diary/diaryDays';
import { DeleteMealDialog, MealActionMenu, RepeatMealDialog } from '../../components/diary/DiaryDialogs';
import { DiaryDaySkeleton } from '../../components/diary/DiaryDaySkeleton';
import { Empty, ErrorState, Loading, Screen, UndoSnackbar, useScreenInsets } from '../../components/ui';
import { useDeleteLog, useInfiniteLogs, useRepeatLog } from '../../hooks/useLogs';
import { useSoftDelete } from '../../hooks/useSoftDelete';
import { describeError } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import type { FoodLog, Uuid } from '../../lib/types';
import { useLayout, useTheme } from '../../theme';

/**
 * The diary: every logged meal, newest first, grouped by day.
 *
 * Deliberately a plain list with no hero figure. Every meal carries equal
 * weight and nothing in the payload ranks them, so promoting one would invent
 * a hierarchy the content does not have and push the rest below the fold.
 * The row components live in components/diary/; this file owns the data,
 * the list, and the screen-level dialogs.
 */

/** How long the confirmation stays on a row before the row goes quiet again. */
const CONFIRMED_MS = 4000;

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
    // A full step between days, against hairlines inside one, so a day
    // reads as a group before a single word of it is read.
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

  /** Which meal Log again is asking about (RepeatMealDialog), or null. */
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
   * the same reasoning RepeatMealDialog gives for why a standing,
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

      <RepeatMealDialog
        log={pending}
        busy={repeat.isPending}
        onConfirm={logAgain}
        onCancel={() => setPending(null)}
      />
      <DeleteMealDialog
        log={confirmingDelete}
        onConfirm={(log) => deleteMeal(log.id)}
        onCancel={() => setConfirmingDelete(null)}
      />
      <MealActionMenu
        log={menuLog}
        onRepeat={(log) => askToRepeat(log.id)}
        onDelete={(log) => deleteMeal(log.id)}
        onClose={() => setMenuLog(null)}
      />
    </Screen>
  );
}
