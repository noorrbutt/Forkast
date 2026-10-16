/**
 * Grid clustering for map pins, in pure TypeScript, no dependency.
 *
 * Pins that sit on top of each other read as one pin -- whichever happened
 * to be drawn last -- which is worse than no pin at all for a dense area:
 * the count the rest of this screen already shows per spot disappears
 * completely on the one surface meant to show WHERE those spots are. A
 * grid bucket sized from the region actually on screen is the simplest fix
 * that still separates again the moment someone zooms in past it.
 */

export type ClusterPoint = {
  id: string;
  latitude: number;
  longitude: number;
};

export type Cluster<T extends ClusterPoint> = {
  /** Stable for a given region and point set, not across zoom levels --
   * the bucket a point falls in changes as the grid itself resizes, so a
   * cluster's own identity is only ever meaningful for one render. */
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  members: T[];
};

export type ClusterRegion = {
  latitudeDelta: number;
  longitudeDelta: number;
};

/** How many buckets the visible region is divided into on each axis. Higher
 * splits pins apart sooner while zooming in; lower merges more aggressively.
 * 12 was picked by eye against Karachi's actual restaurant density -- a
 * handful of pins within a few hundred metres of each other in Clifton or
 * Gulberg should merge at the city-wide zoom this screen opens on, and stop
 * merging within a few taps of zooming into one neighbourhood. */
const GRID_DIVISIONS = 12;

/**
 * Buckets `points` into a `GRID_DIVISIONS` x `GRID_DIVISIONS` grid sized to
 * `region`, and collapses each occupied bucket into one cluster centred on
 * its members' own average position -- not the bucket's geometric centre,
 * so a cluster of three pins bunched in one corner of a bucket is drawn
 * where those three pins actually are.
 *
 * A cluster of one point is still a cluster (count 1); the caller decides
 * whether that renders differently from a genuine multi-pin cluster.
 */
export function clusterPoints<T extends ClusterPoint>(
  points: readonly T[],
  region: ClusterRegion,
): Cluster<T>[] {
  if (points.length === 0) return [];

  const latStep = region.latitudeDelta / GRID_DIVISIONS;
  const lngStep = region.longitudeDelta / GRID_DIVISIONS;

  // A degenerate region (zero or negative delta, which a malformed camera
  // update could hand this) has no meaningful bucket size, so every point
  // stays its own cluster rather than dividing by zero or by a negative
  // step, either of which would throw every point into the same bucket.
  if (!(latStep > 0) || !(lngStep > 0)) {
    return points.map((point) => ({
      id: point.id,
      latitude: point.latitude,
      longitude: point.longitude,
      count: 1,
      members: [point],
    }));
  }

  const buckets = new Map<string, T[]>();
  for (const point of points) {
    const key = `${Math.floor(point.latitude / latStep)}:${Math.floor(point.longitude / lngStep)}`;
    const existing = buckets.get(key);
    if (existing) existing.push(point);
    else buckets.set(key, [point]);
  }

  return Array.from(buckets.entries()).map(([key, members]) => ({
    id: key,
    latitude: members.reduce((sum, m) => sum + m.latitude, 0) / members.length,
    longitude: members.reduce((sum, m) => sum + m.longitude, 0) / members.length,
    count: members.length,
    members,
  }));
}

/** The region that frames every member of a cluster, the same floor
 * regionFor (MapScreen) applies so a single-member cluster does not zoom to
 * street level. */
export function regionForCluster<T extends ClusterPoint>(cluster: Cluster<T>) {
  const lats = cluster.members.map((m) => m.latitude);
  const lngs = cluster.members.map((m) => m.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.8, 0.01),
    longitudeDelta: Math.max((maxLng - minLng) * 1.8, 0.01),
  };
}
