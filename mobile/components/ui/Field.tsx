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
            borderWidth: 1,
            borderColor: focused ? colors.accent : colors.border,
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
