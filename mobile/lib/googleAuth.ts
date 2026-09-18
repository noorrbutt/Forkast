import { useCallback, useEffect, useState } from 'react';

import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, googleConfigured } from './googleConfig';
import type { GoogleSignIn, GoogleSignInResult } from './googleTypes';

/**
 * "Continue with Google" on a phone.
 *
 * This is the native half; lib/googleAuth.web.ts is the browser half, and Metro
 * picks between them by filename, the same way MapCanvas, upload and
 * authedImage are already split in this repo. Both export the same hook, so no
 * screen ever tests which platform it is running on.
 *
 * The library is the one Expo's own guide points at. The alternative was
 * running the OAuth dance by hand through expo-auth-session, which is what the
 * web half does and has to do; on a phone it would mean a browser tab where the
 * platform offers a real account sheet, and on Android it would miss the
 * Credential Manager Google now expects.
 *
 * WHAT COMES BACK IS AN ID TOKEN, AND IT IS THE ONLY THING KEPT. Not the email,
 * the name or the picture, all of which this library hands over beside it.
 * Everything Forkast records about a Google account is read out of the token by
 * the server after checking Google's signature on it, because a field sitting
 * next to a signature is not covered by it. See backend/app/services/google.py.
 *
 * ---
 *
 * WHY THE IMPORT IS A LAZY require INSIDE A try, AND MUST STAY ONE.
 *
 * This file shipped for one evening with a plain top level import, and it broke
 * the app in Expo Go. Not the Google button: the whole sign in screen, the whole
 * sign up screen and the Profile tab.
 *
 * The chain is worth writing down because nothing about it points at this file
 * from the symptom. The package calls TurboModuleRegistry.getEnforcing on
 * RNGoogleSignin while it is being evaluated, and getEnforcing throws when the
 * native binary has no such module, which is exactly the Expo Go client. A throw
 * during module evaluation means this module never finishes loading, so every
 * module importing it never finishes either, all the way up to the route file.
 * expo-router then finds a route module with no default export and reports
 * precisely that: "Route ./(auth)/login.tsx is missing the required default
 * export". Three screens each blaming themselves for a missing export, and the
 * real cause two imports away and unmentioned.
 *
 * So the module is fetched on demand and its absence is an answer rather than an
 * exception. `ready` goes false, the screens draw no Google button, and every
 * other thing on them works exactly as it did before Google existed.
 *
 * This is the same bargain the map already makes: react-native-maps degrades to
 * the area list under Expo Go rather than taking the screen with it. A feature
 * that needs a development build is allowed to be absent. It is not allowed to
 * be load bearing for features that do not need one.
 *
 * Expo Go still cannot sign in with Google, and no arrangement of this file
 * would change that, because Google refuses to redirect to an `exp://` address
 * so the pure JavaScript route is shut there too. What changed is the cost of
 * that limitation: a hidden button instead of three dead screens.
 */

/** The shape of the package, for the lazily fetched handle below. */
type GoogleSdk = typeof import('@react-native-google-signin/google-signin');

/**
 * undefined means "not looked for yet", null means "looked for and not there".
 * The two have to be distinguishable or a missing module is re-required on
 * every call, and a throwing require is not cheap.
 */
let sdk: GoogleSdk | null | undefined;

function loadSdk(): GoogleSdk | null {
  if (sdk !== undefined) return sdk;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sdk = require('@react-native-google-signin/google-signin') as GoogleSdk;
  } catch {
    // No native module in this binary. Expo Go, or a build made before the
    // config plugin was added. Not an error, and not worth a console line on
    // every cold start: the screens ask `ready` and draw accordingly.
    sdk = null;
  }
  return sdk;
}

let configured = false;

/**
 * Told to the library once per process, rather than once per render.
 *
 * configure() is synchronous and cheap, but it is global state, and calling it
 * from a component body would reset it on every re-render of every screen
 * carrying the button.
 */
function configureOnce(): boolean {
  if (!googleConfigured) return false;
  const google = loadSdk();
  if (google === null) return false;
  if (configured) return true;

  google.GoogleSignin.configure({
    // Required even on a phone, and it is what decides the `aud` claim on the
    // token the server will check. Android has no client id of its own in code
    // at all: that client is matched by package name and signing certificate,
    // which is why a new signing key means a new Android client in the console.
    webClientId: GOOGLE_WEB_CLIENT_ID,
    // Only read on iOS, where leaving it undefined makes the flow fall back to
    // the web client and Google rejects it at the redirect.
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    // openid and email are what the server needs. profile is what supplies
    // given_name and family_name, which is the difference between an account
    // that knows what its owner is called and one that does not.
    scopes: ['openid', 'profile', 'email'],
  });
  configured = true;
  return true;
}

export function useGoogleSignIn(): GoogleSignIn {
  const [ready, setReady] = useState(false);

  // In an effect rather than in the body, because configureOnce touches module
  // level state and the first render of a screen must not have a side effect.
  useEffect(() => {
    setReady(configureOnce());
  }, []);

  const signIn = useCallback(async (): Promise<GoogleSignInResult> => {
    const google = loadSdk();
    if (google === null) {
      // Only reachable if something pressed a button the screens do not draw,
      // so it says the useful thing rather than the polite thing.
      throw new Error(
        'Google sign in needs a development build. It is not available in Expo Go.',
      );
    }
    const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = google;

    // Play Services can be missing, out of date or switched off on a device,
    // and without this the failure arrives as an unreadable native error rather
    // than as a sentence. Harmless on iOS, where it resolves immediately.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    // Drop the library's own cached session first, so the account chooser
    // actually appears. Without it a second sign in silently reuses whichever
    // account was picked the first time, which on a shared phone hands the
    // second person the first person's Forkast account.
    try {
      await GoogleSignin.signOut();
    } catch {
      // Nothing was signed in. Not a reason to stop.
    }

    try {
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return { type: 'cancelled' };

      const idToken = response.data.idToken;
      if (!idToken) {
        // Google answered without the one thing the server is able to verify,
        // and nothing else in the response is worth having on its own.
        throw new Error('Google did not return a sign in token. Try again.');
      }
      return { type: 'success', idToken };
    } catch (error) {
      // Backing out is not a failure and must not be drawn as one. IN_PROGRESS
      // is the same story told differently: a second press while the sheet is
      // already open, which should leave the first one alone rather than put a
      // red line under it. Everything else is rethrown for the screen to say.
      if (
        isErrorWithCode(error) &&
        (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS)
      ) {
        return { type: 'cancelled' };
      }
      throw error;
    }
  }, []);

  return { ready, signIn };
}
