/**
 * Choosing an image and shrinking it, which is the half meal photos and the
 * profile picture genuinely have in common.
 *
 * The two flows used to be written out twice, and the comment in one of them
 * argued for the copy on the grounds that they differ where it matters: an
 * avatar is cropped square because it is only ever drawn in a circle, and it is
 * shrunk harder because it is never viewed larger than a thumbnail. Both of
 * those are true, and both are arguments about the numbers rather than about
 * the steps. The steps were identical: ask for the permission at the moment it
 * is needed, explain it if refused, launch the camera or the library, take the
 * first asset, shrink only if it is bigger than the limit, re-encode as JPEG.
 *
 * So the numbers are parameters and the steps live here once. The resize is
 * what makes an upload succeed at all rather than a nicety, which is exactly
 * the part that must not exist in two versions that can drift apart.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

/** A picked, shrunk file, ready to upload. */
export type PickedImage = {
  /** The local file uri the manipulator wrote. */
  uri: string;
  mimeType: string;
};

export type PickImageOptions = {
  /** The longest edge the stored image is allowed to have. */
  maxEdge: number;
  /** JPEG quality, 0 to 1. */
  quality: number;
  /**
   * Crop to a square in the picker itself. Worth doing there rather than after
   * the fact, because the person choosing the picture is the only one who knows
   * which part of it matters.
   */
  square?: boolean;
};

/**
 * Ask for an image and hand back one small enough to upload.
 *
 * Returns null when the user says no, either to the permission or to the
 * picker. A failure while resizing throws, and the caller decides what that
 * looks like.
 */
export async function pickImage(
  fromCamera: boolean,
  { maxEdge, quality, square = false }: PickImageOptions,
): Promise<PickedImage | null> {
  // Requested at the moment it is needed rather than on mount, so the prompt
  // arrives with the reason for it still visible on screen.
  const permission = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(
      fromCamera ? 'Camera access is off' : 'Photo access is off',
      'You can turn it back on in Settings if you change your mind.',
    );
    return null;
  }

  // quality 1 here on purpose: this is the capture, and the compression below
  // is the one that decides the file size. Compressing twice only loses detail.
  const common = square
    ? { quality: 1, allowsEditing: true, aspect: [1, 1] as [number, number] }
    : { quality: 1 };

  const picked = fromCamera
    ? await ImagePicker.launchCameraAsync(common)
    : await ImagePicker.launchImageLibraryAsync({ ...common, mediaTypes: ['images'] });
  if (picked.canceled || !picked.assets?.length) return null;

  const asset = picked.assets[0];
  // Only shrink. Scaling a small photo up would cost bytes and add nothing.
  const longest = Math.max(asset.width ?? 0, asset.height ?? 0);
  const actions =
    longest > maxEdge
      ? [asset.width >= asset.height ? { resize: { width: maxEdge } } : { resize: { height: maxEdge } }]
      : [];

  const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return { uri: result.uri, mimeType: 'image/jpeg' };
}

/**
 * A picker plus the busy flag every caller would otherwise keep by hand.
 *
 * Takes the picking function rather than the options, so the two callers each
 * keep a named entry point that says what it picks.
 */
export function useImagePicker<T>(pick: (fromCamera: boolean) => Promise<T>) {
  const [preparing, setPreparing] = useState(false);

  const run = useCallback(
    async (fromCamera: boolean) => {
      setPreparing(true);
      try {
        return await pick(fromCamera);
      } finally {
        setPreparing(false);
      }
    },
    [pick],
  );

  return { pick: run, preparing };
}
