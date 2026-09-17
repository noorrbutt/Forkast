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
import { REMINDERS_AVAILABLE } from '../../lib/notifications';
import { describeError } from '../../lib/api';
import { GOAL_BLURBS, GOAL_LABELS, formatDate, formatNumber } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { GOALS, type Goal } from '../../lib/types';
import { useTheme } from '../../theme';

/**
 * Self-critique, per the style guide section 13.
 *
 * What it was: a centred identity block, four grouped lists of rows, and a
 * centred version line. The grouped rows are the right pattern and they stay.
 *
 * What it broke. Section 2, alignment: the scroll changed edge three times,
 * centred identity, then left aligned groups, then a centred footer, and the
 * rule is one content column and one left edge unless there is a reason.
 * Section 3, accessibility: the email carried `numberOfLines={1}`, so a long
 * address rendered as "verylongaddress@exa...", which is the truncation the
 * guide names as a failure rather than a cosmetic issue. Section 2, contrast:
 * the largest thing in the content was the email at 21, exactly the size of the
 * title in the bar above it, so the first and second elements were zero steps
 * apart. Section 10: eight icons drawn inside discs, five 32pt discs on the
 * rows and three 52pt ones sitting directly above a dialog title, which is both
 * the decorative disc and the icon beside a heading. Section 12: an eyebrow
 * reading "Your account" above a title reading "Profile", which says one thing
 * twice. Section 5: no cap on the column. Section 3, usability: the target
 * dialog disabled its own primary action until the number was valid, which is
 * the one failure this app has already shipped once and the guide names
 * outright.
 *
 * What the one thing is now: who is signed in. A 72pt picture with the address
 * beside it, left aligned on the same edge as everything below, with 32 of
 * space under it against 24 between the groups. No `hero` on this screen, and
 * that is correct: a profile has no focal number, and the guide asks for none
 * rather than for something invented to fill the slot.
 *
 * What was demoted, and why that is correct: every row lost its icon. The
 * labels, "Goal", "Daily calorie target", "Timezone", "Reminders", "Sign out",
 * already say what they are, and an icon carrying meaning a word carries is
 * what the guide bans. The version line moved to the left edge and stayed at 12.
 */

/** The range the server accepts, checked here so a typo never costs a 422. */
const MIN_TARGET = 0;
const MAX_TARGET = 10_000;


/**
 * The picture, at 72 rather than the component's default 88.
 *
 * It sits beside the address now instead of above it, and at 88 the circle took
 * enough of a narrow phone's width that the email had nowhere to wrap to.
 */
const AVATAR_SIZE = 72;

function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * Who this account is. The one thing on this screen.
 *
 * A picture and an address, side by side on the same left edge as every group
 * below, rather than a centred stack that made the scroll change alignment
 * twice before the first setting. Large on the left, small on the right is the
 * asymmetry the guide asks for, and it is the only block here with 32 beneath
 * it where the groups get 24.
 *
 * Not a card on purpose. A surface would make it the fifth in a stack of five
 * and undo the whole point of it being first.
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
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
        paddingBottom: spacing.sm,
      }}
    >
      <ProfileAvatar name={email} hasPicture={picture} size={AVATAR_SIZE} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        {/* Wraps. It used to be one line with a tail truncation, so a long
            address became "verylongaddress@exa..." and the account you were
            looking at was the one thing the screen would not tell you. */}
        <Text style={[type.title, { color: colors.text }]}>{email}</Text>
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
  // Whether the save has been pressed yet, which is what lets an empty field
  // stay quiet until someone has actually asked for it to be saved.
  const [asked, setAsked] = useState(false);

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
    (asked || trimmed.length > 0) && !valid
      ? `Enter a whole number, up to ${formatNumber(MAX_TARGET)}.`
      : null;

  const busy = save.isPending || clear.isPending;

  const onSave = () => {
    if (busy) return;
    // Pressing is what makes an empty field a problem worth naming. Until then
    // the message would be scolding someone for not having typed yet.
    setAsked(true);
    if (!valid) return;
    // Nothing to send, so the dialog closing is the whole answer.
    if (unchanged) {
      setOpen(false);
      return;
    }
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
      // Live until the request is actually running. A primary action that
      // disables itself until the form is valid hides the affordance behind
      // the very thing it is inviting, so this one stays pressable and the
      // field says what is missing instead.
      disabled: busy,
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
        label="Daily calorie target"
        value={target != null ? formatNumber(target) : 'Not set'}
        hint={
          target != null
            ? 'Your dashboard measures the day against this and shows what is left.'
            : 'Optional. Set one and the dashboard shows what is left of the day, not just a total.'
        }
        onPress={() => {
          setAsked(false);
          // Both of these, not just `asked`. `touched` was cleared only after a
          // successful save or clear, never on cancel, so typing 9999 and
          // pressing Cancel left the field showing 9999 for the rest of the
          // session while the row behind it read the stored number. The seeding
          // effect is blocked by `touched`, so the real value became unreachable
          // in the one dialog that exists to edit it, and pressing Update saved
          // the number the user had already abandoned.
          setTouched(false);
          setDraft(target != null ? String(target) : '');
          setOpen(true);
        }}
        last={last}
      />

      <Dialog
        visible={open}
        onDismiss={() => !busy && setOpen(false)}
        title="Your daily target"
        message="A number the dashboard can measure the day against."
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
      {/* The zone reads on the hint line rather than in the value column, and
          it is the one setting here that has to. The value column no longer
          truncates, but it is the narrow half of the row, so
          "America/Argentina/Buenos_Aires" would wrap to three stacked lines
          against a one word label. The hint has the full width. */}
      <ListRow
        label="Timezone"
        hint={
          mismatch && local
            ? `${zone || 'Not set'}. This device reports ${local}.`
            : zone || 'Not set'
        }
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

  /**
   * Where reminders cannot work, say so instead of offering a switch.
   *
   * This guard was written and then never wired up: the flag was imported into
   * this file and never read, so Expo Go and the browser both showed a live
   * Reminders row. Tapping it in Expo Go did nothing and the note below then
   * blamed the user's device settings, which was simply untrue. The row is not
   * hidden, because a feature that silently disappears reads as one that was
   * removed; it is shown as present and explained.
   */
  if (!REMINDERS_AVAILABLE) {
    return (
      <View style={{ gap: spacing.sm }}>
        <ListGroup title="Notifications">
          <ListRow
            label="Reminders"
            value="Not here"
            hint="Reminders need the installed app. Expo Go and the browser cannot schedule them."
            last
          />
        </ListGroup>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <ListGroup title="Notifications">
        <ListRow
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
  const { colors, layout, spacing, type } = useTheme();
  const { signOut } = useAuth();
  const me = useMe();

  const user = me.data;
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  return (
    // No eyebrow. "Your account" above a title reading "Profile" was the same
    // sentence twice, and the tab bar has already said which screen this is.
    <Screen title="Profile">
      <View
        style={{
          width: '100%',
          maxWidth: layout.contentWidth,
          alignSelf: 'center',
          // 24 between groups against 8 between a group's title and its rows,
          // so the grouping says something.
          gap: spacing.xl,
        }}
      >
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
              <ListRow label="Sign out" onPress={() => void signOut()} last />
            </ListGroup>

            <DeleteAccount />
          </>
        ) : null}

        {/* On the same left edge as everything above it. Centring one line at
            the bottom of a left aligned screen is the third alignment change in
            one scroll, and it was not buying anything. */}
        <Text style={[type.labelSoft, { color: colors.muted }]}>Forkast {appVersion}</Text>
      </View>
    </Screen>
  );
}
