import { useRouter } from 'expo-router';

import { MapScreen } from '../components/MapScreen';
import { Screen } from '../components/ui';

export default function MapRoute() {
  const router = useRouter();

  return (
    <Screen title="Map" eyebrow="Where you eat" onBack={() => router.back()} bottomInset={48}>
      <MapScreen />
    </Screen>
  );
}
