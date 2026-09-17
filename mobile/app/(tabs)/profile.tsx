import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { DeleteAccount } from '../../components/DeleteAccount';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  Loading,
  Screen,
  SectionLabel,
} from '../../components/ui';
import { useAuth, useMe } from '../../hooks/useAuth';
import { useUpdateProfile } from '../../hooks/useProfile';
import { useReminders } from '../../hooks/useReminders';
import { describeError } from '../../lib/api';
import { GOAL_BLURBS, GOAL_LABELS, formatDate, formatNumber } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { GOALS, type Goal } from '../../lib/types';
import { useTheme } from '../../theme';

/** The range the server accepts, checked here so a typo never costs a 422. */
const MIN_TARGET = 800;
const MAX_TARGET = 10_000;

function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[type.subtitle, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

/**
 * The daily calorie target.
 *
 * The goal chips above this are a mood rather than a measurement: nothing in
 * the app can agree or disagree with "bulk". A number can be met or missed, so
 * this is the one control on the screen the dashboard reads back.
 *
 * Optional by design. Plenty of people do not want a number to fall short of,
 * and taking it back is its own button rather than a side effect of emptying
 * the field, because an empty field is also what half typed looks like.
 */
function TargetCard({ target }: { target: number | null }) {
  const { colors, spacing, type } = useTheme();
  // Two mutations off the one hook, so a save and a clear keep their own
  // pending and error state instead of one spinner sitting on both buttons.
  const save = useUpdateProfile();
  const clear = useUpdateProfile();

  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    // Adopt the stored value, but never overwrite something being typed.
    if (!touched && target != null) setDraft(String(target));
  }, [target, touched]);

  const trimmed = draft.trim();
  const parsed = Number(trimmed);
  // Number('') is 0 and Number('2a') is NaN, so both are checked rather than
  // relying on the parse alone.
  const valid =
    trimmed.length > 0 &&
    Number.isInteger(parsed) &&
    parsed >= MIN_TARGET &&
    parsed <= MAX_TARGET;
  const unchanged = valid && parsed === target;

  const problem =
    trimmed.length > 0 && !valid
      ? `Enter a whole number between ${formatNumber(MIN_TARGET)} and ${formatNumber(MAX_TARGET)}.`
      : null;

  const onSave = () => {
    if (!valid || unchanged) return;
    save.mutate(
      { daily_calorie_target: parsed },
      {
        onSuccess: () => {
          haptics.success();
          setTouched(false);
        },
        onError: () => haptics.error(),
      },
    );
  };

  const onClear = () => {
    if (target == null) return;
    clear.mutate(
      { daily_calorie_target: null },
      {
        onSuccess: () => {
          haptics.tap();
          setDraft('');
          setTouched(false);
        },
        onError: () => haptics.error(),
      },
    );
  };

  const busy = save.isPending || clear.isPending;

  return (
    <Card>
      <View style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          <SectionLabel>Daily calorie target</SectionLabel>
          <Text style={[type.caption, { color: colors.muted }]}>
            {target != null
              ? 'Your dashboard measures the day against this and shows what is left.'
              : 'Optional. Set one and the dashboard shows what is left of the day, not just a total.'}
          </Text>
        </View>

        <Field
          label="Calories a day"
          value={draft}
          onChangeText={(next) => {
            setTouched(true);
            // Strip anything that is not a digit as it is typed, so the numeric
            // keypad's stray characters never reach validation.
            setDraft(next.replace(/[^0-9]/g, ''));
          }}
          placeholder="e.g. 2200"
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={onSave}
          editable={!busy}
          maxLength={5}
          hint={problem ?? undefined}
        />

        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Button
            label={target != null ? 'Update target' : 'Set target'}
            onPress={onSave}
            disabled={!valid || unchanged || busy}
            loading={save.isPending}
          />
          {target != null ? (
            <Button
              label="Clear target"
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

export default function ProfileScreen() {
  const { colors, spacing, type } = useTheme();
  const { signOut } = useAuth();
  const me = useMe();
  const updateProfile = useUpdateProfile();
  const reminders = useReminders();

  const user = me.data;
  const goal = user?.goal ?? null;
  const localZone = deviceTimezone();
  const zoneMismatch = Boolean(localZone && user && user.timezone !== localZone);
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const setGoal = (next: Goal) => {
    if (next === goal || updateProfile.isPending) return;
    updateProfile.mutate({ goal: next });
  };

  return (
    <Screen title="Profile" eyebrow="Your account">
      {me.isLoading ? <Loading label="Loading your profile" /> : null}

      {me.isError && !user ? (
        <ErrorState
          title="Profile unavailable"
          message={describeError(me.error)}
          onRetry={() => void me.refetch()}
        />
      ) : null}

      {user ? (
        <>
          <Card>
            <View style={{ gap: spacing.lg }}>
              <Row label="Signed in as" value={user.email} />
              <Row label="Timezone" value={user.timezone ?? 'Not set'} />
              <Row label="Member since" value={formatDate(user.created_at) || 'Today'} />
            </View>
          </Card>

          <Card>
            <View style={{ gap: spacing.lg }}>
              <SectionLabel>Goal</SectionLabel>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {GOALS.map((option) => (
                  <Chip
                    key={option}
                    label={GOAL_LABELS[option]}
                    selected={goal === option}
                    disabled={updateProfile.isPending}
                    onPress={() => setGoal(option)}
                    style={{ flex: 1, alignItems: 'center' }}
                  />
                ))}
              </View>
              <Text style={[type.caption, { color: colors.muted }]}>
                {goal ? GOAL_BLURBS[goal] : 'Pick a goal and the meal plans will follow it.'}
              </Text>
              {updateProfile.isError ? (
                <Text style={[type.caption, { color: colors.danger }]}>
                  {describeError(updateProfile.error)}
                </Text>
              ) : null}
            </View>
          </Card>

          <TargetCard target={user.daily_calorie_target} />

          <Card>
            <View style={{ gap: spacing.md }}>
              <SectionLabel>Reminders</SectionLabel>
              <Text style={[type.caption, { color: colors.muted }]}>
                {reminders.enabled
                  ? 'On. A nudge if you go quiet, and an evening reminder while a streak is running.'
                  : 'Off. Turn them on for a nudge when you go quiet and a heads up before a streak breaks.'}
              </Text>
              <Button
                label={reminders.enabled ? 'Turn reminders off' : 'Turn reminders on'}
                variant="secondary"
                onPress={() => {
                  void (reminders.enabled ? reminders.disable() : reminders.enable());
                }}
              />
              {reminders.enabled === false ? (
                <Text style={[type.caption, { color: colors.muted }]}>
                  If nothing happens, notifications are blocked for Forkast in your
                  device settings.
                </Text>
              ) : null}
            </View>
          </Card>

          {zoneMismatch && localZone ? (
            <Card alt>
              <View style={{ gap: spacing.md }}>
                <SectionLabel>Timezone</SectionLabel>
                <Text style={[type.caption, { color: colors.muted }]}>
                  This device reports {localZone}. Matching it keeps your streaks lined up with your days.
                </Text>
                <Button
                  label="Use this device"
                  variant="secondary"
                  loading={updateProfile.isPending}
                  onPress={() => updateProfile.mutate({ timezone: localZone })}
                />
              </View>
            </Card>
          ) : null}
        </>
      ) : null}

      {/* Centred at its natural width rather than stretched across the screen.
          Signing out is a rare, destructive action, and a full bleed bar gave
          it more weight than anything else on a tab that has no primary
          action at all. */}
      <Button
        label="Sign out"
        icon="signOut"
        variant="danger"
        size="lg"
        align="center"
        onPress={() => void signOut()}
      />

      <DeleteAccount />

      <Text style={[type.labelSoft, { color: colors.muted, textAlign: 'center' }]}>
        Forkast {appVersion}
      </Text>
    </Screen>
  );
}
