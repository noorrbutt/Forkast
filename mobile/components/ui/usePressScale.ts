import { useCallback } from 'react';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptics } from '../../lib/haptics';
import { motion } from '../../theme/motion';

type Options = {
  /** Fire a selection tick on press in. Off for destructive or navigational controls. */
  haptic?: boolean;
  disabled?: boolean;
};

/**
 * Scale down under the thumb and spring back.
 *
 * On press in rather than on press out, so the response happens while the
 * finger is still down. Feedback that arrives after you let go reads as lag.
 *
 * The spring runs on the UI thread, which is why this exists instead of the
 * `pressed` flag from Pressable's style callback: that flag round trips through
 * JS, so it stutters exactly when the app is busy, which is when a button most
 * needs to feel responsive.
 */
export function usePressScale({ haptic = true, disabled = false }: Options = {}) {
  const scale = useSharedValue(1);

  const onPressIn = useCallback(() => {
    if (disabled) return;
    scale.value = withSpring(motion.pressScale, motion.press);
    if (haptic) haptics.selection();
  }, [disabled, haptic, scale]);

  const onPressOut = useCallback(() => {
    scale.value = withSpring(1, motion.press);
  }, [scale]);

  /**
   * Put the control back to full size regardless of where the gesture got to.
   *
   * A Pressable that is disabled mid press stops being the responder and never
   * emits onPressOut, so the scale it was left at is the scale it keeps. Every
   * button wired to a mutation does exactly that: the press starts the request,
   * the request sets loading, and the button is disabled with the finger still
   * down. Callers use this on the transition into the disabled state.
   */
  const reset = useCallback(() => {
    scale.value = withSpring(1, motion.press);
  }, [scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return { animatedStyle, onPressIn, onPressOut, reset };
}
