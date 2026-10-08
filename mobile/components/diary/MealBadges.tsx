import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '../ui';
import type { FoodLog } from '../../lib/types';
import { useTheme } from '../../theme';
import { quick } from '../../theme/motion';

/** How long the "Refined" tag stays up after a number changes underneath it. */
const REFINED_TAG_MS = 4000;

/**
 * True for one brief window: the render where a log's number just changed
 * because its background refinement landed, or the response to Log again
 * came back photo-priced and instantly refined.
 *
 * Compares against a ref rather than the previous props, because a memoised
 * row does not necessarily re-render on every parent pass -- React Query
 * swapping the cached log in is what has to be caught here, not a React
 * lifecycle event. Never true for a log that has always been refined (a
 * fresh mount with `refined: true` and nothing to compare against yet): the
 * point is to mark a change happening, not to claim credit for one that
 * happened before this row ever rendered.
 */
export function useJustRefined(log: FoodLog): boolean {
  const previous = useRef<{ calories: number; refined: boolean } | null>(null);
  const [justRefined, setJustRefined] = useState(false);

  useEffect(() => {
    const prior = previous.current;
    previous.current = { calories: log.estimated_calories, refined: log.refined };
    if (
      prior &&
      !prior.refined &&
      log.refined &&
      prior.calories !== log.estimated_calories
    ) {
      setJustRefined(true);
      const timer = setTimeout(() => setJustRefined(false), REFINED_TAG_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [log.estimated_calories, log.refined]);

  return justRefined;
}

/**
 * The acknowledgement that a number just moved, instead of the silent swap
 * this replaced: `estimated_calories` used to change underneath whatever was
 * on screen the moment the background refinement landed, with nothing on the
 * row saying so.
 */
export function RefinedTag({ overlay = false }: { overlay?: boolean }) {
  const { colors, radius, spacing, type } = useTheme();
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, quick);
    return () => {
      opacity.value = 0;
    };
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (overlay) {
    // Same fixed-contrast treatment as EstimateBadge's own overlay variant,
    // and the same reasoning: this sits on a photograph, not on either of
    // the app's own backgrounds, so colors.successSoft/colors.text -- tuned
    // for the page -- has no guarantee of reading here.
    return (
      <Animated.View
        accessible
        accessibilityRole="text"
        accessibilityLabel="Estimate refined"
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            alignSelf: 'flex-start',
            borderRadius: radius.pill,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
          },
          style,
        ]}
      >
        <Icon name="check" size={12} color="#FFFFFF" />
        <Text style={[type.caption, { color: '#FFFFFF' }]}>Refined</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      accessible
      accessibilityRole="text"
      accessibilityLabel="Estimate refined"
      style={[
        {
          alignSelf: 'flex-start',
          borderRadius: radius.pill,
          backgroundColor: colors.successSoft,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        style,
      ]}
    >
      {/* `text`, not `success`: colors.success on colors.successSoft measures
          under 4.5:1 in dark theme once the translucent fill is actually
          composited (contrast.test.ts's own "soft status fills" cases), and
          the tint plus the word "Refined" already carry the meaning without
          asking the label's own ink to also be the status colour. */}
      <Text style={[type.caption, { color: colors.text }]}>Refined</Text>
    </Animated.View>
  );
}

/**
 * The row useCreateLog inserts the instant a meal is logged, before the
 * server has answered at all. Neutral rather than success or danger colouring
 * on purpose: this is not yet a fact about the meal, it is a fact about the
 * connection, and it clears itself the moment either resolves.
 */
export function PendingBadge() {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel="Saving, will sync when back online"
      style={{
        alignSelf: 'flex-start',
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceAlt,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={[type.caption, { color: colors.muted }]}>Pending sync</Text>
    </View>
  );
}
