import { Text } from 'react-native';

import { useTheme } from '../../theme';

/**
 * The label above a group of controls that is not a text input.
 *
 * Deliberately the same 12/500 sentence case that `Field` and `Select` already
 * print above themselves, so a row of chips and a row of inputs read as the
 * same rank of question. It is not a section heading, and it is not `label`,
 * the 11px uppercase style the guide restricts to the tab bar and chart axes.
 *
 * This existed twice, which is the whole reason it now lives here. The log form
 * had it as a local helper, with the argument above written out in full, while
 * the meal screen drew the same four questions, Rating, Fun scale, Who was
 * there and Serving size, with `SectionLabel` at 16/600. One of the two had to
 * be wrong, and the log form's own critique says which: dressing a chip row as
 * a section is what made every question on that screen look like a section.
 */
export function ControlLabel({ children }: { children: string }) {
  const { colors, type } = useTheme();

  return <Text style={[type.labelSoft, { color: colors.muted }]}>{children}</Text>;
}
