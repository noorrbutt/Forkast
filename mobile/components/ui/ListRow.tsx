import { type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { Icon, type IconName } from './Icon';

type ListRowProps = {
  icon?: IconName;
  label: string;
  /** The current setting, shown on the right where the eye scans for it. */
  value?: string;
  /** A second line under the label, for anything that needs explaining. */
  hint?: string;
  onPress?: () => void;
  /** Colours the icon and label, for a destructive row. */
  tone?: 'neutral' | 'danger';
  /** Replaces the chevron, for a switch or a badge. */
  trailing?: ReactNode;
  disabled?: boolean;
  /** Hides the divider, for the last row in a group. */
  last?: boolean;
};

/**
 * One line in a settings group.
 *
 * The profile screen was a column of cards each containing a heading, a
 * paragraph and a control, which is why it read as a form rather than as a
 * profile. Settings screens everywhere use a row: an icon to find it by, a
 * label, the current value on the right, and a chevron if there is somewhere to
 * go. That is the shape people already know, and knowing it is most of what
 * makes a screen feel ordinary rather than improvised.
 */
export function ListRow({
  icon,
  label,
  value,
  hint,
  onPress,
  tone = 'neutral',
  trailing,
  disabled = false,
  last = false,
}: ListRowProps) {
  const { colors, radius, spacing, type } = useTheme();
  const ink = tone === 'danger' ? colors.danger : colors.text;
  const iconTint = tone === 'danger' ? colors.danger : colors.muted;
  const interactive = Boolean(onPress) && !disabled;

  return (
    <Pressable
      onPress={onPress}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityValue={value ? { text: value } : undefined}
      accessibilityHint={hint}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        // Comfortably past the 48dp Android minimum even with one line of text.
        minHeight: 56,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed && interactive ? colors.surfaceAlt : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {icon ? (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.pill,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={17} color={iconTint} />
        </View>
      ) : null}

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: ink, fontWeight: '500' }]}>{label}</Text>
        {hint ? <Text style={[type.caption, { color: colors.muted }]}>{hint}</Text> : null}
      </View>

      {/* Wraps rather than truncating. It was held to one line, which is how a
          setting could report itself as "America/Argentina/Bue..." and leave
          the one thing the row exists to tell you unreadable. Shrinking before
          the label does, because the label names what the value belongs to. */}
      {value ? (
        <Text style={[type.body, { color: colors.muted, flexShrink: 1, textAlign: 'right' }]}>
          {value}
        </Text>
      ) : null}

      {trailing ?? (interactive ? <Icon name="forward" size={18} color={colors.muted} /> : null)}
    </Pressable>
  );
}

/**
 * The card a group of rows sits in.
 *
 * Exists so screens stop hand rolling a Card with its own padding for every
 * group, which is how two groups end up a few pixels different from each other.
 */
export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  const { colors, radius, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {title ? (
        <Text style={[type.labelSoft, { color: colors.muted, paddingHorizontal: spacing.xs }]}>
          {title}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: radius.card,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}
