import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

type FrostedProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  testID?: string;
  pointerEvents?: ViewProps['pointerEvents'];
};

/**
 * A translucent frosted layer. The solid fallback colour sits underneath the
 * BlurView so the surface still reads as a surface on Android in Expo Go,
 * where expo-blur degrades to a plain translucent view.
 */
export function Frosted({ children, style, intensity = 40, testID, pointerEvents }: FrostedProps) {
  const { colors } = useTheme();

  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      style={[{ backgroundColor: colors.blurFallback, overflow: 'hidden' }, style]}
    >
      <BlurView intensity={intensity} tint={colors.blurTint} style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}
