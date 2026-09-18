import { useMutation, useQueryClient } from '@tanstack/react-query';

import { API_BASE_URL, api, getAccessToken } from '../lib/api';
import { useAuthedImage } from '../lib/authedImage';
import { pickImage, useImagePicker, type PickedImage } from '../lib/pickImage';
import { appendFile } from '../lib/upload';
import type { FoodLog, Uuid } from '../lib/types';

/**
 * Bumped every time any meal photo changes.
 *
 * The URL for a meal's photo is derived from the meal's id, and replacing a
 * photo writes over the existing row rather than making a new one, so the URL
 * after a retake is byte for byte the URL before it. Both React Native's image
 * cache and the browser key on that URL alone, so the old picture stayed on
 * screen and the upload read as having silently failed.
 *
 * One counter for all meals rather than one per meal: replacing a photo is
 * rare, the parameter only has to change, and a map keyed by id would have to
 * be cleaned up on sign out. The server ignores it, the caches do not.
 */
let revision = 0;

/**
 * Where the image for a meal lives.
 *
 * A plain URL rather than a fetched blob, because React Native's Image handles
 * its own caching and decoding far better than anything done by hand here. The
 * request needs the bearer token, which is why the header goes along with it.
 */
export function photoSource(logId: Uuid, token: string | null, version = revision) {
  return {
    uri: `${API_BASE_URL}/logs/${logId}/photo?v=${version}`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

/**
 * Null while a meal is still being written, when there is no id to fetch from.
 *
 * Passed through useAuthedImage, which is the identity function on iOS and
 * Android and does the fetch-to-object-url dance on web, where Image cannot
 * send the Authorization header this source carries.
 */
export function usePhotoSource(logId: Uuid | null) {
  return useAuthedImage(logId === null ? undefined : photoSource(logId, getAccessToken()));
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
export type PickedPhoto = PickedImage;

/**
 * Ask for a meal photo and hand back one small enough to upload.
 *
 * Named rather than inlined at the call sites because there are two callers
 * with nothing else in common: the meal screen, which has an id and uploads
 * straight away, and the log form, which has no id yet and holds the file until
 * the meal exists.
 */
export function pickPhoto(fromCamera: boolean): Promise<PickedPhoto | null> {
  return pickImage(fromCamera, { maxEdge: MAX_EDGE, quality: QUALITY });
}

/** pickPhoto plus the busy flag every caller would otherwise keep by hand. */
export function usePhotoPicker() {
  return useImagePicker(pickPhoto);
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
      await appendFile(form, 'file', {
        uri,
        name: `meal.${mimeType.split('/')[1] ?? 'jpg'}`,
        mimeType,
      });

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
      // Before the cache is told, so anything re-rendering off this reads the
      // new number and asks for a url the caches have not seen.
      revision += 1;
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
      revision += 1;
      void queryClient.invalidateQueries({ queryKey: ['log', logId] });
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
    },
  });
}
