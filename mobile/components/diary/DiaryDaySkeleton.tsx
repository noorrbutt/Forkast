import { View } from 'react-native';

import { Skeleton, SkeletonText } from '../ui';
import { useTheme } from '../../theme';
import { THUMB } from './rowProps';

/**
 * One day's worth of the shape DayGroup actually draws -- a heading line
 * above a card of row-shaped placeholders -- rather than a spinner sitting
 * alone in the middle of the screen before the first page has answered.
 */
export function DiaryDaySkeleton() {
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
