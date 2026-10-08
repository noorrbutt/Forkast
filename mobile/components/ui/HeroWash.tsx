import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '../../theme';
import { heroWash } from '../../theme/tokens';

type HeroWashProps = {
  children: ReactNode;
  /** Bleeds past the screen gutter so the colour reaches the edges. */
  bleed?: number;
  /**
   * Whether to pull up into the space above, as well as out to the sides.
   *
   * On a screen with a header there is a header's worth of padding to reclaim,
   * and the wash should start under it rather than below it. On a screen
   * without one there is only the safe area inset, so pulling up puts the wash
   * and whatever sits on it into the status bar. The dashboard is the second
   * kind, and it is the only screen where this matters, which is why it is a
   * prop rather than a guess made inside here.
   */
  pullUp?: boolean;
};

/**
 * A soft field of colour under the one number a screen leads with.
 *
 * This is where the warmth comes from. The app was a near black page, a near
 * white page and a single orange, and structure alone could not fix that:
 * cards separating correctly from a flat background still reads as austere.
 * The reference apps get almost all of their character from a colour field
 * sitting under the hero rather than from anything structural, and that is the
 * one thing worth taking from them.
 *
 * Deliberately quiet. Low saturation, a narrow hue range, and stops that end on
 * the page colour so the wash dissolves into the screen instead of stopping at
 * a hard line. It should read as light falling on the page, not as decoration,
 * and the figure sitting on top of it still has to clear contrast, which is why
 * the stops stay close to the background rather than going for a bright mesh.
 *
 * One per screen, under the hero only. A second one would make both meaningless.
 */
export function HeroWash({ children, bleed = 24, pullUp = true }: HeroWashProps) {
  const { spacing, isDark } = useTheme();

  return (
    <View style={{ marginHorizontal: -bleed, marginTop: pullUp ? -bleed : 0 }}>
      <LinearGradient
        colors={(isDark ? heroWash.dark : heroWash.light) as [string, string, ...string[]]}
        // Slightly off axis, so the light has a direction and the field does
        // not read as a flat band, but mostly downward, and the last stop is
        // reached before the bottom edge.
        //
        // It ran corner to corner (0.1,0 to 0.9,1), which put the bottom-left
        // corner only 56% of the way along the gradient: the bottom edge was
        // still mid-wash on the left and met the page in a hard horizontal
        // line. Now every point on the bottom edge projects past 0.9, where
        // the colour is already exactly the page.
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.3, y: 1 }}
        locations={[0, 0.5, 0.9]}
        style={{
          paddingHorizontal: bleed,
          // The reclaimed margin is paid back as padding when it was taken, so
          // the content sits where it would have without the wash.
          paddingTop: (pullUp ? bleed : 0) + spacing.lg,
          paddingBottom: spacing.xxl,
        }}
      >
        {children}
      </LinearGradient>
    </View>
  );
}
