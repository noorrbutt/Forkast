import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useBurnToday, useClearBurn, useSetBurn } from '../hooks/useBurn';
import { describeError } from '../lib/api';
import { formatNumber } from '../lib/format';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme';
import { Dialog, Field } from './ui';

/** Matches ck_burn_logs_calories_plausible, so a typo is caught before a round trip. */
const MAX_BURN = 10_000;

type Props = {
  visible: boolean;
  onDismiss: () => void;
};

/**
 * Entering what you burned today, asked for rather than sitting there.
 *
 * This used to be a card on the dashboard holding a text field, a Save button
 * and a Clear button. A dashboard answers how today is going; a form on it is
 * not an answer, it is a piece of furniture that takes the same visual weight as
 * the numbers around it and is empty almost every time you look at the screen.
 * Every reference app shows burned as a small figure beside the hero and asks
 * for it only when you go looking.
 *
 * So the figure on the dashboard is the control now: tap it and this opens. The
 * number is still optional, nothing nags about it, and the dashboard reads the
 * same whether or not it has one.
 */
export function BurnDialog({ visible, onDismiss }: Props) {
  const { colors, spacing, type } = useTheme();
  const today = useBurnToday();
  const save = useSetBurn();
  const clear = useClearBurn();

  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);
  // Whether Save has been pressed yet, which is what lets an empty field stay
  // quiet until someone has actually asked for it to be saved.
  const [asked, setAsked] = useState(false);

  const saved = today.data;

  useEffect(() => {
    // Adopt the stored value, but never overwrite something being typed.
    if (!touched && saved) setDraft(String(saved.calories));
  }, [saved, touched]);

  /**
   * Reopening should start from what is stored, not from an abandoned draft.
   *
   * Clearing `touched` alone only did that when something was stored: the
   * seeding effect above cannot run while `saved` is null, so with no burn
   * entered today a typed-then-cancelled 500 stayed in the field and came back
   * pre-filled with Save enabled, while the dashboard still read 0. The dialog
   * claimed a number that had never been saved. Emptying the draft lets the
   * seeding effect refill it when there is something to refill it with, and
   * leaves it genuinely blank when there is not.
   */
  useEffect(() => {
    if (!visible) {
      setTouched(false);
      setAsked(false);
      setDraft('');
      save.reset();
      clear.reset();
    }
  }, [visible]);

  const trimmed = draft.trim();
  const parsed = Number(trimmed);
  // Number('') is 0 and Number('12a') is NaN, so both are checked rather than
  // relying on the parse alone.
  const valid = trimmed.length > 0 && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_BURN;
  const unchanged = saved != null && valid && parsed === saved.calories;
  const busy = save.isPending || clear.isPending;

  // Named once the field has something wrong in it, or once Save has been
  // pressed on an empty one. Before either, there is nothing to scold anybody
  // about and the hint would be answering a question nobody asked.
  const problem =
    (asked || trimmed.length > 0) && !valid
      ? `Enter a whole number between 0 and ${formatNumber(MAX_BURN)}.`
      : null;

  const onSave = () => {
    if (busy) return;
    // Pressing is what makes an empty field a problem worth naming.
    setAsked(true);
    if (!valid) return;
    // Nothing to send, so the dialog closing is the whole answer.
    if (unchanged) {
      onDismiss();
      return;
    }
    save.mutate(parsed, {
      onSuccess: () => {
        haptics.success();
        setTouched(false);
        onDismiss();
      },
      onError: () => haptics.error(),
    });
  };

  const onClear = () => {
    if (!saved) return;
    clear.mutate(saved.day, {
      onSuccess: () => {
        haptics.tap();
        setDraft('');
        setTouched(false);
        onDismiss();
      },
      onError: () => haptics.error(),
    });
  };

  const error = save.isError ? save.error : clear.isError ? clear.error : null;

  return (
    <Dialog
      visible={visible}
      onDismiss={busy ? () => undefined : onDismiss}
      title="Burned today"
      message="Optional. Add it if you tracked a workout or a long walk, and it comes off your total."
      actions={[
        {
          label: saved ? 'Update' : 'Save',
          variant: 'primary',
          onPress: onSave,
          // Live until the request is actually running. A primary action that
          // disables itself until the form is valid hides the affordance behind
          // the very thing it is inviting, so this one stays pressable and the
          // field says what is missing instead.
          disabled: busy,
          loading: save.isPending,
        },
        ...(saved
          ? [
              {
                label: 'Remove it',
                variant: 'secondary' as const,
                onPress: onClear,
                disabled: busy,
                loading: clear.isPending,
              },
            ]
          : []),
        { label: 'Cancel', variant: 'ghost' as const, onPress: onDismiss, disabled: busy },
      ]}
    >
      <View style={{ gap: spacing.md }}>
        <Field
          label="Calories"
          value={draft}
          onChangeText={(next) => {
            setTouched(true);
            // Strip anything that is not a digit as it is typed, so the numeric
            // keypad's stray characters never reach validation.
            setDraft(next.replace(/[^0-9]/g, ''));
          }}
          placeholder="e.g. 420"
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={onSave}
          editable={!busy}
          maxLength={5}
          hint={problem ?? undefined}
        />
        {error ? (
          <Text style={[type.caption, { color: colors.danger }]}>{describeError(error)}</Text>
        ) : null}
      </View>
    </Dialog>
  );
}
