import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '../../theme';
import { flameCore } from '../../theme/tokens';

/**
 * The streak count, drawn inside a flame rather than printed on its own.
 *
 * Two layers, not a stock glyph. An Ionicons flame or the fire emoji is a
 * symmetric silhouette a thousand other apps already use for exactly this
 * meaning, which is precisely why it reads as an icon rather than as fire:
 * real flame is not mirror-symmetric, so symmetry is the one property a
 * hand-drawn shape here has to avoid. Both paths below were drawn with that
 * asymmetry deliberate -- wider bulges on one side than the other, a short
 * straight edge at the tip instead of a smooth point -- rather than derived
 * from a formula that would have put it back.
 *
 * The two fills are `colors.accentFill` (this theme's one action colour,
 * already correct on both light and dark) for the outer flame and the fixed
 * `flameCore` for the inner one. See flameCore's own note in tokens.ts for
 * why the core is not itself a per-theme pair and not `colors.danger`.
 */

/** The natural box both paths were drawn in. Taller than wide, which a flame
 * silhouette needs to be. */
const VIEW_W = 100;
const VIEW_H = 140;

/**
 * A closed, asymmetric flame silhouette: a tip leaning right of centre, a
 * wide bulge on the right roughly two thirds of the way down, a narrower
 * answering bulge on the left higher up, and a short straight edge closing
 * the tip instead of a smooth curve back to the start point.
 */
const OUTER_FLAME_PATH =
  'M 50 8 C 78 34 84 66 66 96 C 78 112 60 132 40 128 C 18 124 8 100 18 76 C 10 58 20 34 42 14 Z';

/** The same idea, smaller and drawn independently rather than as a scaled
 * copy of the outer path -- a core that was simply the outer flame shrunk
 * would read as one shape doubled rather than as two layers. */
const INNER_CORE_PATH =
  'M 52 46 C 68 62 70 82 58 100 C 66 110 54 122 42 118 C 28 114 24 96 32 82 C 26 70 32 56 46 48 Z';

/**
 * How much longer streaks are allowed to push the flame's size and pace,
 * capped at a month. Past that the difference between day 31 and day 400
 * stops being something a glance can tell apart from noise, and an
 * unbounded curve means every account that has run this long asks the
 * meter to keep growing forever.
 */
const INTENSITY_CAP_DAYS = 30;

/**
 * Idle-loop timing for the breathing and sway below, kept local to this file
 * rather than added to theme/motion.ts. Everything in that file is
 * interaction driven -- a press, a save, a milestone landing -- each with a
 * duration chosen for how it answers a tap. This is the opposite: it never
 * stops and nothing triggers it, which is a different vocabulary with
 * nothing else in the app that would ever reuse these specific numbers.
 *
 * Durations are deliberately not equal to each other. Three loops on the
 * same period would crest together on a fixed schedule and read as one
 * rigid pulse with two shapes riding along; staggered by roughly a second
 * each, the layers drift in and out of phase the way independent things
 * actually do.
 */
const OUTER_BASE_MS = 2400;
const INNER_BASE_MS = 1700;
const SWAY_MS = 3100;

type FlameMeterProps = {
  /** The current streak, in days. Also the number printed inside the flame. */
  value: number;
  /** The flame's natural height. The number's own size is fixed (`type.heroStat`) and does not scale with this. */
  size?: number;
};

export function FlameMeter({ value, size = 220 }: FlameMeterProps) {
  const { colors, type } = useTheme();
  const reducedMotion = useReducedMotion();

  // 0 at day zero, 1 at the cap. Clamped both ends: a broken streak reading
  // as a negative flame would be a bug, not a smaller one.
  const intensity = Math.min(Math.max(value, 0), INTENSITY_CAP_DAYS) / INTENSITY_CAP_DAYS;

  const outerScale = useSharedValue(1);
  const innerScale = useSharedValue(1);
  const sway = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      // Set once and stop, rather than let a loop that was already running
      // finish its current leg. "Static" has to mean nothing moves, not one
      // last transition to prove it does.
      outerScale.value = 1;
      innerScale.value = 1;
      sway.value = 0;
      return;
    }

    // A longer streak breathes a little faster, never a different animation,
    // which is why this only ever shortens the base durations by a fraction.
    const outerMs = OUTER_BASE_MS - intensity * 500;
    const innerMs = INNER_BASE_MS - intensity * 350;
    const easing = Easing.inOut(Easing.sin);

    outerScale.value = withRepeat(
      withSequence(
        withTiming(1.03, { duration: outerMs, easing }),
        withTiming(0.97, { duration: outerMs, easing }),
      ),
      -1,
      true,
    );
    innerScale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: innerMs, easing }),
        withTiming(0.94, { duration: innerMs, easing }),
      ),
      -1,
      true,
    );
    // Degrees, not a fraction: this reads as fire changing which way it is
    // leaning for a moment, not as the whole shape tilting.
    sway.value = withRepeat(
      withSequence(
        withTiming(2, { duration: SWAY_MS, easing }),
        withTiming(-2, { duration: SWAY_MS, easing }),
      ),
      -1,
      true,
    );
  }, [reducedMotion, intensity, outerScale, innerScale, sway]);

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: outerScale.value }, { rotate: `${sway.value}deg` }],
  }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: innerScale.value }],
  }));

  // Height first, width follows the path's own 100:140 box, so a longer
  // streak's flame grows without ever stretching off the shape it was drawn
  // at.
  const outerH = size * (0.86 + intensity * 0.14);
  const outerW = outerH * (VIEW_W / VIEW_H);
  const innerH = outerH * (0.5 + intensity * 0.12);
  const innerW = innerH * (VIEW_W / VIEW_H);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: outerW,
            height: outerH,
            left: (size - outerW) / 2,
            top: (size - outerH) / 2,
          },
          outerStyle,
        ]}
      >
        <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          <Path d={OUTER_FLAME_PATH} fill={colors.accentFill} />
        </Svg>
      </Animated.View>

      {/* Sits lower than dead centre of the outer flame, the way a real core
          does: nearer the base, well short of the outer tip. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: innerW,
            height: innerH,
            left: (size - innerW) / 2,
            top: (size - innerH) / 2 + outerH * 0.12,
          },
          innerStyle,
        ]}
      >
        <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          <Path d={INNER_CORE_PATH} fill={flameCore} />
        </Svg>
      </Animated.View>

      {/* type.heroStat unmodified -- the reserved size for this exact
          moment, not a new one-off shrunk to fit. The flame is sized around
          it instead, in the default `size`, rather than the number being
          sized around the flame. Not absolutely positioned: the only
          normal-flow child of a centred flex container, the same seam Ring
          uses for its own children, so it sits on top of both flame layers
          without needing its own z-index. */}
      <Text style={[type.heroStat, { color: colors.accentInk }]}>{value}</Text>
    </View>
  );
}
