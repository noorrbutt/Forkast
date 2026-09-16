import { useRouter } from 'expo-router';
import { RefreshControl, Text, View } from 'react-native';

import { Card, Empty, ErrorState, Loading, Screen, SectionLabel } from '../components/ui';
import { useLogs } from '../hooks/useLogs';
import { describeError } from '../lib/api';
import { SERVING_LABELS, formatDate, formatNumber } from '../lib/format';
import type { FoodLog } from '../lib/types';
import { useTheme } from '../theme';

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
          emoji="🍽️"
          title="Nothing logged yet"
          message="Log your first meal and it will show up here, ready to edit."
        />
      ) : null}

      {items.map((log) => (
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
          </View>
        </Card>
      ))}
    </Screen>
  );
}
