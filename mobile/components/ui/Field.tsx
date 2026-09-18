import { useState } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '../../theme';

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
};

export function Field({ label, hint, style, onFocus, onBlur, ...rest }: FieldProps) {
  const { colors, radius, spacing, type } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.labelSoft, { color: colors.muted }]}>{label}</Text>
      <TextInput
        {...rest}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        style={[
          type.body,
          {
            color: colors.text,
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.input,
            // `outline`, not `border`. border is the decorative hairline
            // between surfaces and measures 1.52:1 against this fill, while the
            // guide asks 3:1 of anything proving it is a control. Chip, one
            // control away on the same screens, was already using outline at
            // 3.02:1, so a text field was the only control in the app failing a
            // rule its neighbour passed. 1.5 matches every other control edge.
            borderWidth: 1.5,
            borderColor: focused ? colors.accent : colors.outline,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md + 2,
          },
          style,
        ]}
      />
      {hint ? <Text style={[type.caption, { color: colors.muted }]}>{hint}</Text> : null}
    </View>
  );
}
