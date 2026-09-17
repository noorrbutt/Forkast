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

  const saved = today.data;

  useEffect(() => {
    // Adopt the stored value, but never overwrite something being typed.
    if (!touched && saved) setDraft(String(saved.calories));
  }, [saved, touched]);

  // Reopening should start from what is stored, not from an abandoned draft.
  useEffect(() => {
    if (!visible) {
      setTouched(false);
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

  const problem =
    trimmed.length > 0 && !valid
      ? `Enter a whole number between 0 and ${formatNumber(MAX_BURN)}.`
      : null;

  const onSave = () => {
    if (!valid || unchanged) return;
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
      icon="burn"
      actions={[
        {
          label: saved ? 'Update' : 'Save',
          variant: 'primary',
          onPress: onSave,
          disabled: !valid || unchanged || busy,
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
