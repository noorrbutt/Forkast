import { View } from 'react-native';

import { HeroWash, Skeleton, SkeletonText } from '../ui';
import { useTheme } from '../../theme';
import { HERO_RING_SIZE } from './HomeHero';

/**
 * Home before the dashboard has answered: the same wash, a numeral-sized bar
 * where the figure lands and the small ring beside it, so the real response
 * moves nothing. The Today strip draws its own placeholder tiles.
 */
export function HomeSkeleton() {
  const { spacing } = useTheme();

  return (
    <HeroWash pullUp={false}>
      <View style={{ gap: spacing.lg, paddingBottom: spacing.xxxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <SkeletonText width={160} fontSize={64} />
            <SkeletonText width={120} fontSize={13} />
          </View>
          <Skeleton width={HERO_RING_SIZE} height={HERO_RING_SIZE} radius={HERO_RING_SIZE / 2} />
        </View>
        <SkeletonText width={180} fontSize={15} />
      </View>
    </HeroWash>
  );
}
