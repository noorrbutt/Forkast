import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

type SectionLabelProps = {
  children: ReactNode;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * A section heading, in sentence case.
 *
 * It was an 11px uppercase letterspaced eyebrow, sitting above nearly every
 * block on seven screens. That treatment is a named tell of generated design,
 * and repeating it everywhere is also why no section looked more important than
 * any other. A heading now looks like a heading, and a section whose content is
 * obvious should simply not have one.
 */
export function SectionLabel({ children, right, style }: SectionLabelProps) {
  const { colors, type } = useTheme();

  return (
    <View style={[styles.row, style]}>
      <Text style={[type.subtitle, { color: colors.text }]}>{children}</Text>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
