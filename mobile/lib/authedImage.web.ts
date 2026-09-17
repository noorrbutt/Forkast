import { useEffect, useState } from 'react';

import type { AuthedSource } from './authedImage';

export type { AuthedSource } from './authedImage';

/**
 * The browser half of the authenticated image seam.
 *
 * react-native-web renders Image as an `<img>` and sets `src` directly, so
 * `source.headers` is dropped on the floor. Every meal photo and every profile
 * picture therefore requested without the bearer token, got a 401 and rendered
 * as an empty box. Worse for the avatar, which falls back to initials only when
 * the uri is missing: a uri that is present but unloadable gave a blank circle
 * rather than the fallback it was designed to have.
 *
 * So on web the bytes are fetched properly, with the header, and handed to
 * Image as an object URL. The cost is that the browser's own image cache no
 * longer applies, which is why the object URL is held for as long as the
 * component is mounted and revoked exactly once when it is not. Leaving them
 * unrevoked leaks the whole image into the tab for its lifetime, and a diary
 * scrolled for a while is a lot of images.
 */
export function useAuthedImage(source: AuthedSource | undefined): AuthedSource | undefined {
  const [resolved, setResolved] = useState<AuthedSource | undefined>(undefined);

  // The header is part of the identity of the request: the token changes on
  // refresh, and a stale one would keep serving a 401. Serialised rather than
  // passed as an object so the effect compares by value.
  const uri = source?.uri;
  const auth = source?.headers?.Authorization;

  useEffect(() => {
    if (!uri) {
      setResolved(undefined);
      return;
    }

    let live = true;
    let objectUrl: string | null = null;

    const run = async () => {
      try {
        const response = await fetch(uri, {
          headers: auth ? { Authorization: auth } : undefined,
        });
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        // Checked after every await: the row may have scrolled away, and
        // setting state on an unmounted component is both a warning and a leak
        // of the object URL that would never be revoked.
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved({ uri: objectUrl });
      } catch {
        // Undefined rather than the failing url, so Avatar falls back to
        // initials and MealPhoto shows its empty state instead of a broken
        // image icon. A photo that will not load is indistinguishable from one
        // that is not there, and the empty state is the honest rendering.
        if (live) setResolved(undefined);
      }
    };

    void run();

    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, auth]);

  return resolved;
}
