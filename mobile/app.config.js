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

const config = {
      "name": "Forkast",
      "slug": "forkast",
      "version": "1.0.0",
      "orientation": "portrait",
      "icon": "./assets/icon.png",
      "userInterfaceStyle": "automatic",
      "ios": {
        "supportsTablet": true,
        "bundleIdentifier": "com.forkast.app"
      },
      "android": {
        "adaptiveIcon": {
          "backgroundColor": "#E6F4FE",
          "foregroundImage": "./assets/android-icon-foreground.png",
          "backgroundImage": "./assets/android-icon-background.png",
          "monochromeImage": "./assets/android-icon-monochrome.png"
        },
        "predictiveBackGestureEnabled": false,
        "package": "com.forkast.app"
      },
      "plugins": [
        "expo-router",
        "expo-status-bar",
        "expo-secure-store",
        // Pulled in by @expo/vector-icons. Listed explicitly so a native build
        // bundles the icon fonts rather than shipping an app full of blanks.
        "expo-font",
        "expo-asset"
      ],
      "scheme": "forkast"
    };

module.exports = () => {
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
