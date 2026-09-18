import Svg, { Path } from 'react-native-svg';

import { googleMark } from '../../theme';

/**
 * Google's G, in Google's four colours.
 *
 * The one mark in this app that is not allowed to take a theme colour, and the
 * only reason it is drawn as geometry rather than reached for from Ionicons:
 * `logo-google` exists there and renders a single flat glyph, which is not the
 * mark Google's brand guidelines permit on a sign in button. They are explicit
 * that the G keeps its own colours on a light or a white surface, so this is a
 * case where "read the colour from tokens" is the wrong instinct.
 *
 * It is small, it sits beside a label that names it, and it is the only place
 * in Forkast where a foreign brand appears at all. That is deliberate: a user
 * scanning for the Google button is looking for this exact shape, and a
 * redrawn or recoloured version of it reads as a phishing page.
 *
 * The four paths are the quarters of the mark in the order Google draws them:
 * blue right arm, green lower left, amber left, red upper right. The values
 * live in theme/tokens.ts with the rest of the app's colour, which is where
 * the note on why they are not themed also lives.
 */

/** The mark's own square. Every path below is expressed inside it. */
const BOX = 48;

type GoogleMarkProps = {
  /** Width and height in points. The mark is square. */
  size?: number;
};

export function GoogleMark({ size = 18 }: GoogleMarkProps) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Path
        fill={googleMark.blue}
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill={googleMark.green}
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill={googleMark.amber}
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill={googleMark.red}
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}
