import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

type DialogAction = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
};

type DialogProps = {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  /** One or two sentences. Longer copy belongs in children. */
  message?: string;
  icon?: IconName;
  /** Tints the icon disc and, for destructive dialogs, the confirm button. */
  tone?: 'neutral' | 'danger';
  children?: ReactNode;
  /** Rendered bottom to top in importance: the first is the primary action. */
  actions: DialogAction[];
};

/**
 * A dialog that appears over the page.
 *
 * Replaces two patterns that were both wrong. Alert.alert hands the decision to
 * the operating system, so it looks nothing like the app, cannot show a field,
 * and on web is a browser alert box. And expanding a destructive form inline
 * inside a scrolling screen means the thing you are confirming can scroll out of
 * sight while you confirm it.
 *
 * Actions stack rather than sit in a row. A row forces every label to be one or
 * two words, which is how confirmations end up saying "OK" when they could say
 * what is about to happen.
 */
export function Dialog({
  visible,
  onDismiss,
  title,
  message,
  icon,
  tone = 'neutral',
  children,
  actions,
}: DialogProps) {
  const { colors, radius, spacing, type } = useTheme();
  const accentish = tone === 'danger' ? colors.danger : colors.accent;
  const disc = tone === 'danger' ? colors.dangerSoft : colors.accentSoft;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      // Android's hardware back must dismiss, and this is also what makes the
      // dialog escapable on web without a mouse.
      statusBarTranslucent
    >
      {/* Tapping the scrim dismisses, which is the expected escape everywhere.
          The card below stops the press so a tap inside never closes it. */}
      <Pressable
        onPress={onDismiss}
        accessibilityLabel="Close"
        style={{
          flex: 1,
          backgroundColor: colors.scrim,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
        }}
      >
        <Pressable
          onPress={() => undefined}
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 420,
            borderRadius: radius.card,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.xl,
            gap: spacing.lg,
          }}
        >
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            {icon ? (
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: radius.pill,
                  backgroundColor: disc,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={icon} size={26} color={accentish} />
              </View>
            ) : null}
            <Text style={[type.title, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
            {message ? (
              <Text style={[type.body, { color: colors.muted, textAlign: 'center' }]}>
                {message}
              </Text>
            ) : null}
          </View>

          {children ? (
            // Scrolls because a dialog with a field in it can be taller than the
            // space left above a keyboard on a small phone.
            <ScrollView
              style={{ maxHeight: 280 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : null}

          <View style={{ gap: spacing.sm }}>
            {actions.map((action) => (
              <Button
                key={action.label}
                label={action.label}
                icon={action.icon}
                variant={action.variant ?? 'secondary'}
                size="lg"
                full
                disabled={action.disabled}
                loading={action.loading}
                onPress={action.onPress}
              />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
