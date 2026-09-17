/**
 * The web side of the map seam.
 *
 * react-native-maps has no web implementation. Its entry point calls
 * codegenNativeComponent, which react-native-web does not provide, so merely
 * importing it throws at module load and takes the entire app down before a
 * single screen renders. That is not a map that fails to draw, it is a blank
 * white page.
 *
 * Metro resolves this file ahead of MapCanvas.tsx for the web platform, so on
 * web the import simply never happens. MAPS_UNAVAILABLE is true here, which
 * makes MapScreen render the area grouped list it already falls back to on
 * Android Expo Go. The web build therefore shows the same honest list rather
 * than a broken canvas.
 */

/** Never rendered on web, because MAPS_UNAVAILABLE short circuits first. */
export const MapView = null;
export const Marker = null;
export const PROVIDER_DEFAULT = undefined;

export const MAPS_UNAVAILABLE = true;
