import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useBurnToday, useClearBurn, useSetBurn } from '../hooks/useBurn';
import { describeError } from '../lib/api';
import { formatNumber } from '../lib/format';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme';
import { Button, Card, Field, SectionLabel } from './ui';

/** Matches ck_burn_logs_calories_plausible, so a typo is caught before a round trip. */
const MAX_BURN = 10_000;

/**
 * Today's burned calories, typed by hand.
 *
 * Optional by design: the card invites a number and is perfectly happy without
 * one. Nothing else in the app nags about it, and the dashboard reads the same
 * whether or not it is filled in.
 *
 * There is no estimation here on purpose. The figure comes off the user's watch
 * or treadmill, and guessing at something they already know would be worse than
 * asking.
 */
export function BurnCard() {
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

  const trimmed = draft.trim();
  const parsed = Number(trimmed);
  // Number('') is 0 and Number('12a') is NaN, so both are checked rather than
  // relying on the parse alone.
  const valid =
    trimmed.length > 0 && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_BURN;
  const unchanged = saved != null && valid && parsed === saved.calories;

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
      },
      onError: () => haptics.error(),
    });
  };

  const busy = save.isPending || clear.isPending;

  return (
    <Card>
      <View style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          <SectionLabel>Burned today</SectionLabel>
          <Text style={[type.caption, { color: colors.muted }]}>
            {saved
              ? 'Taken off your total on the dashboard.'
              : 'Optional. Add it if you tracked a workout or a long walk.'}
          </Text>
        </View>

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

        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Button
            label={save.isPending ? 'Saving' : saved ? 'Update' : 'Save'}
            onPress={onSave}
            disabled={!valid || unchanged || busy}
            loading={save.isPending}
          />
          {saved ? (
            <Button
              label="Clear"
              variant="ghost"
              onPress={onClear}
              disabled={busy}
              loading={clear.isPending}
            />
          ) : null}
        </View>

        {save.isError ? (
          <Text style={[type.caption, { color: colors.danger }]}>{describeError(save.error)}</Text>
        ) : null}
        {clear.isError ? (
          <Text style={[type.caption, { color: colors.danger }]}>{describeError(clear.error)}</Text>
        ) : null}
      </View>
    </Card>
  );
}
