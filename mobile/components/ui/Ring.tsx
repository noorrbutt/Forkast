import { type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { useTheme } from '../../theme';

type RingProps = {
  /** How much of the target has been used. */
  value: number;
  /** The limit. Null means there is no target, and the ring is not drawn. */
  max: number | null;
  size?: number;
  /** Rendered in the middle. The hero figure and its supporting line. */
  children?: ReactNode;
};

/** Where the track starts and ends, leaving a gap at the bottom. */
const SWEEP = 280;
const START = 130;
const THICKNESS = 14;

/**
 * A meter, drawn as a ring.
 *
 * Deliberately not a donut chart. A donut compares segments against each other
 * and is a poor form for values that are close; this is one value against one
 * limit, which is a meter, and a ring is a legitimate shape for part to whole at
 * a glance. There is one track and one fill, from the same ramp.
 *
 * Over target is the state this is built around, because it is the one a bar
 * usually gets wrong by filling up and stopping, so 1,801 and 3,000 look
 * identical. Here the scale grows to hold the overshoot and a tick stays where
 * the target is, so the amount past it is visible as distance. The words beside
 * the ring say "over by N" as well, since the style guide does not allow a state
 * to be carried by colour alone.
 */
export function Ring({ value, max, size = 220, children }: RingProps) {
  const { colors } = useTheme();

  const radius = (size - THICKNESS) / 2;
  const circumference = 2 * Math.PI * radius;
  const trackLength = (SWEEP / 360) * circumference;

  const hasTarget = max !== null && max > 0;
  const over = hasTarget && value > max;
  // The scale holds whichever is larger, so going over extends the arc rather
  // than pinning it at full.
  const scale = hasTarget ? Math.max(max, value) : Math.max(value, 1);
  const filled = Math.max(0, Math.min(1, value / scale));
  const targetAt = hasTarget ? max / scale : 1;

  /**
   * Status, not series, and not brand either.
   *
   * Still not saffron: that is the one action colour, and a meter borrowing it
   * makes a reading look like a control and leaves the screen with nothing
   * unambiguously tappable.
   *
   * It used to take series[0], a blue, for the under target half while the over
   * target half took danger. That was one binary drawn in two vocabularies, and
   * it had a worse consequence than inconsistency: the screen was more colourful
   * when the day went badly than when it went well. Doing well was grey.
   *
   * Inside a target and outside it are two readings of one status, so both
   * halves wear the status palette. Sage for inside, terracotta for over, which
   * is also the meaning the user assigns those two colours everywhere else.
   *
   * Never split.clean, though it is the same hue family. That token means "food
   * that was not junk" and this meter asks a different question; the same sage
   * meaning two things ten points apart in one scroll is worse than no sage.
   */
  const fill = over ? colors.danger : colors.success;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {hasTarget ? (
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <G rotation={START} origin={`${size / 2}, ${size / 2}`}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={colors.surfaceAlt}
              strokeWidth={THICKNESS}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${trackLength} ${circumference}`}
            />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={fill}
              strokeWidth={THICKNESS}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${trackLength * filled} ${circumference}`}
            />
            {/* Where the target sits on a scale that has grown past it. Drawn in
                the page colour so it reads as a gap cut through the fill. */}
            {over ? (
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={colors.bg}
                strokeWidth={THICKNESS + 2}
                fill="none"
                strokeDasharray={`3 ${circumference}`}
                strokeDashoffset={-trackLength * targetAt}
              />
            ) : null}
          </G>
        </Svg>
      ) : null}

      <View style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}
