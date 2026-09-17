/**
 * Turning an authenticated image URL into something Image can actually load.
 *
 * Both meal photos and avatars sit behind bearer auth, so the source carries an
 * Authorization header. React Native's Image sends that header, so on iOS and
 * Android there is nothing to do and this is the identity function.
 *
 * The browser cannot do that at all, which is what the `.web` twin beside this
 * file exists for. Keeping the two behind one hook means no screen has to know
 * which platform it is on, and the header never reaches a renderer that would
 * quietly ignore it.
 */

export type AuthedSource = {
  uri: string;
  headers?: Record<string, string>;
};

export function useAuthedImage(source: AuthedSource | undefined): AuthedSource | undefined {
  return source;
}
