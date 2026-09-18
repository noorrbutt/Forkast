import { useState } from 'react';
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
/**
 * Width of one glyph at the base size, as a fraction of em.
 *
 * Measured rather than guessed: Figtree's tabular figures have an advance of
 * exactly 0.5em, checked in a browser with the font loaded. It was 0.55, which
 * was a reasonable guess at a light grotesque and is now simply wrong, and
 * wrong in the safe direction, so the hero stepped down about 10 percent
 * earlier than it needed to.
 *
 * Letters are wider than figures, so this is deliberately not the narrowest
 * value: a hero is usually a number, and the one headline hero in the app
 * ("Forkast.") has to fit too.
 */
const GLYPH_EM = 0.5;

export function Hero({ value, caption, color, align = 'left' }: HeroProps) {
  const { colors, spacing, type } = useTheme();
  const { width, fontScale } = useWindowDimensions();

  /**
   * The width this hero actually has, not the width of the screen.
   *
   * The screen was the wrong question. On welcome the hero sits in a 300pt
   * column with 24 of padding a side, so the real box is 252 while the screen
   * based guess said 342: the component believed it had a third more room than
   * it did, on the one screen whose hero is a word rather than a number, which
   * is exactly where truncation is least acceptable. The window is only the
   * starting guess now, replaced by the measured box on first layout.
   */
  const [box, setBox] = useState<number | null>(null);
  const available = box ?? width - spacing.xl * 2;
  const estimated = value.length * type.hero.fontSize * GLYPH_EM * fontScale;

  // Two steps, never smaller. Below this the hero stops being a hero and the
  // screen should be composed differently instead.
  const fontSize =
    estimated <= available
      ? type.hero.fontSize
      : estimated <= available * 1.25
        ? 52
        : 44;

  return (
    <View
      onLayout={(event) => {
        const measured = event.nativeEvent.layout.width;
        // Only on a real change, or this sets state on every layout pass.
        if (measured > 0 && measured !== box) setBox(measured);
      }}
      style={{ gap: spacing.xs, alignItems: align === 'center' ? 'center' : 'flex-start' }}
    >
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
