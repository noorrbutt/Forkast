import { useState } from 'react';
import { Text, View } from 'react-native';

import { useDeleteAccount } from '../hooks/useAuth';
import { describeError } from '../lib/api';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme';
import { Dialog, Field, ListGroup, ListRow } from './ui';

/**
 * Closing the account for good.
 *
 * It is a row in a group of its own rather than a lone pill under the page,
 * which is what it used to be. Floating on its own it read as something that
 * had fallen off the layout, and the ghost variant it wore has a transparent
 * fill and a transparent border, so the only thing proving it was a control at
 * all was the colour of its text.
 *
 * The confirmation is a dialog rather than an inline expansion. Expanding put
 * the password field and the warning inside a scrolling page, where the very
 * sentence explaining what is about to be destroyed can be scrolled off while
 * the destructive button stays on screen.
 *
 * Quiet, but not hidden. An app that stores what someone eats every day owes
 * them a way out that does not involve writing an email, and Play requires one
 * in the app for anything with a signup.
 */
export function DeleteAccount() {
  const { colors, spacing, type } = useTheme();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  // Whether the confirm has been pressed on an empty field yet. The button is
  // live either way; this only decides whether the field says what is missing.
  const [asked, setAsked] = useState(false);
  const remove = useDeleteAccount();

  const close = () => {
    if (remove.isPending) return;
    setOpen(false);
    setPassword('');
    setAsked(false);
    remove.reset();
  };

  const confirm = () => {
    if (remove.isPending) return;
    // The button was live, so a press with nothing typed is answered by saying
    // what is missing rather than by having been unpressable. Typing the
    // password is still the confirmation: an empty press deletes nothing.
    setAsked(true);
    if (!password) {
      haptics.error();
      return;
    }
    remove.mutate(password, {
      // No success handler: deleting signs the user out, which unmounts this
      // screen. Anything set here would be set on a dead component.
      onError: () => haptics.error(),
    });
  };

  return (
    <>
      <ListGroup title="Danger zone">
        <ListRow
          icon="trash"
          label="Delete my account"
          hint="Everything you have logged goes with it."
          tone="danger"
          onPress={() => setOpen(true)}
          last
        />
      </ListGroup>

      <Dialog
        visible={open}
        onDismiss={close}
        title="Delete your account?"
        message="Every meal, streak and plan goes with it. This cannot be undone."
        icon="trash"
        tone="danger"
        actions={[
          {
            label: 'Delete for good',
            variant: 'danger',
            icon: 'trash',
            onPress: confirm,
            // Live until the request is running. A primary action that disables
            // itself until the form is valid hides the affordance behind the
            // thing it invites, so this one stays pressable and the field below
            // says what is missing.
            disabled: remove.isPending,
            loading: remove.isPending,
          },
          {
            label: 'Keep my account',
            variant: 'secondary',
            onPress: close,
            disabled: remove.isPending,
          },
        ]}
      >
        <View style={{ gap: spacing.lg }}>
          <Text style={[type.caption, { color: colors.muted }]}>
            This removes your meals, streaks, burned calories and plans, and signs out every device.
            Restaurants you added stay, since other people log against them.
          </Text>

          <Field
            label="Confirm your password"
            value={password}
            placeholder="Your password"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            editable={!remove.isPending}
            onChangeText={(next) => {
              setAsked(false);
              setPassword(next);
            }}
            hint={asked && !password ? 'Type your password to confirm.' : undefined}
          />

          {remove.isError ? (
            <Text style={[type.caption, { color: colors.danger }]}>
              {describeError(remove.error)}
            </Text>
          ) : null}
        </View>
      </Dialog>
    </>
  );
}
