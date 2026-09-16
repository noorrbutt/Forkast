import Ionicons from '@expo/vector-icons/Ionicons';

import { useTheme } from '../../theme';

/**
 * The app's icon vocabulary, named for what it means rather than what it draws.
 *
 * Going through a fixed map rather than passing Ionicons names straight through
 * is what stops the same idea appearing as three different glyphs on three
 * screens. If a meaning is missing, add it here once.
 */
const GLYPHS = {
  dashboard: 'home',
  log: 'add',
  streaks: 'flame',
  profile: 'person',
  plan: 'sparkles',
  map: 'map',
  history: 'time',
  burn: 'bicycle',
  meal: 'restaurant',
  chart: 'stats-chart',
  back: 'chevron-back',
  forward: 'chevron-forward',
  check: 'checkmark',
  close: 'close',
  search: 'search',
  star: 'star',
  warning: 'warning',
  offline: 'cloud-offline',
  empty: 'file-tray',
  signOut: 'log-out',
  bell: 'notifications',
  clock: 'alarm',
  edit: 'create',
  trash: 'trash',
} as const;

export type IconName = keyof typeof GLYPHS;

type IconProps = {
  name: IconName;
  size?: number;
  /** Defaults to the muted ink, which is what most icons here want. */
  color?: string;
};

export function Icon({ name, size = 20, color }: IconProps) {
  const { colors } = useTheme();
  return (
    <Ionicons
      name={GLYPHS[name]}
      size={size}
      color={color ?? colors.muted}
      // The icon is always paired with a label in this app, so announcing it
      // again would make a screen reader say everything twice.
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
