import Constants from 'expo-constants';
import { useMemo } from 'react';
import { Platform, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

import { useLogs } from '../hooks/useLogs';
import { useVisitedRestaurants } from '../hooks/useRestaurants';
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
 * True only where react-native-maps cannot actually draw anything.
 *
 * Expo removed Google Maps from the Expo Go client on Android in SDK 53, and
 * Google Maps is the only provider react-native-maps has there, so a MapView
 * renders as a blank grey rectangle with an authorization failure in the log. No
 * API key fixes it, because in Expo Go the app runs under Expo's own package
 * name and signature and the config plugin only applies during a native build.
 *
 * The check is deliberately narrow. iOS Expo Go uses Apple Maps and works
 * today, and any development or production build works on both platforms, so
 * only this one combination falls back to the list.
 *
 * appOwnership is the check rather than executionEnvironment because
 * ExecutionEnvironment.StoreClient covers a development client as well as Expo
 * Go, which would disable the map in exactly the build that can render it.
 */
const MAPS_UNAVAILABLE = Constants.appOwnership === 'expo' && Platform.OS === 'android';

/** Karachi, so an account with no coordinates yet still opens somewhere sane. */
const FALLBACK_REGION = {
  latitude: 24.8607,
  longitude: 67.0011,
  latitudeDelta: 0.35,
  longitudeDelta: 0.35,
};

type Pin = {
  id: string;
  name: string;
  area: string | null;
  latitude: number;
  longitude: number;
  count: number;
};

function toPins(restaurants: Restaurant[], logs: FoodLog[]): Pin[] {
  const counts = new Map<string, number>();
  for (const log of logs) {
    if (log.restaurant_id) {
      const key = String(log.restaurant_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return restaurants
    .filter((r) => r.latitude !== null && r.longitude !== null)
    .map((r) => ({
      id: String(r.id),
      name: r.name,
      area: r.area,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      count: counts.get(String(r.id)) ?? 0,
    }));
}

/** Frame the pins rather than dropping the user on a fixed region. */
function regionFor(pins: Pin[]) {
  if (pins.length === 0) return FALLBACK_REGION;

  const lats = pins.map((p) => p.latitude);
  const lngs = pins.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    // A floor, so a single pin does not zoom to street level.
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.05),
    longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.05),
  };
}

/**
 * The single seam for the map. Everything the rest of the app knows about the
 * map lives behind this component.
 */
export function MapScreen() {
  const { colors, radius, spacing, type } = useTheme();
  const restaurants = useVisitedRestaurants();
  const logs = useLogs(100, 0);

  const groups = useMemo(
    () => groupByArea(restaurants.data ?? [], logs.data?.items ?? []),
    [restaurants.data, logs.data],
  );
  const pins = useMemo(
    () => toPins(restaurants.data ?? [], logs.data?.items ?? []),
    [restaurants.data, logs.data],
  );
  const showMap = !MAPS_UNAVAILABLE && pins.length > 0;

  const loading = restaurants.isLoading || logs.isLoading;
  // Either query failing leaves the map wrong, not merely thinner. Requiring
  // both to fail would render a partial outage as an innocent empty state.
  const failed = restaurants.isError || logs.isError;

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
      {showMap ? (
        <View
          style={{
            height: 280,
            borderRadius: radius.card,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <MapView
            style={{ flex: 1 }}
            // PROVIDER_DEFAULT means Apple Maps on iOS and Google Maps on
            // Android. Forcing Google on iOS would need a key for no benefit.
            provider={PROVIDER_DEFAULT}
            initialRegion={regionFor(pins)}
          >
            {pins.map((pin) => (
              <Marker
                key={pin.id}
                coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
                title={pin.name}
                description={
                  pin.count === 1 ? '1 meal logged here' : `${pin.count} meals logged here`
                }
                pinColor={colors.accent}
              />
            ))}
          </MapView>
        </View>
      ) : null}

      <Text style={[type.caption, { color: colors.muted }]}>
        {MAPS_UNAVAILABLE
          ? 'Grouped by area. The map needs a development build on Android, since Expo Go cannot draw one.'
          : 'Grouped by area, with counts. Places without coordinates do not get a pin yet.'}
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
                  <Text style={[type.label, { color: colors.accent }]}>
                    {`${spot.count}x`}
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
