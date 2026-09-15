import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

type SectionLabelProps = {
  children: ReactNode;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Tiny uppercase letterspaced label, the quiet half of the editorial pairing. */
export function SectionLabel({ children, right, style }: SectionLabelProps) {
  const { colors, type } = useTheme();

  return (
    <View style={[styles.row, style]}>
      <Text style={[type.label, { color: colors.muted }]}>{children}</Text>
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
