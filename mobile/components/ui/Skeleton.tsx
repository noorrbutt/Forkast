import { useEffect } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../../theme';

/**
 * The shape of a card before its content has answered, not a spinner
 * floating in dead space.
 *
 * A spinner tells someone something is happening; it says nothing about
 * what is about to appear, so the screen jumps the instant real content
 * lands -- a headline where a small centred circle was, a list where a
 * blank gap was. A skeleton is a silent promise about the layout: draw the
 * boxes real content will fill, at the sizes and positions they will
 * actually take, and nothing has to move when the promise is kept.
 *
 * The pulse is checked against `useReducedMotion()` directly, by hand,
 * rather than a `reduceMotion` field on the timing config: this is a loop
 * with no natural end (it runs for as long as the screen is loading), and
 * a repeating `withTiming` given `reduceMotion` on its own config still
 * jumps straight to its end value on every iteration `withRepeat` asks
 * for, which reads as a flicker rather than as stillness. Not starting the
 * loop at all is what actually leaves a still, mid-opacity box -- the same
 * reasoning the app's one other idle loop (the streak flame, since
 * reverted, but its note on this survives in git history) already
 * documented for itself.
 */
const PULSE_MS = 900;

export function Skeleton({
  width,
  height,
  radius = 8,
  style,
}: {
  width: DimensionValue;
  height: number;
  radius?: number;
  style?: object;
}) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  // The resting value itself, not just where the loop below starts from --
  // read at the initial render rather than only set inside the effect, so
  // the still frame is what's actually on screen before the loop would
  // otherwise have taken its first step, not a value only reachable once
  // an animation has run.
  const opacity = useSharedValue(reducedMotion ? 0.65 : 0.5);

  useEffect(() => {
    if (reducedMotion) return;
    const easing = Easing.inOut(Easing.sin);
    opacity.value = withRepeat(
      withTiming(1, { duration: PULSE_MS, easing }),
      -1,
      true,
    );
  }, [reducedMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      // Decorative: the real content it stands in for gets its own label
      // once it lands, and a screen reader has nothing useful to say about
      // an empty box's size.
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.surfaceAlt },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** One line of "text", sized off the type scale rather than a guessed pixel
 * height, so a heading-sized skeleton and a caption-sized one are visibly
 * different weights the same way the real headings and captions are. */
export function SkeletonText({
  width,
  fontSize,
  style,
}: {
  width: DimensionValue;
  fontSize: number;
  style?: object;
}) {
  return <Skeleton width={width} height={Math.round(fontSize * 0.7)} radius={4} style={style} />;
}

/** A block of skeleton rows the height a Card would be, for a screen that
 * has not decided its content yet. Exported separately from Skeleton so a
 * caller can still reach for a bare box; most call sites want this. */
export function SkeletonCard({ rows = 2 }: { rows?: number }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        padding: spacing.xl,
        gap: spacing.md,
      }}
    >
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonText key={index} width={index === 0 ? '60%' : '100%'} fontSize={16} />
      ))}
    </View>
  );
}
