import { type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useTheme } from '../../theme';
import { heroWash } from '../../theme/tokens';

/**
 * A full bleed band of colour whose bottom edge curves down in the middle.
 *
 * Drawn as one SVG path rather than with a border radius, and that is not a
 * preference. React Native radii are circular per corner with no elliptical
 * form, so a 390 by 48 view asking for a 195pt bottom radius gets clamped to 48
 * and comes out as a stadium with a flat run between two round ends. They also
 * curve the wrong way: a corner radius pulls the edge up at the sides and
 * leaves the middle lowest, which is the inverse of this shape.
 *
 * One path, nothing clipped, so it is identical on iOS, Android and web. The
 * alternative, clipping a real image or a gradient view to this outline, needs
 * ForeignObject to clip a non SVG child and that is unreliable on Android.
 */

/** How far the middle of the edge dips below its sides. */
const DIP = 48;

/**
 * What has to fit underneath: headline, body, two buttons and the space
 * between them, measured from the real tokens rather than guessed.
 */
const CONTENT_FLOOR = 360;

/** Never so short that it stops reading as a field of colour. */
const MIN_HEIGHT = 240;

/** The share of a tall screen this takes when nothing else is pressing. */
const SHARE = 0.55;

export function ArchHero({ children }: { children?: ReactNode }) {
  const { isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /**
   * Clamped rather than a flat percentage.
   *
   * At a fixed share the content below stops fitting above the fold on a small
   * phone: on an SE the stack underneath needs 351pt and a 57 percent arch
   * leaves 287. The clamp keeps the silhouette identical at every size and
   * gives the text the room it actually needs first.
   */
  const archHeight = Math.max(
    MIN_HEIGHT,
    Math.min(height * SHARE, height - insets.bottom - CONTENT_FLOOR),
  );

  const edge = archHeight - DIP;
  // A quadratic's midpoint is (start + 2 x control + end) / 4, so a control at
  // edge + 2 x DIP puts the lowest point exactly DIP below the sides.
  const control = edge + DIP * 2;
  const stops = isDark ? heroWash.dark : heroWash.light;

  return (
    <View style={{ width, height: archHeight }}>
      <Svg width={width} height={archHeight} style={{ position: 'absolute' }}>
        <Defs>
          {/* Off axis, the same angle the wash elsewhere uses, so the light has
              a direction instead of reading as a flat band. */}
          <LinearGradient id="archWash" x1="10%" y1="0%" x2="90%" y2="100%">
            {stops.map((stop, index) => (
              <Stop
                key={stop}
                offset={`${[0, 55, 100][index] ?? 100}%`}
                stopColor={stop}
                stopOpacity={1}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Path
          d={`M0 0 L${width} 0 L${width} ${edge} Q${width / 2} ${control} 0 ${edge} Z`}
          fill="url(#archWash)"
        />
      </Svg>

      {/* Centred in the visible band rather than in the box, and offset by the
          safe area so the status bar does not make it sit visually high. */}
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: insets.top,
          paddingBottom: DIP,
          backgroundColor: 'transparent',
        }}
      >
        {children}
      </View>
    </View>
  );
}
