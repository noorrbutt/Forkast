import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { API_BASE_URL, api, getAccessToken } from '../lib/api';
import type { FoodLog, Uuid } from '../lib/types';

/**
 * Where the image for a meal lives.
 *
 * A plain URL rather than a fetched blob, because React Native's Image handles
 * its own caching and decoding far better than anything done by hand here. The
 * request needs the bearer token, which is why the header goes along with it.
 */
export function photoSource(logId: Uuid, token: string | null) {
  return {
    uri: `${API_BASE_URL}/logs/${logId}/photo`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

/** Null while a meal is still being written, when there is no id to fetch from. */
export function usePhotoSource(logId: Uuid | null) {
  return logId === null ? undefined : photoSource(logId, getAccessToken());
}

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

/** A picked, shrunk file, ready to send whenever there is a log to send it to. */
export type PickedPhoto = {
  /** The local file uri the manipulator wrote. */
  uri: string;
  mimeType: string;
};

/**
 * Ask for a photo and hand back one small enough to upload.
 *
 * This lives here rather than in the component that shows the picture because
 * there are two callers with nothing else in common: the meal screen, which has
 * an id and uploads straight away, and the log form, which has no id yet and
 * holds the file until the meal exists. The resize is what makes an upload
 * succeed at all, so it is the one part that must not be written twice.
 *
 * Returns null when the user says no, either to the permission or to the
 * picker. A failure while resizing throws, and the caller decides what that
 * looks like.
 */
export async function pickPhoto(fromCamera: boolean): Promise<PickedPhoto | null> {
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
    return null;
  }

  const picked = fromCamera
    ? await ImagePicker.launchCameraAsync({ quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
  if (picked.canceled || !picked.assets?.length) return null;

  const asset = picked.assets[0];
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

  return { uri: result.uri, mimeType: 'image/jpeg' };
}

/** pickPhoto plus the busy flag every caller would otherwise keep by hand. */
export function usePhotoPicker() {
  const [preparing, setPreparing] = useState(false);

  const pick = useCallback(async (fromCamera: boolean) => {
    setPreparing(true);
    try {
      return await pickPhoto(fromCamera);
    } finally {
      setPreparing(false);
    }
  }, []);

  return { pick, preparing };
}

type UploadArgs = {
  logId: Uuid;
  /** The local file uri the picker or camera returned. */
  uri: string;
  mimeType: string;
};

/**
 * Attach or replace the picture on a meal.
 *
 * Sent as multipart from the local file uri rather than read into memory first.
 * React Native's fetch understands this shape and streams the file, so a photo
 * never has to exist as a base64 string in JS, which is where image uploads on
 * a phone usually fall over.
 */
export function useSetPhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ logId, uri, mimeType }: UploadArgs) => {
      const form = new FormData();
      // The cast is unavoidable: React Native accepts this object where the DOM
      // types insist on a Blob, and there is no Blob for a file uri here.
      form.append('file', {
        uri,
        name: `meal.${mimeType.split('/')[1] ?? 'jpg'}`,
        type: mimeType,
      } as unknown as Blob);

      const response = await api.put<FoodLog>(`/logs/${logId}/photo`, form, {
        // Left to the runtime on purpose. Axios has to set the multipart
        // boundary itself, and naming the content type here strips it, which
        // makes the server reject a body it cannot parse.
        headers: { 'Content-Type': undefined },
        transformRequest: (value) => value,
      });
      return response.data;
    },
    onSuccess: (log) => {
      queryClient.setQueryData(['log', log.id], log);
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
    },
  });
}

export function useRemovePhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (logId: Uuid) => {
      await api.delete(`/logs/${logId}/photo`);
      return logId;
    },
    onSuccess: (logId) => {
      void queryClient.invalidateQueries({ queryKey: ['log', logId] });
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
    },
  });
}
