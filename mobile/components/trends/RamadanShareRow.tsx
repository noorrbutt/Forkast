import { useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { Button, Card, FormError } from '../ui';
import { useRamadanSummary } from '../../hooks/useRamadanSummary';
import { shareCardVisible } from '../../lib/ramadan';
import { useTheme } from '../../theme';
import {
  RamadanShareCard,
  SHARE_CARD_PIXEL_HEIGHT,
  SHARE_CARD_PIXEL_WIDTH,
} from './RamadanShareCard';

/**
 * Offers the Ramadan share card, once there is one worth sharing.
 *
 * Three gates, all independent: a real summary has to exist (five days
 * logged, same as the card on this screen), it has to be late enough in the
 * month to be worth looking back on rather than mid-fast, and the device has
 * to be able to actually share a file -- which on web it structurally
 * cannot, since there is no OS share sheet for react-native-web to call into
 * and the two new native modules this needs are not shipped there either.
 */
export function RamadanShareRow() {
  const { spacing } = useTheme();
  const { summary } = useRamadanSummary();
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (Platform.OS === 'web') return null;
  if (!summary) return null;
  if (!shareCardVisible(new Date())) return null;

  const onShare = async () => {
    setError(null);
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: SHARE_CARD_PIXEL_WIDTH,
        height: SHARE_CARD_PIXEL_HEIGHT,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        setError('Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      // A failed share never leaves the Ramadan summary itself unreadable;
      // this row is the only thing that failed.
      setError('Could not create the share image. Try again.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        {/* Off-screen, not invisible: react-native-view-shot needs the view
            actually laid out and painted to capture it, which opacity: 0 or
            display: 'none' would both prevent on at least one platform. */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: -9999, left: -9999 }}
          testID="ramadan-share-card-offscreen"
        >
          <RamadanShareCard ref={cardRef} summary={summary} />
        </View>

        <Button
          label="Share this Ramadan"
          variant="secondary"
          onPress={() => void onShare()}
          disabled={sharing}
          loading={sharing}
        />
        {error ? <FormError>{error}</FormError> : null}
      </View>
    </Card>
  );
}
