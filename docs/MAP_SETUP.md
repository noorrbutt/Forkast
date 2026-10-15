# Map setup

It draws real pins everywhere except Expo Go on Android, where it falls back to a
list grouped by area.

Expo removed Google Maps from the Expo Go client on Android in SDK 53, and Google
is the only provider `react-native-maps` has there, so a map renders as a blank
grey rectangle. No API key fixes it, because in Expo Go the app runs under Expo's
package name and signature and a config plugin only applies during a native
build.

To get it on Android, build a development client:

```bash
npx expo login
eas env:create --environment development --name GOOGLE_MAPS_API_KEY --value "AIza..." --visibility secret
eas build --profile development --platform android
```

The variable is registered with EAS rather than exported in your shell, because
the build runs on EAS servers and never sees your local environment. `VAR=... eas
build` is the shape that looks obviously right and silently produces a build with
no key in it, and on PowerShell it is not even valid syntax. (`eas build --local`
does read your shell.)

The key ships inside the APK either way, so restrict it by package name and SHA-1
in the Google Cloud console rather than treating secrecy as the control.
