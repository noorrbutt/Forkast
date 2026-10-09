import { Redirect } from 'expo-router';

/**
 * The map is a view of the diary now, behind the List / Map switch in its
 * header, not a screen of its own. This route stays so an old link or a
 * bookmarked /map still lands somewhere sensible: on the diary, map showing.
 */
export default function MapRoute() {
  return <Redirect href={{ pathname: '/history', params: { view: 'map' } }} />;
}
