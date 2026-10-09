import { useRouter } from 'expo-router';
import { RefreshControl, Text, View } from 'react-native';

import { CalorieBars } from '../components/CalorieBars';
import { TrendCard } from '../components/trends/TrendCard';
import { Card, ErrorState, Screen, SkeletonCard } from '../components/ui';
import { useDashboard, useTrend } from '../hooks/useInsights';
import { describeError } from '../lib/api';
import { useTheme } from '../theme';

/**
 * Trends: how the fortnight and the month are going.
 *
 * Retrospectives that used to fill the bottom of Home, which answers "how is
 * today going" and not this. Pushed from Home's week strip rather than given
 * a tab: the bar is at its five-slot ceiling around the raised log button,
 * and this is a screen looked at now and then, like the plan, not daily.
 *
 * No hero: two equal-weight readings, the chart first because it is the
 * picture the week strip on Home is a glance of.
 */
export default function TrendsRoute() {
  const router = useRouter();
  const { colors, layout, spacing, type } = useTheme();
  const dashboard = useDashboard();
  const trend = useTrend();
  const data = dashboard.data;

  return (
    <Screen
      title="Trends"
      onBack={() => router.back()}
      // No tab bar over a pushed screen, so only a little room at the foot.
      bottomInset={48}
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching || trend.isRefetching}
          onRefresh={() => void Promise.all([dashboard.refetch(), trend.refetch()])}
          tintColor={colors.accent}
        />
      }
    >
      <View
        style={{
          width: '100%',
          maxWidth: layout.contentWidth,
          alignSelf: 'center',
          gap: spacing.xxl,
        }}
      >
        {dashboard.isLoading ? <SkeletonCard rows={4} /> : null}

        {dashboard.isError && !data ? (
          <ErrorState
            title="Chart unavailable"
            message={describeError(dashboard.error)}
            onRetry={() => void dashboard.refetch()}
          />
        ) : null}

        {data ? (
          <Card>
            <View style={{ gap: spacing.lg }}>
              <Text style={[type.title, { color: colors.text }]}>Calories by day</Text>
              <CalorieBars data={data.calories_by_day ?? []} target={data.today.target} />
            </View>
          </Card>
        ) : null}

        <TrendCard trend={trend} />
      </View>
    </Screen>
  );
}
