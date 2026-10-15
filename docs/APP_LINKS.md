# App Links and Universal Links

Password reset and email verification links used to be bare `forkast://` links.
On Android any installed app can register for a custom scheme, and most mail
clients do not linkify one, so the link was both interceptable and often not
clickable. Set three variables and both platforms switch to `https://` links on
your own domain, with `forkast://` kept only as what the fallback web page
(`app/web.py`) hands off to.

```bash
# backend/.env
APP_DOMAIN=forkast.app
APPLE_APP_ID_PREFIX=<Apple Team ID, from App Store Connect > Membership>
ANDROID_SHA256_CERT_FINGERPRINT=<from `eas credentials`, or the Play Console's
                                   App signing key certificate>

# mobile/.env.local, or eas env:create for a build. Same domain, no scheme
EXPO_PUBLIC_APP_DOMAIN=forkast.app
```

`APP_DOMAIN` alone is not enough: the backend serves
`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` as
404 until the matching Team ID or fingerprint is set too. A verification file
that names no real app is worse than none. All three empty, the default, is not a
partial setup; it is local development working as it always did.

None of this works unless those two files are served from `APP_DOMAIN` at its
real HTTPS origin, so the backend must be reachable there, behind a reverse proxy
or directly.

Outside local dev (`ENVIRONMENT=production`), startup refuses to boot with a real
email provider configured (`BREVO_API_KEY` set) and `APP_DOMAIN` still empty: a
`forkast://` link mailed to a real inbox does nothing when tapped, so that
combination is caught before it ships rather than at the first support ticket.
