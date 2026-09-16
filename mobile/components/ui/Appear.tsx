import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { motion } from '../../theme/motion';

type AppearProps = {
  children: ReactNode;
  /**
   * Position in the group. Each successive item waits one stagger step longer,
   * so a list arrives as a sequence rather than all at once.
   */
  index?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Fades and lifts its children into place.
 *
 * Deliberately built on reanimated's layout animations rather than a mount
 * effect: they run entirely on the UI thread, so a screen rendering a dozen of
 * these does not pay for a dozen JS driven timers while it is also fetching.
 *
 * The travel distance is small on purpose. Content sliding a long way reads as
 * a transition between screens, which is not what is happening here.
 */
export function Appear({ children, index = 0, style }: AppearProps) {
  return (
    <Animated.View
      style={style}
      entering={FadeInDown.delay(index * motion.stagger)
        .duration(motion.entrance.duration ?? 320)
        .withInitialValues({ transform: [{ translateY: motion.travel }] })}
    >
      {children}
    </Animated.View>
  );
}
