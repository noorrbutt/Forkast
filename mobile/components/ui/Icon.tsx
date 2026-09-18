import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { useTheme } from '../../theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Both cuts of one meaning, for the places where selection is drawn as weight
 * rather than as colour alone. Ionicons ships an "-outline" twin for most of
 * its glyphs, which is what makes this possible without new artwork.
 */
type GlyphPair = { outline: IoniconName; filled: IoniconName };

/**
 * The app's icon vocabulary, named for what it means rather than what it draws.
 *
 * Going through a fixed map rather than passing Ionicons names straight through
 * is what stops the same idea appearing as three different glyphs on three
 * screens. If a meaning is missing, add it here once.
 *
 * Only meanings something actually draws. Thirteen of the thirty here had no
 * caller anywhere: some were for features that were cut, some were speculative.
 * A vocabulary is only useful while every word in it is in use, because the
 * moment it carries spares it stops telling you what the app can say.
 *
 * A meaning is either one glyph or a pair. Only the tab destinations carry a
 * pair so far, because the tab bar is the only place that shows the same icon
 * selected and unselected side by side.
 */
const GLYPHS = {
  dashboard: { outline: 'home-outline', filled: 'home' },
  log: 'add',
  streaks: { outline: 'flame-outline', filled: 'flame' },
  profile: { outline: 'person-outline', filled: 'person' },
  plan: { outline: 'sparkles-outline', filled: 'sparkles' },
  map: 'map',
  history: { outline: 'time-outline', filled: 'time' },
  meal: 'restaurant',
  chart: 'stats-chart',
  forward: 'chevron-forward',
  check: 'checkmark',
  close: 'close',
  search: 'search',
  empty: 'file-tray',
  edit: 'create',
  trash: 'trash',
  // The two halves of the reveal control on a password field. A pair would be
  // wrong here: outline and filled are two cuts of ONE meaning, and these are
  // two opposite meanings that happen to share a drawing. The eye means the
  // characters are hidden and pressing shows them; the struck eye means they
  // are showing and pressing hides them.
  reveal: 'eye-outline',
  conceal: 'eye-off-outline',
} as const satisfies Record<string, IoniconName | GlyphPair>;

export type IconName = keyof typeof GLYPHS;
export type IconVariant = 'outline' | 'filled';

function glyphFor(name: IconName, variant: IconVariant): IoniconName {
  const glyph = GLYPHS[name];
  // A meaning with only one glyph draws that glyph whatever is asked for, so a
  // caller can pass a variant without first checking whether there is a pair.
  return typeof glyph === 'string' ? glyph : glyph[variant];
}

type IconProps = {
  name: IconName;
  size?: number;
  /** Defaults to the muted ink, which is what most icons here want. */
  color?: string;
  /**
   * Which cut to draw, for the meanings that carry both.
   *
   * Solid by default because every icon in this app was solid before the
   * outline twins existed, so adding a pair never changes an existing caller.
   */
  variant?: IconVariant;
};

export function Icon({ name, size = 20, color, variant = 'filled' }: IconProps) {
  const { colors } = useTheme();
  return (
    <Ionicons
      name={glyphFor(name, variant)}
      size={size}
      color={color ?? colors.muted}
      // The icon is always paired with a label in this app, so announcing it
      // again would make a screen reader say everything twice.
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
