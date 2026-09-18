import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useMemo } from 'react';

import { GOOGLE_WEB_CLIENT_ID, googleConfigured } from './googleConfig';
import type { GoogleSignIn, GoogleSignInResult } from './googleTypes';

/**
 * "Continue with Google" in a browser.
 *
 * The browser half of the split described in lib/googleAuth.ts, chosen by Metro
 * on filename. Same hook, same return shape, so the screens never ask which
 * platform they are on.
 *
 * A different library from the native half, and not from indecision. The one
 * Expo recommends runs Google's native sign in SDKs, and its web support is
 * behind a paid licence; expo-auth-session is the plain OAuth client Expo ships
 * and it is all a browser actually needs, because a browser already has the
 * thing a phone has to be given, which is a place to redirect back to.
 *
 * The implicit flow, asking Google for an ID token directly, rather than the
 * authorisation code flow the phone uses. Not a shortcut: Google requires a
 * client secret at the token endpoint for a Web client, and a secret in a
 * browser bundle is not a secret. Asking for `id_token` skips that exchange
 * entirely, which is exactly right here because the ID token is the only thing
 * Forkast wants. No access token is requested and none is kept.
 *
 * What still has to be true for this to work: the page's own origin has to be
 * registered on the Web client in the Google console, under both authorised
 * JavaScript origins and authorised redirect URIs. Google matches it exactly,
 * so http://localhost:8081 and http://127.0.0.1:8081 are two different entries
 * and a deployed build needs its real origin added as well.
 */

// Closes the popup and hands the result back to the tab that opened it. A no-op
// anywhere it is not needed, and without it on web the flow completes in a
// window that then just sits there.
WebBrowser.maybeCompleteAuthSession();

// Written out rather than discovered at runtime through useAutoDiscovery. The
// discovery document is a network request, it would sit in front of the button
// becoming usable, and these two URLs have been stable for years.
const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

/**
 * A single use value Google binds into the token it issues.
 *
 * Required: Google refuses an `id_token` response without one. It is what ties
 * the token to this particular sign in attempt rather than to any earlier one.
 *
 * randomUUID rather than Math.random, and this file can reach for it directly
 * because it only ever runs in a browser, where the Web Crypto API is a given.
 */
function newNonce(): string {
  return globalThis.crypto.randomUUID();
}

export function useGoogleSignIn(): GoogleSignIn {
  // Fixed for the life of the page. makeRedirectUri gives the origin the app is
  // actually being served from, which is what has to match the console entry.
  const redirectUri = useMemo(() => AuthSession.makeRedirectUri(), []);

  const signIn = useCallback(async (): Promise<GoogleSignInResult> => {
    const request = new AuthSession.AuthRequest({
      clientId: GOOGLE_WEB_CLIENT_ID,
      redirectUri,
      // openid and email are what the server needs; profile is what carries
      // given_name and family_name.
      scopes: ['openid', 'profile', 'email'],
      responseType: AuthSession.ResponseType.IdToken,
      // PKCE belongs to the code flow and has nothing to exchange here. Left on,
      // expo-auth-session sends a challenge Google has no use for.
      usePKCE: false,
      extraParams: { nonce: newNonce() },
    });

    const result = await request.promptAsync(DISCOVERY);

    // Three ways to end up here without a token, none of which is a fault:
    // the window was closed, the user pressed cancel on Google's page, or the
    // browser blocked the popup and nothing opened. Only the last is worth a
    // word, and it is indistinguishable from the other two from here, so all
    // three are simply "they did not sign in".
    if (result.type !== 'success') return { type: 'cancelled' };

    // A refusal from Google itself. `error_description` is Google's own words
    // and is more use than anything that could be written here.
    if (result.params.error) {
      throw new Error(result.params.error_description ?? result.params.error);
    }

    const idToken = result.params.id_token;
    if (!idToken) {
      throw new Error('Google did not return a sign in token. Try again.');
    }
    return { type: 'success', idToken };
  }, [redirectUri]);

  // No configure step and nothing to wait for, so readiness is only ever the
  // question of whether this build was given a client id.
  return { ready: googleConfigured, signIn };
}
