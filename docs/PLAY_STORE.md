# Publishing Forkast on Google Play

Status: the app config is ready. Nothing else is.

## Read this first

Forkast cannot be published today, and the reason has nothing to do with the app.

The API runs as `uvicorn app.main:app --host 0.0.0.0 --port 8010` on a laptop,
reachable at a DHCP address on one Wi-Fi network. There is no Dockerfile, no
Procfile, no `fly.toml`, no hosting of any kind anywhere in this repository. A
published build gets downloaded by strangers on mobile networks in other
countries. Every one of them would see a spinner, then a timeout, on the login
screen, and there would be nothing they could do about it.

So the first item on this list is not a checkbox, it is a project:

**Host the FastAPI backend somewhere public, behind HTTPS, with a managed
Postgres, and point the app at that hostname.** Fly.io, Railway and Render all
take a FastAPI app with about a day of work. You also need to move `GROQ_API_KEY`,
the JWT secret and the database URL into that host's secrets, set the CORS origins
for the deployed origin, and run the Alembic migrations against the hosted
database. Until that exists, everything below is preparation.

To stop this being discovered by a user rather than by you, `app.config.js` now
refuses to build the production profile at all unless `EXPO_PUBLIC_API_URL` is
set to a public HTTPS origin. A build pointed at `localhost` or at a `192.168.x`
address fails on EAS with an explanation instead of shipping.

## Done in this repo

- [x] Android adaptive icon background is ink (`#0E0E10`), not the pale blue
      `#E6F4FE` left over from the Expo template.
- [x] Icon set redrawn. Every icon in `assets/` was the stock Expo chevron, which
      is Expo's own logo and not something to publish under your name. They are
      now a saffron fork on ink: `icon.png`, the adaptive foreground and
      monochrome layers, the notification icon and the favicon.
- [x] `assets/play-store-icon.png` is the 512x512 PNG the Play listing asks for.
- [x] Splash screen wired through the `expo-splash-screen` plugin, with paper
      (`#FAFAF7`) behind a burnt amber mark in light mode and ink behind a saffron
      mark in dark mode. Those are the two saffrons `theme/tokens.ts` already
      uses, so the launch screen matches the first screen the app paints.
- [x] `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED` are declared explicitly.
      Both already arrived through the expo-notifications manifest, so this is
      documentation more than a fix, but it means a permission audit cannot
      quietly break the reminders in `lib/notifications.ts`.
- [x] `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`
      are blocked. All three come from Expo's Android template and nothing in
      Forkast uses them. `SYSTEM_ALERT_WINDOW` in particular reads as "display
      over other apps" in the Play listing, which invites questions you do not
      want to answer.
- [x] Production builds produce an `.aab`, which is what Play accepts. The
      preview profile still produces an `.apk` for sideloading to testers.
- [x] Every build profile reads its variables from the matching EAS environment,
      so the preview profile can no longer silently fall back to `localhost`
      either.
- [x] `runtimeVersion` policy is `appVersion`, so the first over the air update
      cannot be handed to a binary built against older native code.
- [x] `eas submit` is pointed at the internal test track.

## Before the first build

- [ ] `npx expo install expo-splash-screen`. The config references the plugin and
      the package is not in `package.json`, so `npx expo start` and `eas build`
      both fail until this is run. This one is required, not advisable.
- [ ] `npx expo install expo-system-ui`. Without it `userInterfaceStyle:
      "automatic"` is ignored on Android, which Expo warns about on every config
      read. The JS already follows the system theme; this is the native half.
- [ ] `eas init`. This writes `extra.eas.projectId` into the config. EAS builds
      cannot start without it.
- [ ] Set the API origin on the EAS production environment:
      `eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://your-api-host`.
      Do the same for the preview environment.
- [ ] Set `GOOGLE_MAPS_API_KEY` on both environments, and restrict that key in the
      Google Cloud console to the package name `com.forkast.app` plus the SHA-1 of
      the Play app signing certificate. An unrestricted key inside a published app
      is a bill waiting to happen.

## Things only you can do

### Google account work

- [ ] A Google Play Console developer account. One off 25 USD, plus identity
      verification that can take several days.
- [ ] Create the app in the console. The package name `com.forkast.app` is fixed
      forever at first upload, so decide now whether that is the name you want.
- [ ] Accept Play App Signing. Google holds the release key; you keep the upload
      key, which EAS generates and stores.
- [ ] Google requires a closed test with at least 12 testers running the app for
      14 continuous days before a personal developer account can go to production.
      Plan for the two weeks.

### Store listing

- [ ] Short description, 80 characters.
- [ ] Full description, 4000 characters.
- [ ] Feature graphic, 1024x500. Not generated here, because it wants a wordmark
      and no wordmark exists yet.
- [ ] At least two phone screenshots, between 320px and 3840px on each side.
- [ ] App category and a contact email address.

### Privacy policy

Play needs a publicly reachable URL, live before review. It has to cover what
Forkast actually stores, which is:

- email address and a bcrypt password hash
- timezone, goal and daily calorie target
- every food log and burn log, with timestamps
- AI generated meal plans

and one thing that is easy to forget: **food log text is sent to Groq** to
generate plans and insights. A third party processes user content, and the policy
has to say so.

### Data safety declaration

Filled in inside the console, and it has to match the list above. Expect to
declare that data is collected, is encrypted in transit, is linked to the user's
identity, and is shared with a third party service provider.

The app never asks for device location. The map draws restaurants from the
server's own data, so there is no location permission to account for.

### Account deletion

Play requires any app with account creation to offer account deletion inside the
app **and** at a public web URL. Neither exists. The API can delete individual
logs and plans but has no endpoint that deletes a user. This needs building
before submission, not after.

### Other console forms

- [ ] Content rating questionnaire.
- [ ] Target audience and content. Answer "not directed at children"; a calorie
      tracker aimed at under 13s changes the rules considerably.
- [ ] Ads declaration. Forkast has none, so answer no.
- [ ] Health apps declaration. Play asks about this for anything tracking diet.
      Forkast gives calorie guidance, so be precise that it is not a medical
      device and makes no medical claims.

## Releasing

1. Bump `version` in `mobile/app.config.js` by hand. The Android `versionCode` is
   managed on EAS servers by `autoIncrement`, so leave that alone.
2. `eas build --platform android --profile production`.
3. `eas submit --platform android --profile production`, which uploads to the
   internal track. Promote through closed and open testing in the console.

The very first submission has to be made by hand in the Play Console. The submit
API will not accept uploads for an app that has never been published.
