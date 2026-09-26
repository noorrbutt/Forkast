import { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { MAPS_UNAVAILABLE, MapView, Marker, PROVIDER_DEFAULT } from './MapCanvas';

import { useLogs } from '../hooks/useLogs';
import { useVisitedRestaurants } from '../hooks/useRestaurants';
import { describeError } from '../lib/api';
import { formatNumber } from '../lib/format';
import type { FoodLog, Restaurant } from '../lib/types';
import { useTheme } from '../theme';
import { Empty, ErrorState, Icon, ListGroup, ListRow, Loading } from './ui';

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
    //
    // The server's figure wins when it sends one, because it counted the whole
    // history and this only ever sees a page of it. Counting locally was fine
    // until the hundredth meal and silently wrong after: a place visited thirty
    // times last year read as zero, and nothing on the screen said the numbers
    // were partial. The local count stays as the fallback for a build talking
    // to a server from before the field existed.
    const count = restaurant.visit_count ?? Math.max(byId, byName);
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
      // Same as above: the server counted everything, this saw a page.
      count: r.visit_count ?? counts.get(String(r.id)) ?? 0,
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
  const { colors, layout, radius, spacing, type } = useTheme();
  const [noticeDismissed, setNoticeDismissed] = useState(false);
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
        icon="map"
        title="No places yet"
        message="Log a meal with a restaurant name and your map starts filling in."
      />
    );
  }

  return (
    // One capped, centred column, like every other screen. Without it the
    // area cards stretched the full width of a tablet or a browser.
    <View
      style={{
        width: '100%',
        maxWidth: layout.contentWidth,
        alignSelf: 'center',
        gap: spacing.lg,
      }}
    >
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

      {MAPS_UNAVAILABLE && Platform.OS === 'android' && !noticeDismissed ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.card,
            backgroundColor: colors.surfaceAlt,
            paddingLeft: spacing.md,
            paddingRight: spacing.xs,
          }}
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[type.caption, { color: colors.muted, flex: 1 }]}
          >
            Pins and map are unavailable in this build on this device.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss map availability notice"
            onPress={() => setNoticeDismissed(true)}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={16} />
          </Pressable>
        </View>
      ) : null}

      {/* Two different reasons the map is missing, and they need different
          sentences. Naming Android and Expo Go to someone in a browser points
          at a cause that has nothing to do with them. */}
      {!MAPS_UNAVAILABLE || Platform.OS === 'web' ? (
        <Text style={[type.caption, { color: colors.muted }]}>
          {!MAPS_UNAVAILABLE
            ? 'Grouped by area, with counts. Places without coordinates do not get a pin yet.'
            : 'Grouped by area. The map itself is native only, so it does not draw in a browser.'}
        </Text>
      ) : null}

      {/* One group per area, exactly as the diary does one per day.

          It was a Card each, which put an unbounded stack of surfaces on a
          screen: someone who eats in a dozen areas got a dozen of them, well
          past the ceiling section 6 sets. It was also the same job the diary
          already solves, solved a second way, which is the rule against two
          screens answering one problem differently. The area total moves into
          the group's own heading, where the diary puts a day's. */}
      {groups.map((group) => (
        <ListGroup
          key={group.area}
          title={`${group.area} · ${formatNumber(group.total)} ${
            group.total === 1 ? 'meal' : 'meals'
          }`}
        >
          {group.spots.map((spot, index) => (
            <ListRow
              key={spot.key}
              label={spot.name}
              value={`${formatNumber(spot.count)} ${spot.count === 1 ? 'visit' : 'visits'}`}
              last={index === group.spots.length - 1}
            />
          ))}
        </ListGroup>
      ))}
    </View>
  );
}
