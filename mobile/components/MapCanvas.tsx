import Constants from 'expo-constants';
import { Platform } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

/**
 * The native side of the map seam.
 *
 * react-native-maps is imported here and nowhere else, so the one module that
 * cannot exist on web is the one module Metro can swap out. MapCanvas.web.tsx
 * sits beside this file and exports the same names with the map removed, which
 * is how the web bundle stops reaching for a native component that has no web
 * implementation and taking the whole app down with it.
 */
export { MapView, Marker, PROVIDER_DEFAULT };

/**
 * True only where react-native-maps cannot actually draw anything.
 *
 * Expo removed Google Maps from the Expo Go client on Android in SDK 53, and
 * Google Maps is the only provider react-native-maps has there, so a MapView
 * renders as a blank grey rectangle with an authorization failure in the log. No
 * API key fixes it, because in Expo Go the app runs under Expo's own package
 * name and signature and the config plugin only applies during a native build.
 *
 * The check is deliberately narrow. iOS Expo Go uses Apple Maps and works
 * today, and any development or production build works on both platforms, so
 * only this one combination falls back to the list.
 *
 * appOwnership is the check rather than executionEnvironment because
 * ExecutionEnvironment.StoreClient covers a development client as well as Expo
 * Go, which would disable the map in exactly the build that can render it.
 */
export const MAPS_UNAVAILABLE = Constants.appOwnership === 'expo' && Platform.OS === 'android';
