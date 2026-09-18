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
            // Focus thickens the edge as well as colouring it, and the padding
            // gives back exactly what the extra width takes, so the box does not
            // move under the cursor. Colour on its own was the whole signal
            // before, which section 3 forbids: someone who cannot separate
            // saffron from grey had no way to tell which field they were in.
            borderWidth: focused ? 2.5 : 1.5,
            borderColor: focused ? colors.accent : colors.outline,
            paddingHorizontal: focused ? spacing.lg - 1 : spacing.lg,
            paddingVertical: focused ? spacing.md + 1 : spacing.md + 2,
          },
          style,
        ]}
      />
      {hint ? <Text style={[type.caption, { color: colors.muted }]}>{hint}</Text> : null}
    </View>
  );
}
