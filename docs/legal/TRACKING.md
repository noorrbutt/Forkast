# Tracking and Storage Disclosure

*The mobile equivalent of a cookie policy. Forkast has no website and sets no
cookies, so this describes what it stores on your device and what it tracks,
which is the question a cookie policy is really answering.*

**Last updated:** [[FILL: date you publish this]]

---

## The short version

Forkast does not track you. There are no cookies, no advertising identifiers,
no analytics, and no third-party tracking software of any kind in the app.

Everything it stores on your device is there to make the app work at all, and
all of it is deleted when you uninstall.

## What is stored on your device

| What | Where | Why | Cleared when |
|---|---|---|---|
| Your sign-in tokens | The device keychain (iOS) or Keystore (Android), via `expo-secure-store` | Staying signed in between launches | You sign out, or uninstall |
| Your chosen reminder times | Device storage | Scheduling the reminder you asked for | You turn reminders off, or uninstall |
| Cached images and API responses | Device memory and cache | So the diary does not reload from scratch every time you open it | The system reclaims the cache, or you uninstall |

On the web build, sign-in tokens are kept in the browser's `localStorage`
instead, because a browser has no keychain. They are cleared when you sign out.

None of this is readable by another app, and none of it is sent anywhere except
your sign-in token, which is sent to the Forkast API to prove it is you.

## What is not there

To be specific, because "we value your privacy" is not an answer:

- **No cookies.** The app is not a website.
- **No advertising identifier.** Forkast never reads the IDFA on iOS or the
  Advertising ID on Android.
- **No analytics SDK.** No Firebase Analytics, Google Analytics, Sentry,
  Crashlytics, Mixpanel, Amplitude, Segment, PostHog, or anything comparable.
- **No attribution or install-tracking SDK.** No AppsFlyer, Adjust, Branch, or
  Facebook SDK.
- **No fingerprinting.** Forkast does not build a device signature from your
  settings, fonts, or hardware.
- **No cross-app or cross-site tracking**, which is why iOS never shows you the
  "Allow Forkast to track you?" prompt: there is nothing it would be asking
  about. See `docs/legal/STORE_DISCLOSURES.md` for the reasoning in full.

You can check all of this rather than taking our word for it: the app's complete
dependency list is `mobile/package.json` in the public repository.

## Your IP address

Every request to any server on the internet carries your IP address, and
Forkast's API is no exception. It is used for one thing: counting sign-in
attempts, so that somebody cannot try passwords against your account without
limit.

The record it is kept in is deleted automatically after 24 hours. Addresses
longer than the column allows are stored as a SHA-256 hash rather than
truncated. It is never used to identify you, to profile you, or to work out
where you are.

## Notifications

If you turn reminders on, Forkast asks the operating system for permission to
send you a notification, and schedules those reminders **on your device**. They
are not sent from a server, so no push service is involved and nothing about
your reminders leaves the phone.

Turning reminders off in the app stops them. Revoking the permission in your
device settings also stops them.

## The map

On Android the map screen is drawn by Google's mapping software, which collects
device and usage data under Google's own terms and is outside our control. On
iOS the map uses Apple Maps.

The map shows restaurants you have logged meals at, positioned from coordinates
stored on our server. **Forkast never asks your device for your location** and
has no location permission. If a pin is near you, it is because you told Forkast
you ate there.

## Changes

If Forkast ever adds anything that tracks you, this document will say so before
it ships, and on iOS you would see the App Tracking Transparency prompt at that
point.
