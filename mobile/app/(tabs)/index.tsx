import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { BurnDialog } from '../../components/BurnDialog';
import { HomeHero } from '../../components/home/HomeHero';
import { HomeSkeleton } from '../../components/home/HomeSkeleton';
import { NextCard } from '../../components/home/NextCard';
import { chooseNextStep } from '../../components/home/nextStep';
import { TodayStrip } from '../../components/home/TodayStrip';
import { openSlots, todaysMeals, type Slot } from '../../components/home/todayMeals';
import { VerifyEmailBanner } from '../../components/home/VerifyEmailBanner';
import { WeekStrip } from '../../components/home/WeekStrip';
import { ErrorState, ListGroup, ListRow, Screen } from '../../components/ui';
import { useDashboard } from '../../hooks/useInsights';
import { useLogs } from '../../hooks/useLogs';
import { usePlans } from '../../hooks/usePlans';
import { describeError } from '../../lib/api';
import type { Uuid } from '../../lib/types';
import { useLayout, useTheme } from '../../theme';

/**
 * Home: how much is left today, what has been eaten, and what to do next.
 *
 * The hero (what is left) is the one thing; the Today strip of meal tiles is
 * the second answer and also the way in to Log. The pieces live in
 * components/home/; this file fetches and composes.
 */

export default function DashboardScreen() {
  // Burned is asked for, never parked on the screen as a form.
  const [burnOpen, setBurnOpen] = useState(false);
  const { colors, layout, spacing } = useTheme();
  const { isExpanded } = useLayout();
  const router = useRouter();
  const dashboard = useDashboard();
  // The newest page of the diary, which holds today unless more than twenty
  // meals were logged since midnight. Shares the diary's cache invalidation.
  const logs = useLogs();
  // The newest plan, for the next card. Same query the plan screen reads.
  const plans = usePlans();

  const data = dashboard.data;
  const now = new Date();
  const meals = useMemo(() => todaysMeals(logs.data?.items ?? [], new Date()), [logs.data]);
  const open = openSlots(meals, now);

  const logSlot = (slot: Slot | null) =>
    router.navigate({ pathname: '/log', params: { slot: slot ?? '' } });
  const openMeal = (id: Uuid) => router.push(`/logs/${id}`);

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching || logs.isRefetching}
          onRefresh={() => void Promise.all([dashboard.refetch(), logs.refetch()])}
          tintColor={colors.accent}
        />
      }
    >
      <View
        style={{
          width: '100%',
          // Widened only at expanded, where the hero and the rest of Home sit
          // side by side, each still capped rather than stretched.
          maxWidth: isExpanded ? layout.contentWidth * 1.75 : layout.contentWidth,
          alignSelf: 'center',
        }}
      >
        <VerifyEmailBanner />

        {dashboard.isLoading ? <HomeSkeleton /> : null}

        {dashboard.isError && !data ? (
          <ErrorState
            title="Dashboard unavailable"
            message={describeError(dashboard.error)}
            onRetry={() => void dashboard.refetch()}
          />
        ) : null}

        <View
          style={
            isExpanded
              ? {
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: spacing.xxl,
                }
              : undefined
          }
        >
          {data ? (
            <View style={isExpanded ? { flex: 1 } : undefined}>
              <HomeHero
                today={data.today}
                onSetTarget={() => router.navigate('/profile')}
                onEditBurn={() => setBurnOpen(true)}
              />
            </View>
          ) : null}

          <View style={[{ gap: spacing.xxl }, isExpanded ? { flex: 1 } : null]}>
            <TodayStrip
              meals={meals}
              open={open}
              loading={logs.isPending}
              failed={logs.isError && !logs.data}
              onOpen={openMeal}
              onLogSlot={logSlot}
            />

            <NextCard
              step={chooseNextStep({
                today: data?.today ?? null,
                meals,
                open,
                plan: plans.data?.[0] ?? null,
                now,
              })}
              onLogSlot={logSlot}
              onOpenPlan={() => router.push('/plan')}
            />

            <ListGroup>
              <ListRow
                icon="map"
                label="Map"
                hint="Where you eat, grouped by area."
                onPress={() => router.push('/map')}
                last
              />
            </ListGroup>

            {/* Below the fold on a phone: a glance at the week. The chart and
                the month comparison it summarises live on Trends. */}
            {data ? (
              <WeekStrip
                days={data.calories_by_day ?? []}
                target={data.today.target}
                onSeeTrends={() => router.push('/trends')}
              />
            ) : null}
          </View>
        </View>
      </View>

      <BurnDialog visible={burnOpen} onDismiss={() => setBurnOpen(false)} />
    </Screen>
  );
}
