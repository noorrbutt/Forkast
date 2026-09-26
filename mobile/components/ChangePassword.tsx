import axios from 'axios';
import { useState } from 'react';
import { View } from 'react-native';

import { useChangePassword } from '../hooks/useAuth';
import { describeError } from '../lib/api';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme';
import { Dialog, Field, FormError, ListRow } from './ui';

/** What the server will accept, checked here so a typo never costs a round trip. */
const MIN_LENGTH = 8;

/**
 * Turn a failed change into something worth reading.
 *
 * A 403 has exactly one cause on this endpoint, and "Request failed with status
 * 403" tells someone who mistyped their own password nothing at all. Every
 * other failure is genuinely unknown here, so it keeps the shared wording.
 */
function explain(error: unknown): string {
  if (axios.isAxiosError(error) && error.response?.status === 403) {
    return 'That is not your current password.';
  }
  return describeError(error);
}

/**
 * Changing the password, as a settings row that opens a dialog.
 *
 * All three fields live in the dialog rather than expanding into the screen,
 * because a password form that pushes the rest of the page around is a form
 * that can scroll out from under the keyboard halfway through being filled in.
 *
 * Both rules are checked before anything is sent. The server would answer 422
 * for a short password, but a red line arriving a second later, from the
 * network, for something the app already knew, is the slowest possible way to
 * say "eight characters".
 */
export function ChangePassword({ last = false }: { last?: boolean }) {
  const { spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const change = useChangePassword();

  const clear = () => {
    setOpen(false);
    // Nothing typed here survives the dialog closing. A password left sitting
    // in state is a password sitting in a heap dump.
    setCurrent('');
    setNext('');
    setConfirm('');
    setProblem(null);
    change.reset();
  };

  // Backing out is refused mid request, because the dialog is the only thing
  // showing that a request is happening at all.
  const cancel = () => {
    if (change.isPending) return;
    clear();
  };

  const submit = () => {
    if (change.isPending) return;

    if (!current) {
      setProblem('Enter your current password.');
      return;
    }
    if (next.length < MIN_LENGTH) {
      setProblem(`Your new password needs at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setProblem('The two new passwords do not match.');
      return;
    }

    setProblem(null);
    change.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          haptics.success();
          setChanged(true);
          clear();
        },
        onError: () => haptics.error(),
      },
    );
  };

  // What the app worked out itself comes first, since it is the thing the user
  // can fix without waiting for anyone.
  const message = problem ?? (change.isError ? explain(change.error) : null);

  return (
    <>
      <ListRow
        label="Change password"
        hint={changed ? 'Password updated.' : undefined}
        onPress={() => setOpen(true)}
        last={last}
      />

      <Dialog
        visible={open}
        onDismiss={cancel}
        title="Change your password"
        message="Pick something you have not used here before."
        actions={[
          {
            label: 'Update password',
            variant: 'primary',
            onPress: submit,
            disabled: change.isPending,
            loading: change.isPending,
          },
          {
            label: 'Cancel',
            variant: 'secondary',
            onPress: cancel,
            disabled: change.isPending,
          },
        ]}
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Current password"
            value={current}
            onChangeText={setCurrent}
            placeholder="Your current password"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            editable={!change.isPending}
          />
          <Field
            label="New password"
            value={next}
            onChangeText={setNext}
            placeholder="Your new password"
            hint={`At least ${MIN_LENGTH} characters.`}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            reveal
            textContentType="newPassword"
            editable={!change.isPending}
          />
          <Field
            label="Confirm new password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Type it again"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="newPassword"
            editable={!change.isPending}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          {message ? (
            <FormError>{message}</FormError>
          ) : null}
        </View>
      </Dialog>
    </>
  );
}
