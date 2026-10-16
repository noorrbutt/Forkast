import { Text, View } from 'react-native';

import { ListGroup, ListRow } from '../ui';
import { formatNumber } from '../../lib/format';
import type { FoodLog } from '../../lib/types';
import { useTheme } from '../../theme';

/**
 * Up to four recent meals, one tap away from being logged again.
 *
 * Sits below the three capture-step buttons, which is otherwise dead space
 * for anyone with any history at all: the diary already has a "Log again"
 * on every row, but it is a scroll and a second screen away from the one
 * screen whose whole job is logging a meal.
 */
export function RecentMeals({
  logs,
  pending,
  onRepeat,
}: {
  logs: readonly FoodLog[];
  /** The id currently mid-repeat, so its own row can say so instead of the
   * generic Pressable feedback every other row gets. */
  pending: string | null;
  onRepeat: (log: FoodLog) => void;
}) {
  const { spacing, type, colors } = useTheme();

  if (logs.length === 0) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.title, { color: colors.text }]}>Recent</Text>
      <ListGroup>
        {logs.map((log, index) => (
          <ListRow
            key={log.id}
            icon="repeat"
            label={log.dish_name}
            value={`${formatNumber(log.estimated_calories)} kcal`}
            disabled={pending === log.id}
            onPress={() => onRepeat(log)}
            last={index === logs.length - 1}
          />
        ))}
      </ListGroup>
    </View>
  );
}
