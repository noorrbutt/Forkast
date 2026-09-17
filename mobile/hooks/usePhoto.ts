import { useMutation, useQueryClient } from '@tanstack/react-query';

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

export function usePhotoSource(logId: Uuid) {
  return photoSource(logId, getAccessToken());
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
