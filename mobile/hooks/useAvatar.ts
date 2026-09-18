import { useMutation, useQueryClient } from '@tanstack/react-query';

import { API_BASE_URL, api, getAccessToken, getTokenGeneration } from '../lib/api';
import { useAuthedImage } from '../lib/authedImage';
import { pickImage, useImagePicker, type PickedImage } from '../lib/pickImage';
import { appendFile } from '../lib/upload';
import type { User } from '../lib/types';

/** The account shape once the server has grown its avatar flag. */
type UserWithAvatar = User & { has_avatar?: boolean };

/**
 * Whether this account has a picture.
 *
 * Read through a helper rather than off the field directly because the flag
 * arrived with the avatar endpoints, so a build talking to an older server gets
 * an answer without it. Missing has to mean "no picture" and not "undefined",
 * since the thing downstream is a boolean prop.
 */
export function hasAvatar(user: UserWithAvatar | null | undefined): boolean {
  return user?.has_avatar === true;
}

/**
 * Bumped every time the picture changes.
 *
 * There is exactly one avatar URL per account, and both React Native's image
 * cache and the browser key on the URL alone. Without something to tell them
 * apart, uploading a new photo leaves the old one on screen until the app is
 * restarted, which reads as the upload having silently failed. The counter
 * rides along as a query parameter: the server ignores it, the caches do not.
 */
let revision = 0;

export function avatarSource(token: string | null, version: number | string) {
  return {
    uri: `${API_BASE_URL}/me/avatar?v=${version}`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

/**
 * The cache key for the avatar of whoever is signed in right now.
 *
 * Both halves are load bearing. `revision` changes when this account replaces
 * its own photo. The session generation changes when a session is torn down,
 * which is the only moment `/me/avatar` can start meaning a different person:
 * the URL carries no account id, so without it user B signing in on the device
 * user A just signed out of is served A's face from cache, at full size, as
 * their own. The counter only ever goes up, so a stale entry is never reused.
 */
function avatarVersion(): string {
  return `${getTokenGeneration()}.${revision}`;
}

/**
 * Where to fetch the picture from, or undefined when there is none.
 *
 * Undefined rather than an empty string, because that is what Avatar treats as
 * "fall back to initials" and a 404 behind an Image is a blank circle.
 */
export function useAvatarSource(present: boolean) {
  return useAuthedImage(present ? avatarSource(getAccessToken(), avatarVersion()) : undefined);
}

/**
 * The longest edge a stored avatar is allowed to have.
 *
 * A phone camera hands back 4000px and several megabytes, and the server
 * refuses anything over 1000 KB, so shrinking on the device is what makes the
 * upload work at all rather than a nicety. 512 is generous: the largest circle
 * this is ever drawn in is under a hundred points.
 */
const MAX_EDGE = 512;
const QUALITY = 0.8;

/** A picked, shrunk file, ready to send. */
export type PickedAvatar = PickedImage;

/**
 * Ask for a profile picture and hand back one small enough to upload.
 *
 * Square, because it is only ever shown in a circle, and cropped in the picker
 * rather than afterwards so the person choosing it decides which part matters.
 * Shrunk harder than a meal photo for the same reason.
 */
export function pickAvatar(fromCamera: boolean): Promise<PickedAvatar | null> {
  return pickImage(fromCamera, { maxEdge: MAX_EDGE, quality: QUALITY, square: true });
}

/** pickAvatar plus the busy flag the caller would otherwise keep by hand. */
export function usePickAvatar() {
  return useImagePicker(pickAvatar);
}

/**
 * Upload or replace the picture.
 *
 * Sent as multipart straight from the local file uri rather than read into
 * memory first. React Native's fetch streams the file from that shape, so the
 * image never has to exist as a base64 string in JS, which is where uploads on
 * a phone usually fall over.
 */
export function useSetAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ uri, mimeType }: PickedAvatar) => {
      const form = new FormData();
      await appendFile(form, 'file', {
        uri,
        name: `avatar.${mimeType.split('/')[1] ?? 'jpg'}`,
        mimeType,
      });

      const response = await api.put<UserWithAvatar>('/me/avatar', form, {
        // Left to the runtime on purpose. Axios has to set the multipart
        // boundary itself, and naming the content type here strips it, which
        // makes the server reject a body it cannot parse.
        headers: { 'Content-Type': undefined },
        transformRequest: (value) => value,
      });
      return response.data;
    },
    onSuccess: (user) => {
      revision += 1;
      queryClient.setQueryData(['me'], user);
    },
  });
}

export function useRemoveAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.delete('/me/avatar');
    },
    onSuccess: () => {
      revision += 1;
      // The endpoint answers 204 and nothing else, so the one field that
      // changed is written here rather than leaving the circle showing a photo
      // that is already gone while a refetch is in flight.
      queryClient.setQueryData<UserWithAvatar>(['me'], (current) =>
        current ? { ...current, has_avatar: false } : current,
      );
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
