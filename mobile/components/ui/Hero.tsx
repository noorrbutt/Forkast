import { Text, View, useWindowDimensions } from 'react-native';

import { useTheme } from '../../theme';

type HeroProps = {
  /** The one value or headline this screen leads with. */
  value: string;
  /** Sits under the value, quiet and small. One short line. */
  caption?: string;
  /** Overrides the ink, for a value that carries a state such as being over. */
  color?: string;
  align?: 'left' | 'center';
};

/**
 * The single largest thing on a screen.
 *
 * At most one of these per screen. Two heroes is two screens, and the style
 * guide treats a second one as a rule violation rather than a judgement call.
 *
 * The step down lives here rather than in every caller, because the last time a
 * size rule lived at the call site a chip rendered "Maint..." and the bug had to
 * be found by a user. A hero holding "12,450" at 64pt on a narrow phone with the
 * system text size raised would do exactly the same thing, so the component
 * measures what it was given and shrinks itself instead.
 */
export function Hero({ value, caption, color, align = 'left' }: HeroProps) {
  const { colors, spacing, type } = useTheme();
  const { width, fontScale } = useWindowDimensions();

  // A rough width per glyph at the base size. Lining figures in a light
  // grotesque run near 0.55em, and the gutters take 48 of the screen.
  const available = width - spacing.xl * 2;
  const estimated = value.length * type.hero.fontSize * 0.55 * fontScale;

  // Two steps, never smaller. Below this the hero stops being a hero and the
  // screen should be composed differently instead.
  const fontSize =
    estimated <= available
      ? type.hero.fontSize
      : estimated <= available * 1.25
        ? 52
        : 44;

  return (
    <View style={{ gap: spacing.xs, alignItems: align === 'center' ? 'center' : 'flex-start' }}>
      <Text
        accessibilityRole="header"
        style={[
          type.hero,
          {
            color: color ?? colors.text,
            fontSize,
            // The token's line height is tuned to 64, so it has to travel with
            // the size or a stepped down hero sits in a box meant for a taller
            // one.
            lineHeight: Math.round(fontSize * 1.09),
            textAlign: align,
          },
        ]}
        // Wrapping a hero looks worse than shrinking it, and the sizes above
        // are chosen so it never has to do either.
        numberOfLines={1}
        adjustsFontSizeToFit={false}
      >
        {value}
      </Text>
      {caption ? (
        <Text style={[type.body, { color: colors.muted, textAlign: align }]}>{caption}</Text>
      ) : null}
    </View>
  );
}
