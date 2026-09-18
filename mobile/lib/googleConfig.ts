/**
 * The Google OAuth client ids, and whether there are enough of them to bother.
 *
 * EXPO_PUBLIC_ is correct here, and it is not the mistake the API origin
 * comment warns about. Those values are inlined into the shipped bundle in
 * plaintext, which rules out secrets; an OAuth client id for an app is not one.
 * Google publishes it inside the redirect scheme, it is readable out of any
 * installed build, and their own documentation says so. What protects an
 * account is that the backend refuses a token whose audience is not one of
 * these ids, and that check happens on a server. A client SECRET, by contrast,
 * must never appear in this file or anywhere else in the mobile app.
 *
 * Read through `process.env.NAME` written out in full, never through a
 * destructure or a computed key. Expo substitutes these at build time by
 * matching the literal text, so `process.env[name]` reads fine in development
 * and is undefined in a shipped bundle, which is the worst way for this to
 * fail.
 */

/**
 * The web client. Needed on every platform, the phone included: it is the
 * audience the ID token is minted for on Android, so without it there is
 * nothing for the server to check a token against.
 */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

/** The iOS client. Only read on iOS, where Google insists on its own. */
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

/**
 * Whether this build was given what it needs to offer Google at all.
 *
 * Keyed on the web id alone, because that is the one every platform needs. A
 * build holding an iOS id and no web id could not have a token verified
 * anywhere, so it is not half configured, it is not configured.
 */
export const googleConfigured = GOOGLE_WEB_CLIENT_ID.length > 0;
