/**
 * Turning an authenticated image URL into something Image can actually load.
 *
 * Both meal photos and avatars sit behind bearer auth, so the source carries an
 * Authorization header. The browser cannot send one from an `<img>` at all,
 * which is what the `.web` twin beside this file exists for.
 *
 * On iOS and Android the platform's own loader fetches the image, and it can
 * send the header, but only if it is handed the source in the right shape.
 */

export type AuthedSource = {
  uri: string;
  headers?: Record<string, string>;
};

/**
 * An array of one, and the array is the entire point.
 *
 * Passing `{ uri, headers }` as a plain object works on iOS and silently drops
 * the header on Android, which is why meal photos and the profile picture
 * loaded on one and were blank on the other.
 *
 * The two platforms read headers from different places. iOS takes them from
 * inside the source object: Image.ios.js passes the whole thing through and the
 * native side loops `imageSource.headers` onto the request. Android has no
 * headers field on its source at all. Its only header path is a separate
 * top-level `headers` prop, and Image.android.js sets that prop in exactly one
 * branch:
 *
 *     if (Array.isArray(source_)) {
 *       const { headers: sourceHeaders } = source_[0];
 *       if (sourceHeaders != null) nativeProps.headers = sourceHeaders;
 *     } else {
 *       const { uri, width, height } = source_;   // headers never read
 *       nativeProps.source = [source_];
 *     }
 *
 * The else branch wraps the object in an array too, but by then it has already
 * skipped the assignment, so the header is gone. Fresco then requests the photo
 * unauthenticated, the server answers 401 with a JSON body, and there is
 * nothing to decode.
 *
 * So the source is wrapped here instead. iOS takes an array on the first branch
 * of its own check and is unaffected, and a single-entry array still takes
 * Android's optimised one-source path.
 */
export function useAuthedImage(source: AuthedSource | undefined): AuthedSource[] | undefined {
  return source ? [source] : undefined;
}
