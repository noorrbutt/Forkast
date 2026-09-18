// The app config, as a module rather than app.json, so the Google Maps key can
// come from the environment instead of being committed.
//
// Android is the only platform that needs it. react-native-maps uses Google
// Maps there and renders a blank grey map without a key, while iOS uses Apple
// Maps and needs nothing. The key is not secret in the way an API token is,
// since it ships inside the APK either way, but it is account specific and
// belongs restricted by package name and SHA-1 in the Google Cloud console
// rather than pasted into version control.
//
// None of this applies in Expo Go, where the map falls back to the area list on
// Android regardless: a config plugin only runs during a native build.
//
// There is deliberately no app.json beside this file. Expo reads only one of
// the two, and keeping both is how a change gets made in the file that is being
// ignored.

/**
 * Copies of the tokens this file needs, from theme/tokens.ts.
 *
 * Native config is read by Expo's CLI before any TypeScript is compiled, so
 * tokens.ts cannot be imported here. Saying "change both at once" in a comment
 * is not a mechanism, and it did not hold: INK was #0E0E10 against a page of
 * #0A0908, and PAPER was #FAFAF7, which is the exact pre-rebuild page colour
 * that contrast.test.ts was written to get rid of. The splash therefore painted
 * one background and the app painted a different, warmer one a frame later, on
 * the launch every user sees every time.
 *
 * __tests__/native-safety.test.ts now asserts these three against the palette,
 * so the next drift fails a test instead of shipping.
 */
const INK = '#0A0908';
const PAPER = '#F4F1EE';
const SAFFRON = '#F5A524';

/**
 * Hosts a shipped build must never be pointed at.
 *
 * Loopback is the phone itself once the bundle is on a handset, and the private
 * ranges are somebody's laptop on somebody's Wi-Fi. Both work perfectly in
 * development and fail for every single user in production.
 */
function isUnreachableFromTheOutsideWorld(hostname) {
  if (hostname === 'localhost' || hostname === '::1') return true;
  if (/^127\./.test(hostname)) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  return false;
}

/**
 * Refuse to build a binary that cannot reach the API.
 *
 * EXPO_PUBLIC_ values are inlined into the JS bundle at build time, so whatever
 * this variable holds when EAS runs is burned into the release and cannot be
 * changed without shipping a new one. lib/api.ts falls back to
 * http://localhost:8010 when it is unset, which on a phone means the phone
 * itself: every request fails, the app is unusable, and nothing in the build
 * output says why. This is the last point at which that mistake is still cheap.
 *
 * Preview builds only have to be pointed somewhere deliberately, since a LAN
 * address is the whole point of handing an APK to someone on the same Wi-Fi.
 * Production additionally has to be public and https. The development profile
 * is left alone; it sets the address in eas.json and reads .env.local locally.
 */
function assertApiUrlForBuildProfile() {
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile !== 'production' && profile !== 'preview') return;

  const raw = process.env.EXPO_PUBLIC_API_URL;
  if (!raw) {
    throw new Error(
      `EXPO_PUBLIC_API_URL is not set for the ${profile} profile. Set it with ` +
        `"eas env:create --environment ${profile}" and build again. Without it ` +
        'the build would call http://localhost:8010 on the phone of every user. ' +
        'See docs/PLAY_STORE.md.',
    );
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`EXPO_PUBLIC_API_URL is not a valid URL: ${raw}`);
  }

  if (profile !== 'production') return;

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `EXPO_PUBLIC_API_URL must be https for a production build, got ${raw}. ` +
        'Android blocks cleartext traffic by default, and account credentials ' +
        'travel over this origin.',
    );
  }

  if (isUnreachableFromTheOutsideWorld(parsed.hostname)) {
    throw new Error(
      `EXPO_PUBLIC_API_URL points at ${parsed.hostname}, which is a loopback or ` +
        'private network address. A published build must point at a publicly ' +
        'hosted API. See docs/PLAY_STORE.md.',
    );
  }
}

const config = {
      "name": "Forkast",
      "slug": "forkast",
      "version": "1.0.0",
      "orientation": "portrait",
      "icon": "./assets/icon.png",
      "userInterfaceStyle": "automatic",
      // Ties a build to the updates it may accept. Nothing publishes updates
      // yet, but pinning the policy now means the first expo-updates release
      // cannot hand an old binary a bundle built against newer native code.
      "runtimeVersion": {
        "policy": "appVersion"
      },
      "ios": {
        "supportsTablet": true,
        "bundleIdentifier": "com.forkast.app"
      },
      "android": {
        "adaptiveIcon": {
          // Ink, not the pale blue the Expo template ships. The launcher draws
          // one icon for both system themes, so this is the brand's dark end
          // rather than whichever background the phone happens to be using.
          "backgroundColor": INK,
          "foregroundImage": "./assets/android-icon-foreground.png",
          "monochromeImage": "./assets/android-icon-monochrome.png"
        },
        // Merged in on top of whatever the native modules declare. Both of
        // these already arrive through expo-notifications' own manifest;
        // naming them here is what keeps a future permission audit from
        // quietly dropping the reminders feature.
        //
        // POST_NOTIFICATIONS is the Android 13 runtime permission that
        // lib/notifications.ts asks for. RECEIVE_BOOT_COMPLETED is what lets a
        // scheduled reminder survive a restart.
        "permissions": [
          "android.permission.POST_NOTIFICATIONS",
          "android.permission.RECEIVE_BOOT_COMPLETED"
        ],
        // Stripped back out of the merged manifest. All three arrive from
        // Expo's bare Android template rather than from anything Forkast
        // calls, and Play makes you account for every one of them: the storage
        // pair shows up in the data safety form, and SYSTEM_ALERT_WINDOW is
        // listed as "display over other apps", which is a strange thing for a
        // food diary to ask for and invites a policy review. The only cost is
        // that React Native's debug overlay cannot float above other apps.
        "blockedPermissions": [
          "android.permission.SYSTEM_ALERT_WINDOW",
          "android.permission.READ_EXTERNAL_STORAGE",
          "android.permission.WRITE_EXTERNAL_STORAGE"
        ],
        "predictiveBackGestureEnabled": false,
        "package": "com.forkast.app"
      },
      // There was no web key at all, so the browser build shipped with the Expo
      // default tab icon and no colour of its own, on a platform this app is
      // actually tested and bundled for.
      "web": {
        "bundler": "metro",
        // 64x64, already in assets and referenced by nothing until now.
        "favicon": "./assets/favicon.png",
        // The colour a browser tints its own chrome with, on the platforms that
        // do. One value, not one per scheme: the SPA output writes its own
        // index.html and there is no supported hook to put a
        // prefers-color-scheme rule in it. Ink rather than paper, because dark
        // is what this app falls back to when a device states no preference.
        //
        // The white flash before the bundle paints is therefore still there.
        // Fixing it needs app/+html.tsx, which only applies to static rendering,
        // and switching this build to static emptied the title on all thirteen
        // generated pages: expo-router writes its own title tag first and the
        // browser takes that one. That is a bigger change and a worse trade than
        // the flash it buys.
        "themeColor": INK
      },
      "plugins": [
        "expo-router",
        "expo-status-bar",
        "expo-secure-store",
        // Pulled in by @expo/vector-icons. Listed explicitly so a native build
        // bundles the icon fonts rather than shipping an app full of blanks.
        "expo-font",
        "expo-asset",
        [
          // The native launch screen, which is what fills the gap between the
          // launcher icon and the first React render. Without it the app opens
          // on a white flash even when the phone is in dark mode.
          //
          // Two marks rather than one recoloured at runtime: a native splash is
          // a static drawable chosen by the system before any JS runs. They are
          // the same two saffrons the palettes use, so the launch screen lands
          // on the colour the first screen is about to paint.
          "expo-splash-screen",
          {
            "image": "./assets/splash-icon.png",
            "imageWidth": 130,
            "resizeMode": "contain",
            "backgroundColor": PAPER,
            "dark": {
              "image": "./assets/splash-icon-dark.png",
              "backgroundColor": INK
            }
          }
        ],
        [
          // Android renders a notification icon as a flat silhouette of
          // whatever it is given, so the app icon would arrive as a solid
          // saffron block. notification-icon.png is the mark already drawn as
          // white on transparent, which is the only shape that survives.
          "expo-notifications",
          {
            "icon": "./assets/notification-icon.png",
            "color": SAFFRON
          }
        ]
      ],
      "scheme": "forkast"
    };

module.exports = () => {
  assertApiUrlForBuildProfile();

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return config;

  return {
    ...config,
    android: {
      ...config.android,
      config: { googleMaps: { apiKey } },
    },
  };
};
