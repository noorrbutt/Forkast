import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { ListGroup } from '../ui';
import type { useRepeatLog } from '../../hooks/useLogs';
import { describeError } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import type { FoodLog, Uuid } from '../../lib/types';
import { useTheme } from '../../theme';
import { segmentMeals, type DiaryDay } from './diaryDays';
import { MealRow } from './MealRow';
import { PhotoMealRow } from './PhotoMealRow';

export type DayGroupProps = {
  day: DiaryDay;
  onOpen: (id: Uuid) => void;
  onRepeat: (id: Uuid) => void;
  onDelete: (id: Uuid) => void;
  onAskDelete: (id: Uuid) => void;
  onLongPress: (id: Uuid) => void;
  confirmed: Uuid | null;
  repeat: ReturnType<typeof useRepeatLog>;
};

/**
 * One day of the diary: a quiet heading with the day's total, then its meals.
 *
 * The heading is `labelSoft` rather than a section title on purpose. A date
 * is not a headline, it is the coordinate the meals under it share, and at
 * title size it would outweigh every dish name on the screen. The grouping is
 * already carried by the surface and the space around it, so the heading
 * only has to name the day and say what it came to -- printed once per day
 * rather than once per meal.
 */
export function DayGroup({
  day,
  onOpen,
  onRepeat,
  onDelete,
  onAskDelete,
  onLongPress,
  confirmed,
  repeat,
}: DayGroupProps) {
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
      {/* Outside the ListGroup rather than its `title` prop, because a day
          can hold more than one surface: this names the day once, above all
          of them, rather than repeating per run or being unreachable for a
          day that opens on a photo. */}
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
