import { useState } from 'react';
import { Text, View } from 'react-native';

import { useDeleteAccount } from '../hooks/useAuth';
import { useContinueWithGoogle } from '../hooks/useContinueWithGoogle';
import { describeError } from '../lib/api';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme';
import { Dialog, Field, GoogleButton, ListGroup, ListRow } from './ui';

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
 *
 * ---
 *
 * Two dialogs in one, because there are two kinds of account.
 *
 * An account with a password is asked for it, exactly as before. An account
 * created through "Continue with Google" has no password and cannot be given
 * one, so asking for a password would leave it with no way out at all, which is
 * the one outcome this screen exists to prevent. It is sent back through
 * Google instead, and pressing that button is both the confirmation and the
 * deletion: there is nothing to type, so there is nothing to type before it.
 *
 * Deleting such an account on the session alone was the obvious shortcut and is
 * deliberately not taken. The threat here is a phone left unlocked on a table,
 * and a session is exactly what whoever picked it up is already holding.
 *
 * `reveal` is not passed to the password field, and that is not an oversight.
 * This field asks someone to reproduce something they already know rather than
 * to choose something new, so there is nothing for them to check their typing
 * against, and an eye here only offers the person behind them in the queue a
 * look at the password before it is used somewhere else.
 */
export function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
  const { colors, spacing, type } = useTheme();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  // Whether the confirm has been pressed on an empty field yet. The button is
  // live either way; this only decides whether the field says what is missing.
  const [asked, setAsked] = useState(false);
  const remove = useDeleteAccount();
  // The same dance the two auth screens do, with a different thing done to the
  // token at the end of it: deleting this account rather than opening one.
  const google = useContinueWithGoogle((idToken) =>
    remove.mutateAsync({ id_token: idToken }, { onError: () => haptics.error() }),
  );

  const busy = remove.isPending || google.busy;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setPassword('');
    setAsked(false);
    google.clearProblem();
    remove.reset();
  };

  const confirm = () => {
    if (busy) return;
    // The button was live, so a press with nothing typed is answered by saying
    // what is missing rather than by having been unpressable. Typing the
    // password is still the confirmation: an empty press deletes nothing.
    setAsked(true);
    if (!password) {
      haptics.error();
      return;
    }
    remove.mutate(
      { password },
      {
        // No success handler: deleting signs the user out, which unmounts this
        // screen. Anything set here would be set on a dead component.
        onError: () => haptics.error(),
      },
    );
  };

  const problem = google.problem ?? (remove.isError ? describeError(remove.error) : null);

  return (
    <>
      <ListGroup title="Danger zone">
        <ListRow
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
        actions={
          hasPassword
            ? [
                {
                  label: 'Delete for good',
                  variant: 'danger',
                  icon: 'trash',
                  onPress: confirm,
                  // Live until the request is running. A primary action that
                  // disables itself until the form is valid hides the affordance
                  // behind the thing it invites, so this one stays pressable and
                  // the field below says what is missing.
                  disabled: busy,
                  loading: remove.isPending,
                },
                {
                  label: 'Keep my account',
                  variant: 'secondary',
                  onPress: close,
                  disabled: busy,
                },
              ]
            : [
                // No "Delete for good" on this side. The Google button below IS
                // the destructive action, and a second button that only works
                // after the first one would be a step that does nothing.
                {
                  label: 'Keep my account',
                  variant: 'secondary',
                  onPress: close,
                  disabled: busy,
                },
              ]
        }
      >
        <View style={{ gap: spacing.lg }}>
          <Text style={[type.caption, { color: colors.muted }]}>
            This removes your meals, streaks, burned calories and plans, and signs out every device.
            Restaurants you added stay, since other people log against them.
          </Text>

          {hasPassword ? (
            <Field
              label="Confirm your password"
              value={password}
              placeholder="Your password"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="password"
              editable={!busy}
              onChangeText={(next) => {
                setAsked(false);
                setPassword(next);
              }}
              hint={asked && !password ? 'Type your password to confirm.' : undefined}
            />
          ) : (
            <View style={{ gap: spacing.md }}>
              <Text style={[type.caption, { color: colors.muted }]}>
                You signed up with Google, so there is no password to confirm. Sign in with Google
                once more and the account is deleted.
              </Text>
              <GoogleButton
                onPress={() => void google.start()}
                loading={busy}
                disabled={!google.ready}
              />
            </View>
          )}

          {problem ? (
            <Text style={[type.caption, { color: colors.danger }]}>{problem}</Text>
          ) : null}
        </View>
      </Dialog>
    </>
  );
}
