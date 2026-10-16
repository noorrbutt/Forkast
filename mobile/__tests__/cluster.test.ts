import { clusterPoints, regionForCluster } from '../components/map/cluster';

const REGION = { latitudeDelta: 0.3, longitudeDelta: 0.3 };

const point = (id: string, latitude: number, longitude: number) => ({ id, latitude, longitude });

describe('clusterPoints', () => {
  it('returns nothing for an empty set', () => {
    expect(clusterPoints([], REGION)).toEqual([]);
  });

  it('returns one cluster of one for a single point', () => {
    const clusters = clusterPoints([point('a', 24.86, 67.0)], REGION);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(1);
    expect(clusters[0].members).toEqual([point('a', 24.86, 67.0)]);
  });

  it('merges points close enough together into one cluster', () => {
    const close = [
      point('a', 24.8607, 67.0011),
      point('b', 24.8608, 67.0012),
      point('c', 24.8606, 67.001),
    ];

    const clusters = clusterPoints(close, REGION);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
  });

  it('keeps points far apart in separate clusters', () => {
    const far = [point('a', 24.86, 67.0), point('b', 31.5, 74.3)];

    const clusters = clusterPoints(far, REGION);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.count)).toEqual([1, 1]);
  });

  it('centres a cluster on its members own average position, not the bucket edge', () => {
    const pair = [point('a', 24.86, 67.0), point('b', 24.862, 67.002)];

    const [cluster] = clusterPoints(pair, REGION);

    expect(cluster.latitude).toBeCloseTo(24.861, 5);
    expect(cluster.longitude).toBeCloseTo(67.001, 5);
  });

  it('re-buckets when the region changes: zooming in can split a merged cluster apart', () => {
    const pair = [point('a', 24.86, 67.0), point('b', 24.862, 67.002)];
    const wide = clusterPoints(pair, { latitudeDelta: 2, longitudeDelta: 2 });
    const narrow = clusterPoints(pair, { latitudeDelta: 0.001, longitudeDelta: 0.001 });

    expect(wide).toHaveLength(1);
    expect(narrow).toHaveLength(2);
  });

  it('falls back to one cluster per point for a degenerate region, rather than dividing by zero', () => {
    const points = [point('a', 24.86, 67.0), point('b', 24.862, 67.002)];

    const clusters = clusterPoints(points, { latitudeDelta: 0, longitudeDelta: 0 });

    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.count === 1)).toBe(true);
  });
});

describe('regionForCluster', () => {
  it('frames every member, centred between them', () => {
    const cluster = {
      id: 'x',
      latitude: 24.861,
      longitude: 67.001,
      count: 2,
      members: [point('a', 24.86, 67.0), point('b', 24.862, 67.002)],
    };

    const region = regionForCluster(cluster);

    expect(region.latitude).toBeCloseTo(24.861, 5);
    expect(region.longitude).toBeCloseTo(67.001, 5);
    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitudeDelta).toBeGreaterThan(0);
  });

  it('never collapses to a zero-size region for a single-member cluster', () => {
    const cluster = {
      id: 'x',
      latitude: 24.86,
      longitude: 67.0,
      count: 1,
      members: [point('a', 24.86, 67.0)],
    };

    const region = regionForCluster(cluster);

    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitudeDelta).toBeGreaterThan(0);
  });
});
