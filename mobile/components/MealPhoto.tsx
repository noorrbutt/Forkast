import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from 'react-native';

import { useRemovePhoto, useSetPhoto, usePhotoSource } from '../hooks/usePhoto';
import { describeError } from '../lib/api';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme';
import type { Uuid } from '../lib/types';
import { Button, Icon, SectionLabel } from './ui';

/**
 * The longest edge a stored photo is allowed to have.
 *
 * A modern phone camera produces 4000px and several megabytes, and the server
 * refuses anything over 1000 KB. Resizing on the device rather than rejecting
 * the upload is the difference between the feature working and the feature
 * looking broken, and 1280px is still more detail than a meal photo in a diary
 * will ever be viewed at.
 */
const MAX_EDGE = 1280;
const QUALITY = 0.7;

type Props = {
  logId: Uuid;
  hasPhoto: boolean;
};

/**
 * The picture on a meal.
 *
 * Text only logs read like a spreadsheet, so this is the part that makes the
 * diary feel like one. Everything here is optional: a meal without a photo is
 * complete, and nothing nags about it.
 */
export function MealPhoto({ logId, hasPhoto }: Props) {
  const { colors, radius, spacing, type } = useTheme();
  const source = usePhotoSource(logId);
  const upload = useSetPhoto();
  const remove = useRemovePhoto();
  const [preparing, setPreparing] = useState(false);

  const busy = preparing || upload.isPending || remove.isPending;

  const attach = async (fromCamera: boolean) => {
    if (busy) return;

    // Permissions are requested at the moment they are needed rather than on
    // mount, so the prompt arrives with the reason for it visible on screen.
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        fromCamera ? 'Camera access is off' : 'Photo access is off',
        'You can turn it back on in Settings if you change your mind.',
      );
      return;
    }

    const picked = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 1,
        });
    if (picked.canceled || !picked.assets?.length) return;

    const asset = picked.assets[0];
    setPreparing(true);
    try {
      // Only shrink. Scaling a small photo up would cost bytes and add nothing.
      const longest = Math.max(asset.width ?? 0, asset.height ?? 0);
      const actions =
        longest > MAX_EDGE
          ? [
              asset.width >= asset.height
                ? { resize: { width: MAX_EDGE } }
                : { resize: { height: MAX_EDGE } },
            ]
          : [];

      const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      });

      await upload.mutateAsync({ logId, uri: result.uri, mimeType: 'image/jpeg' });
      haptics.success();
    } catch {
      haptics.error();
    } finally {
      setPreparing(false);
    }
  };

  const confirmRemove = () => {
    if (busy) return;
    Alert.alert('Remove this photo?', 'The meal itself stays in your diary.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          remove.mutate(logId, {
            onSuccess: () => haptics.tap(),
            onError: () => haptics.error(),
          });
        },
      },
    ]);
  };

  const error = upload.isError ? upload.error : remove.isError ? remove.error : null;

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="meal" size={18} />
        <SectionLabel>Photo</SectionLabel>
      </View>

      {hasPhoto ? (
        <Pressable
          onPress={confirmRemove}
          accessibilityRole="imagebutton"
          accessibilityLabel="Meal photo"
          accessibilityHint="Opens the option to remove this photo"
          disabled={busy}
          style={{
            borderRadius: radius.card,
            overflow: 'hidden',
            backgroundColor: colors.surfaceAlt,
            aspectRatio: 4 / 3,
          }}
        >
          <Image
            source={source}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
          {busy ? (
            <View
              style={{
                ...StyleSheetAbsoluteFill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.scrim,
              }}
            >
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}
        </Pressable>
      ) : (
        <Text style={[type.caption, { color: colors.muted }]}>
          Optional. A picture turns a list of dishes into something worth looking back at.
        </Text>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
        <Button
          label={hasPhoto ? 'Retake' : 'Take a photo'}
          icon="meal"
          variant={hasPhoto ? 'secondary' : 'primary'}
          onPress={() => void attach(true)}
          disabled={busy}
          loading={preparing || upload.isPending}
        />
        <Button
          label="Choose"
          variant="secondary"
          onPress={() => void attach(false)}
          disabled={busy}
        />
        {hasPhoto ? (
          <Button
            label="Remove"
            variant="ghost"
            onPress={confirmRemove}
            disabled={busy}
            loading={remove.isPending}
          />
        ) : null}
      </View>

      {error ? (
        <Text style={[type.caption, { color: colors.danger }]}>{describeError(error)}</Text>
      ) : null}
    </View>
  );
}

/** Inlined so this file does not pull StyleSheet in for one constant. */
const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
