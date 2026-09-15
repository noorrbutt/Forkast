import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { useLogs } from '../hooks/useLogs';
import { useRestaurants } from '../hooks/useRestaurants';
import { describeError } from '../lib/api';
import { formatNumber } from '../lib/format';
import type { FoodLog, Restaurant } from '../lib/types';
import { useTheme } from '../theme';
import { Card, Empty, ErrorState, Loading, SectionLabel } from './ui';

const UNLISTED = 'Area not set';

type Spot = {
  key: string;
  name: string;
  count: number;
};

type AreaGroup = {
  area: string;
  spots: Spot[];
  total: number;
};

function matchKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function groupByArea(restaurants: Restaurant[], logs: FoodLog[]): AreaGroup[] {
  const countById = new Map<string, number>();
  const countByName = new Map<string, number>();

  for (const log of logs) {
    if (log.restaurant_id !== null && log.restaurant_id !== undefined) {
      const key = String(log.restaurant_id);
      countById.set(key, (countById.get(key) ?? 0) + 1);
    }
    const name = matchKey(log.restaurant?.name);
    if (name.length > 0) {
      countByName.set(name, (countByName.get(name) ?? 0) + 1);
    }
  }

  const areas = new Map<string, Spot[]>();
  const seenNames = new Set<string>();

  for (const restaurant of restaurants) {
    const byId = countById.get(String(restaurant.id)) ?? 0;
    const byName = countByName.get(matchKey(restaurant.name)) ?? 0;
    // A log carries either the id or the free text name, never both as separate visits.
    const count = Math.max(byId, byName);
    seenNames.add(matchKey(restaurant.name));

    const area = restaurant.area?.trim() || UNLISTED;
    const spots = areas.get(area) ?? [];
    spots.push({ key: String(restaurant.id), name: restaurant.name, count });
    areas.set(area, spots);
  }

  // Places typed by hand that never made it into the restaurants table.
  for (const log of logs) {
    const name = matchKey(log.restaurant?.name);
    if (name.length === 0 || seenNames.has(name)) continue;
    seenNames.add(name);

    const area = log.area?.trim() || UNLISTED;
    const spots = areas.get(area) ?? [];
    spots.push({
      key: `log-${name}`,
      name: log.restaurant?.name ?? 'Unnamed spot',
      count: countByName.get(name) ?? 1,
    });
    areas.set(area, spots);
  }

  return Array.from(areas.entries())
    .map(([area, spots]) => ({
      area,
      spots: spots.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      total: spots.reduce((sum, spot) => sum + spot.count, 0),
    }))
    .sort((a, b) => b.total - a.total || a.area.localeCompare(b.area));
}

/**
 * The single seam for the map. Everything the rest of the app knows about the
 * map lives behind this component, so swapping this body for a real map view
 * later touches no route and no screen.
 *
 * Deliberately not react-native-maps or expo-maps: react-native-maps draws a
 * blank grey rectangle on Android in Expo Go since Expo removed Google Maps
 * from the Expo Go client in SDK 53, and expo-maps is alpha and absent from
 * Expo Go entirely.
 */
export function MapScreen() {
  const { colors, radius, spacing, type } = useTheme();
  const restaurants = useRestaurants();
  const logs = useLogs(100, 0);

  const groups = useMemo(
    () => groupByArea(restaurants.data ?? [], logs.data?.items ?? []),
    [restaurants.data, logs.data],
  );

  const loading = restaurants.isLoading || logs.isLoading;
  const failed = restaurants.isError && logs.isError;

  if (loading) return <Loading label="Finding your spots" />;

  if (failed) {
    return (
      <ErrorState
        title="Map unavailable"
        message={describeError(restaurants.error ?? logs.error)}
        onRetry={() => {
          void restaurants.refetch();
          void logs.refetch();
        }}
      />
    );
  }

  if (groups.length === 0) {
    return (
      <Empty
        emoji="📍"
        title="No places yet"
        message="Log a meal with a restaurant name and your map starts filling in."
      />
    );
  }

  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={[type.caption, { color: colors.muted }]}>
        Grouped by area for now. A real map drops into this same view later.
      </Text>

      {groups.map((group) => (
        <Card key={group.area}>
          <View style={{ gap: spacing.lg }}>
            <View style={{ gap: spacing.xs }}>
              <SectionLabel>{group.area}</SectionLabel>
              <Text style={[type.displaySm, { color: colors.text }]}>{formatNumber(group.total)}</Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                {group.total === 1 ? 'meal logged here' : 'meals logged here'}
              </Text>
            </View>

            <View style={{ gap: spacing.sm }}>
              {group.spots.map((spot) => (
                <View
                  key={spot.key}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.md,
                    paddingVertical: spacing.md,
                    paddingHorizontal: spacing.lg,
                    borderRadius: radius.pill,
                    backgroundColor: colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={[type.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                    {spot.name}
                  </Text>
                  <Text style={[type.label, { color: spot.count > 0 ? colors.accent : colors.muted }]}>
                    {spot.count > 0 ? `${spot.count}x` : 'New'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}
