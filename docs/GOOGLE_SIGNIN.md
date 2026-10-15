# Continue with Google

Off unless you configure it. With no client ids the button is not drawn, the
`/auth/google` route answers 503, and everything else works exactly as before.
With no audience to check a token against, a token whose audience nobody checks
is one anybody can mint for their own Google client, so the route stays shut.

You need three OAuth clients, because Google issues one per platform and the
token the app sends carries whichever client asked for it. In the Google Cloud
console, under Google Auth Platform then Clients:

| Client | What it asks for | Where the value comes from |
| --- | --- | --- |
| Android | Package name and SHA-1 | `com.forkast.app`, and the fingerprint of whichever key signs the build |
| iOS | Bundle ID | `com.forkast.app` |
| Web | Authorised JavaScript origins and redirect URIs | the origin the browser build is served from, exactly as typed |

Register one Android client per signing key, not one in total. A debug build, an
EAS build and a Play release are signed by three different keys and Google
matches on the fingerprint.

```bash
# The key a local `npx expo run:android` build is signed with
keytool -keystore ~/.android/debug.keystore -list -v -alias androiddebugkey -storepass android

# The key EAS signs with
eas credentials
```

For the Play Store, use the fingerprint under "App signing key certificate" in
the Play Console (Test and release, Setup, App signing), not the upload key, or
sign in works for you and for nobody who installed from Play.

Then set the ids. The client ids are not secrets: an OAuth client id ships inside
the bundle. What protects an account is the API refusing a token whose audience
it was not told about. A client secret, if Google hands you one, belongs in none
of these files.

```bash
# backend/.env: web and iOS ids, comma separated. Android has no id of its own;
# that client is matched by package name and fingerprint.
GOOGLE_CLIENT_IDS=<web id>,<ios id>

# mobile/.env.local, for a local run
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web id>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios id>

# EAS, for a build, which never sees your local environment
eas env:create --environment development --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value "<web id>"
eas env:create --environment development --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID --value "<ios id>"
```

The web client id is needed on every platform, the phone included: it is the
audience the ID token is minted for on Android. The iOS URL scheme is derived
from the iOS id by the app config, so there is no fourth value to keep in step.

**It does not work in Expo Go.** The sign in library ships native code, so the Go
client cannot load it. Build a development client. Google also refuses to
redirect to an `exp://` address, so the pure JavaScript route is shut there too.
