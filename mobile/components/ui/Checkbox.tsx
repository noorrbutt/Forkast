import { Pressable, Text, View } from 'react-native';

import { useTheme } from '../../theme';

type CheckboxProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The sentence beside the box. It is the accessible name, so it must read on its own. */
  label: string;
  /** What ticking it will do, for a screen reader. */
  accessibilityHint?: string;
  disabled?: boolean;
};

/**
 * A box you tick, for the one thing a box you tick is honestly for: consent.
 *
 * It starts unticked and there is no `defaultChecked`. That is not a styling
 * decision. Consent under GDPR Art. 4(11) has to be a "clear affirmative
 * action", and a pre-ticked box is the example regulators reach for when
 * explaining what does not count; the CJEU said so directly in Planet49. So the
 * component simply offers no way to render one already ticked, because the way
 * this goes wrong is somebody adding a default later for a good-sounding reason.
 *
 * The whole row is the target, not the 20pt square. A 20pt box is half the 44pt
 * minimum both platforms ask for, and the label is the part people aim at
 * anyway.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  accessibilityHint,
  disabled = false,
}: CheckboxProps) {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      // role=checkbox plus state is what makes a reader say "tick box, not
      // ticked" rather than reading the sentence and leaving the person with no
      // idea there is anything to do.
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        // The row carries the 44pt minimum so the box does not have to be
        // drawn at an ungainly size to reach it.
        minHeight: 44,
        paddingVertical: spacing.sm,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        // Decorative: the Pressable above is the control and carries the name,
        // so a reader that also announced this would say everything twice.
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.input / 3,
          borderWidth: 1.5,
          borderColor: checked ? colors.accentFill : colors.outline,
          backgroundColor: checked ? colors.accentFill : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          // Nudged down so the box sits on the first line of a label that wraps
          // onto three, rather than floating against the top of the block.
          marginTop: 2,
        }}
      >
        {checked ? (
          <Text style={{ color: colors.accentInk, fontSize: 14, lineHeight: 16 }}>✓</Text>
        ) : null}
      </View>
      <Text style={[type.caption, { color: colors.text, flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}
