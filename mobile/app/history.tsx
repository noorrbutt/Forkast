import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';

import {
  Button,
  Card,
  Empty,
  ErrorState,
  Icon,
  Loading,
  Screen,
  SectionLabel,
} from '../components/ui';
import { useLogs, useRepeatLog } from '../hooks/useLogs';
import { describeError } from '../lib/api';
import { SERVING_LABELS, formatDate, formatNumber } from '../lib/format';
import { haptics } from '../lib/haptics';
import type { FoodLog, Uuid } from '../lib/types';
import { useTheme } from '../theme';

/** How long the confirmation stays on a row before the row goes quiet again. */
const CONFIRMED_MS = 4000;

/**
 * The diary itself.
 *
 * Without this screen the app could only ever add logs: listing, editing and
 * deleting existed on the server and had no way in from the phone, so a
 * mistyped dish was permanent.
 */
export default function HistoryScreen() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();
  const logs = useLogs(100, 0);
  const repeat = useRepeatLog();

  const [confirmed, setConfirmed] = useState<Uuid | null>(null);

  /**
   * The only thing stopping a meal being logged twice.
   *
   * The usual answer, disabling the button while the request is out, is not
   * available on a row that is itself pressable: see the button below. And
   * isPending would only reach it a render later anyway, which is long after an
   * impatient second tap has landed. So the duplicate is refused here, before
   * anything is sent.
   */
  const inFlight = useRef<Uuid | null>(null);

  useEffect(() => {
    if (confirmed === null) return;
    // This line acknowledges a tap, it is not the row's status, so it steps
    // back out instead of sitting on a list the user has long scrolled past.
    const timer = setTimeout(() => setConfirmed(null), CONFIRMED_MS);
    return () => clearTimeout(timer);
  }, [confirmed]);

  const logAgain = (id: Uuid) => {
    if (inFlight.current !== null) return;
    inFlight.current = id;
    setConfirmed(null);
    repeat.mutate(id, {
      onSuccess: () => {
        haptics.success();
        setConfirmed(id);
      },
      onError: () => haptics.error(),
      onSettled: () => {
        inFlight.current = null;
      },
    });
  };

  const items: FoodLog[] = logs.data?.items ?? [];

  return (
    <Screen
      title="Your diary"
      eyebrow={logs.data ? `${formatNumber(logs.data.total)} logged` : undefined}
      onBack={() => router.back()}
      refreshControl={
        <RefreshControl
          refreshing={logs.isRefetching}
          onRefresh={() => void logs.refetch()}
          tintColor={colors.accent}
        />
      }
    >
      {logs.isLoading ? <Loading label="Reading your diary" /> : null}

      {logs.isError && !logs.data ? (
        <ErrorState
          title="Diary unavailable"
          message={describeError(logs.error)}
          onRetry={() => void logs.refetch()}
        />
      ) : null}

      {logs.data && items.length === 0 ? (
        <Empty
          icon="history"
          title="Your diary is empty"
          message="Every meal you log lands here, newest first, with its calories and where you ate it. Tap one to fix a typo or delete it."
          actionLabel="Log your first meal"
          actionIcon="log"
          onAction={() => router.navigate('/log')}
        />
      ) : null}

      {items.map((log) => {
        const sending = repeat.isPending && repeat.variables === log.id;
        const failed = repeat.isError && repeat.variables === log.id;

        return (
          <Card key={log.id} onPress={() => router.push(`/logs/${log.id}`)}>
            <View style={{ gap: spacing.xs }}>
              <SectionLabel>{formatDate(log.created_at)}</SectionLabel>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                }}
              >
                <Text style={[type.title, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {log.dish_name}
                </Text>
                <Text style={[type.numeral, { color: colors.accent }]}>
                  {formatNumber(log.estimated_calories)}
                </Text>
                {/* The row is the way in to editing, which nothing else on the
                    card says out loud. */}
                <Icon name="forward" size={18} />
              </View>

              <Text style={[type.caption, { color: colors.muted }]} numberOfLines={1}>
                {[
                  log.category?.name,
                  log.restaurant?.name ?? log.area,
                  SERVING_LABELS[log.serving_size],
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>

              {/* Every row gets its own control rather than a swipe or a long
                  press. The whole point of repeating is to skip the trip
                  through the detail screen, and a gesture nobody can see is not
                  a shortcut, it is a secret.
                  It does not compete with opening the row because it is kept
                  away from it: its own line, at the leading edge, a full tap
                  target's distance from the chevron that says the row opens,
                  and it names the thing it does. Anywhere else on the card
                  still goes to the meal. */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  marginTop: spacing.sm,
                }}
              >
                <Button
                  // Deliberately never disabled, however much a spinner would
                  // suit it. A disabled Pressable does not claim the touch, so
                  // the card underneath would take the second tap and open the
                  // meal, which is the one thing this button must not do. It
                  // stays live, absorbs the tap, and the ref above refuses the
                  // duplicate. The label carries the state instead.
                  label={sending ? 'Logging' : 'Log again'}
                  variant="secondary"
                  icon="log"
                  onPress={() => logAgain(log.id)}
                  accessibilityHint={`Adds ${log.dish_name} to today, with the time you tap it`}
                />

                {confirmed === log.id ? (
                  <Text style={[type.caption, { color: colors.success, flex: 1 }]}>
                    Logged again for today.
                  </Text>
                ) : null}
              </View>

              {failed ? (
                <Text style={[type.caption, { color: colors.danger }]}>
                  {describeError(repeat.error)}
                </Text>
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
