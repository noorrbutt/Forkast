import { Text, View } from 'react-native';

import { useTheme } from '../../theme';

/**
 * A hairline with the word "or" sitting in it.
 *
 * It separates two ways of doing the same thing, which is the only job it has
 * and the reason it is not just a gap. Two buttons stacked with space between
 * them read as step one and step two; the same two with "or" between them read
 * as a choice, and on an auth screen that difference decides whether someone
 * fills in a form they did not need to fill in.
 *
 * Lowercase and at caption size, because it is a conjunction rather than a
 * heading. The tracked out uppercase `label` token would make the quietest
 * thing on the screen look like a section title, which is the generated-design
 * tell the type scale already warns about.
 *
 * `border`, not `outline`: this is decoration between things rather than
 * anything claiming to be pressable, and it is the one case border is for.
 *
 * Hidden from screen readers. Spoken aloud between two buttons "or" is noise,
 * and the buttons already name themselves.
 */
export function OrRule() {
  const { colors, layout, spacing, type } = useTheme();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}
    >
      <View style={{ flex: 1, height: layout.hairline, backgroundColor: colors.border }} />
      <Text style={[type.caption, { color: colors.muted }]}>or</Text>
      <View style={{ flex: 1, height: layout.hairline, backgroundColor: colors.border }} />
    </View>
  );
}
