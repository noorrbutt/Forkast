# Publishing the browser demo

The browser build is a demo surface, not the product. It runs the same screens
as the phone app through react-native-web, with a fallback wherever a native
module has nothing to offer a browser. This is how to build and host it.

## Build

From `mobile/`:

```sh
npx expo export --platform web
```

No extra flags. The output lands in `mobile/dist/` (gitignored) and is a
**single page app**: one `index.html`, one JS bundle under `_expo/static/js/web/`,
and the assets beside it. `app.config.js` leaves `web.output` at its default on
purpose; its comment explains why static rendering was tried and backed out.

Every `EXPO_PUBLIC_` value is inlined into the bundle when this command runs.
Changing one means building again, not restarting a server.

## Environment

Set these in the shell, in `mobile/.env.local`, or in the host's build
environment. Never put a secret in any of them: they ship in plaintext.

| Variable | Needed | What happens without it |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | Yes | The app calls `http://localhost:8010`, which in a visitor's browser is their own machine. Every request fails. Set it to the backend's public https origin, e.g. `https://your-backend.example.com` (placeholder). |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | No | The "Continue with Google" button is not drawn, on web exactly as on a phone. |
| `EXPO_PUBLIC_DEMO_HINT` | No | Must be exactly `true` to show the demo account line on sign in. Anything else shows nothing. |
| `EXPO_PUBLIC_DEMO_EMAIL` | With the hint | The line is not shown. |
| `EXPO_PUBLIC_DEMO_PASSWORD` | With the hint | The line is not shown. Use a throwaway account; this is printed on the page. |

`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_APP_DOMAIN` and
`GOOGLE_MAPS_API_KEY` have no effect on the web build.

### Google sign in on web

Optional. With a web client id set, `lib/googleAuth.web.ts` runs Google's
implicit flow in a popup instead of the native SDK. For that to work, the
deployed origin (e.g. `https://your-demo.example.com`) has to be added to the
Web client in the Google Cloud console under both authorised JavaScript origins
and authorised redirect URIs, and the backend's `GOOGLE_CLIENT_IDS` must include
the same client id.

### The backend

The browser enforces CORS where a phone does not. The backend must list the
deployed demo origin among its allowed origins, or every request fails before
it is sent, with nothing in the app's error to say why.

## What behaves differently in a browser

| Feature | Native module | On web |
| --- | --- | --- |
| Photo logging | `expo-image-picker` | Both "Take a photo" and "Choose from library" open the browser's file picker (a phone browser may offer its camera for the first). Permissions are not asked. The resize runs on a canvas and the upload converts the file to a Blob in `lib/upload.web.ts`. |
| Map | `react-native-maps` | `components/MapCanvas.web.tsx` never imports it, so `/map` shows the area list instead. |
| Sign in tokens | `expo-secure-store` | No web build. `lib/tokenStore.ts` uses `sessionStorage`, so a session survives a reload and ends with the tab. |
| Streak milestones seen | `expo-secure-store` | Kept in memory, so a celebration may replay after a reload. |
| Google sign in | `@react-native-google-signin/google-signin` | Replaced by `lib/googleAuth.web.ts`; hidden when unconfigured. |
| Haptics | `expo-haptics` | Vibrates where the browser can, otherwise nothing. Every failure is swallowed in `lib/haptics.ts`. |
| Reminders | `expo-notifications` | Offered as unavailable. There is no scheduler in a browser. |
| Pull to refresh | React Native's `RefreshControl` | Inert; data refreshes when the tab regains focus instead. |

`__tests__/web-parity.test.ts` asserts each of these against the source, so a
change that quietly reintroduces a native only path fails a test.

## Deploy to Vercel

`mobile/vercel.json` holds the build command, the output folder and a catch-all
rewrite to `index.html`. The rewrite is what makes a refresh on `/map` or a
pasted link to `/logs/<id>` load the app instead of a 404: there is only one
HTML file, and Expo Router reads the path once the bundle is running. Vercel
serves a real file before applying a rewrite, so the bundle and assets are
unaffected.

1. Import the repository in Vercel and set **Root Directory** to `mobile`.
   The framework preset can stay on "Other"; `vercel.json` supplies the rest.
2. Add the environment variables above under Project Settings, for the
   Production environment at least.
3. Deploy. Then add the deployment's origin to the backend's CORS list, and to
   the Google console if Google sign in is on.

From a terminal instead: `npx vercel --prod` from `mobile/`, after `npx vercel
link` and setting the same variables with `npx vercel env add`.

Netlify works too but needs its own rewrite (`/* /index.html 200` in a
`public/_redirects` file); only the Vercel file is kept here.
