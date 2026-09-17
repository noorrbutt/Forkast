import Constants from 'expo-constants';
import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { ChangePassword } from '../../components/ChangePassword';
import { DeleteAccount } from '../../components/DeleteAccount';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import {
  Chip,
  Dialog,
  ErrorState,
  Field,
  ListGroup,
  ListRow,
  Loading,
  Screen,
} from '../../components/ui';
import { useAuth, useMe } from '../../hooks/useAuth';
import { hasAvatar } from '../../hooks/useAvatar';
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

/**
 * Who this account is.
 *
 * A face, an address and a date, centred, which is the first thing every
 * profile screen in existence shows. The old screen opened with a card of
 * label and value pairs, so the page began by reciting fields rather than by
 * saying whose page it was.
 */
function Identity({
  email,
  joined,
  picture,
}: {
  email: string;
  joined: string;
  picture: boolean;
}) {
  const { colors, spacing, type } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm }}>
      <ProfileAvatar name={email} hasPicture={picture} />
      <View style={{ alignItems: 'center', gap: spacing.xs }}>
        <Text style={[type.title, { color: colors.text, textAlign: 'center' }]} numberOfLines={1}>
          {email}
        </Text>
        <Text style={[type.caption, { color: colors.muted }]}>
          Member since {joined || 'today'}
        </Text>
      </View>
    </View>
  );
}

/**
 * The goal, as a row that opens the picker.
 *
 * The chips stay: three options side by side is the one case where chips beat a
 * list, since all three fit and the choice is a mood rather than a lookup. What
 * changed is that they no longer take a whole card on a screen they are the
 * least consequential thing on.
 */
function GoalRow({ goal, last }: { goal: Goal | null; last?: boolean }) {
  const { colors, spacing, type } = useTheme();
  const [open, setOpen] = useState(false);
  const update = useUpdateProfile();

  const setGoal = (next: Goal) => {
    if (next === goal || update.isPending) return;
    update.mutate({ goal: next }, { onError: () => haptics.error() });
  };

  return (
    <>
      <ListRow
        icon="trophy"
        label="Goal"
        value={goal ? GOAL_LABELS[goal] : 'Not set'}
        hint={goal ? GOAL_BLURBS[goal] : 'Pick a goal and the meal plans will follow it.'}
        onPress={() => setOpen(true)}
        last={last}
      />

      <Dialog
        visible={open}
        onDismiss={() => setOpen(false)}
        title="Your goal"
        message="The meal plans follow this, so it is worth being honest about."
        icon="trophy"
        actions={[{ label: 'Done', variant: 'primary', onPress: () => setOpen(false) }]}
      >
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {GOALS.map((option) => (
              <Chip
                key={option}
                label={GOAL_LABELS[option]}
                selected={goal === option}
                disabled={update.isPending}
                onPress={() => setGoal(option)}
              />
            ))}
          </View>
          {update.isError ? (
            <Text style={[type.caption, { color: colors.danger }]}>
              {describeError(update.error)}
            </Text>
          ) : null}
        </View>
      </Dialog>
    </>
  );
}

/**
 * The daily calorie target.
 *
 * The goal above this is a mood: nothing in the app can agree or disagree with
 * "bulk". A number can be met or missed, so this is the one setting here the
 * dashboard reads back, which is why it is the row that carries its value.
 *
 * Optional by design. Plenty of people do not want a number to fall short of,
 * and taking it back is its own action rather than a side effect of emptying
 * the field, because an empty field is also what half typed looks like.
 */
function TargetRow({ target, last }: { target: number | null; last?: boolean }) {
  const { colors, spacing, type } = useTheme();
  // Two mutations off the one hook, so a save and a clear keep their own
  // pending and error state instead of one spinner sitting on both actions.
  const save = useUpdateProfile();
  const clear = useUpdateProfile();

  const [open, setOpen] = useState(false);
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

  const busy = save.isPending || clear.isPending;

  const onSave = () => {
    if (!valid || unchanged) return;
    save.mutate(
      { daily_calorie_target: parsed },
      {
        onSuccess: () => {
          haptics.success();
          setTouched(false);
          setOpen(false);
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
          setOpen(false);
        },
        onError: () => haptics.error(),
      },
    );
  };

  const failure = save.isError ? save.error : clear.isError ? clear.error : null;

  const actions: ComponentProps<typeof Dialog>['actions'] = [
    {
      label: target != null ? 'Update target' : 'Set target',
      variant: 'primary',
      onPress: onSave,
      disabled: !valid || unchanged || busy,
      loading: save.isPending,
    },
  ];
  if (target != null) {
    actions.push({
      label: 'Clear target',
      variant: 'secondary',
      onPress: onClear,
      disabled: busy,
      loading: clear.isPending,
    });
  }
  actions.push({
    label: 'Cancel',
    variant: 'secondary',
    onPress: () => setOpen(false),
    disabled: busy,
  });

  return (
    <>
      <ListRow
        icon="chart"
        label="Daily calorie target"
        value={target != null ? formatNumber(target) : 'Not set'}
        hint={
          target != null
            ? 'Your dashboard measures the day against this and shows what is left.'
            : 'Optional. Set one and the dashboard shows what is left of the day, not just a total.'
        }
        onPress={() => setOpen(true)}
        last={last}
      />

      <Dialog
        visible={open}
        onDismiss={() => !busy && setOpen(false)}
        title="Your daily target"
        message="A number the dashboard can measure the day against."
        icon="chart"
        actions={actions}
      >
        <View style={{ gap: spacing.md }}>
          <Field
            label="Calories a day"
            value={draft}
            onChangeText={(next) => {
              setTouched(true);
              // Strip anything that is not a digit as it is typed, so the
              // numeric keypad's stray characters never reach validation.
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
          {failure ? (
            <Text style={[type.caption, { color: colors.danger }]}>{describeError(failure)}</Text>
          ) : null}
        </View>
      </Dialog>
    </>
  );
}

/**
 * The timezone, and the offer to fix it.
 *
 * Only interactive when the device disagrees with the account, because there is
 * nothing to choose otherwise. Timezone decides which calendar day a meal lands
 * in, and days cannot be re-bucketed after the fact, so a disagreement is worth
 * a row that asks rather than a banner that is easy to ignore.
 */
function TimezoneRow({ zone, last }: { zone: string; last?: boolean }) {
  const { colors, spacing, type } = useTheme();
  const [open, setOpen] = useState(false);
  const update = useUpdateProfile();

  const local = deviceTimezone();
  const mismatch = Boolean(local && zone !== local);

  const adopt = () => {
    if (!local || update.isPending) return;
    update.mutate(
      { timezone: local },
      {
        onSuccess: () => {
          haptics.success();
          setOpen(false);
        },
        onError: () => haptics.error(),
      },
    );
  };

  return (
    <>
      <ListRow
        icon="clock"
        label="Timezone"
        value={zone || 'Not set'}
        hint={mismatch && local ? `This device reports ${local}.` : undefined}
        onPress={mismatch ? () => setOpen(true) : undefined}
        trailing={
          update.isPending ? <ActivityIndicator size="small" color={colors.accent} /> : undefined
        }
        last={last}
      />

      {/* Only ever reachable when the device reported a zone, since that is
          what a mismatch means, so the copy below can name it plainly. */}
      {local ? (
        <Dialog
          visible={open}
          onDismiss={() => !update.isPending && setOpen(false)}
          title="Timezone"
          message={`This device reports ${local}. Matching it keeps your streaks lined up with your days.`}
          icon="clock"
          actions={[
            {
              label: 'Use this device',
              variant: 'primary',
              onPress: adopt,
              disabled: update.isPending,
              loading: update.isPending,
            },
            {
              label: `Keep ${zone}`,
              variant: 'secondary',
              onPress: () => setOpen(false),
              disabled: update.isPending,
            },
          ]}
        >
          {update.isError ? (
            <Text style={[type.caption, { color: colors.danger, marginBottom: spacing.sm }]}>
              {describeError(update.error)}
            </Text>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}

/**
 * Reminders, as one row that says what state it is in.
 *
 * The note below the group only appears once they have been switched off,
 * because that is the one moment where "nothing happened" has a cause worth
 * naming: the permission lives in the operating system, not in this app.
 */
function RemindersSection() {
  const { colors, spacing, type } = useTheme();
  const reminders = useReminders();
  const on = reminders.enabled === true;

  return (
    <View style={{ gap: spacing.sm }}>
      <ListGroup title="Notifications">
        <ListRow
          icon="bell"
          label="Reminders"
          value={reminders.enabled === null ? undefined : on ? 'On' : 'Off'}
          hint={
            on
              ? 'A nudge if you go quiet, and an evening reminder while a streak is running.'
              : 'Turn them on for a nudge when you go quiet and a heads up before a streak breaks.'
          }
          onPress={() => {
            void (on ? reminders.disable() : reminders.enable());
          }}
          last
        />
      </ListGroup>
      {reminders.enabled === false ? (
        <Text style={[type.caption, { color: colors.muted, paddingHorizontal: spacing.lg }]}>
          If nothing happens, notifications are blocked for Forkast in your device settings.
        </Text>
      ) : null}
    </View>
  );
}

export default function ProfileScreen() {
  const { colors, spacing, type } = useTheme();
  const { signOut } = useAuth();
  const me = useMe();

  const user = me.data;
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

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
          <Identity
            email={user.email}
            joined={formatDate(user.created_at)}
            picture={hasAvatar(user)}
          />

          <ListGroup title="Your day">
            <GoalRow goal={user.goal ?? null} />
            <TargetRow target={user.daily_calorie_target} />
            <TimezoneRow zone={user.timezone} last />
          </ListGroup>

          <RemindersSection />

          {/* Signing out sits in a group with everything else rather than
              floating under the page as a lone pill, which is what made it and
              the delete trigger read as two orphans that had missed the grid. */}
          <ListGroup title="Account">
            <ChangePassword />
            <ListRow icon="signOut" label="Sign out" onPress={() => void signOut()} last />
          </ListGroup>

          <DeleteAccount />
        </>
      ) : null}

      <Text
        style={[
          type.labelSoft,
          { color: colors.muted, textAlign: 'center', paddingTop: spacing.sm },
        ]}
      >
        Forkast {appVersion}
      </Text>
    </Screen>
  );
}
