import { ScrollView, Text, View } from 'react-native';

import { Skeleton } from '../ui';
import type { FoodLog, Uuid } from '../../lib/types';
import { useTheme } from '../../theme';
import { GhostSlotTile } from './GhostSlotTile';
import { MealTile, useTileSize } from './MealTile';
import type { Slot } from './todayMeals';

/**
 * What has been eaten today, as a row of tiles, then the slots still open.
 *
 * Home's second answer, after how much is left. Meals run oldest first so
 * the row reads like the day did; the open slots follow as ghost tiles, so on
 * a fresh morning the whole strip is three ways into Log, and once every
 * slot is filled or past one "Another meal" ghost stays at the end. It scrolls
 * sideways and bleeds through the right-hand gutter, so the fourth tile
 * cut off at the edge says there is more.
 *
 * A heading, unusually for this screen, because a row of tiles with nothing
 * over it could be anyone's meals from any day.
 */
export function TodayStrip({
  meals,
  open,
  loading,
  failed,
  onOpen,
  onLogSlot,
}: {
  meals: FoodLog[];
  open: Slot[];
  loading: boolean;
  failed: boolean;
  onOpen: (id: Uuid) => void;
  onLogSlot: (slot: Slot | null) => void;
}) {
  const { colors, layout, radius, spacing, type } = useTheme();
  const size = useTileSize(spacing.md);

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={[type.title, { color: colors.text }]}>Today</Text>

      {failed ? (
        <Text style={[type.caption, { color: colors.muted }]}>
          {"Today's meals did not load. Pull down to try again."}
        </Text>
      ) : (
        <ScrollView
          testID="today-strip"
          horizontal
          showsHorizontalScrollIndicator={false}
          // Through the right gutter to the screen edge, and back in by the
          // same amount at the end, so the last tile still stops on the column.
          style={{ marginRight: -layout.screenPadding }}
          contentContainerStyle={{ gap: spacing.md, paddingRight: layout.screenPadding }}
        >
          {loading
            ? [0, 1, 2].map((index) => (
                <Skeleton
                  key={index}
                  width={size.width}
                  height={size.height}
                  radius={radius.input}
                />
              ))
            : [
                ...meals.map((log) => (
                  <MealTile key={log.id} log={log} size={size} onOpen={onOpen} />
                )),
                ...(open.length > 0 ? open : [null]).map((slot) => (
                  <GhostSlotTile key={slot ?? 'any'} slot={slot} size={size} onPress={onLogSlot} />
                )),
              ]}
        </ScrollView>
      )}
    </View>
  );
}
