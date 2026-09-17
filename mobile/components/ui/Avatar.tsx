import { Image, type ImageSourcePropType, Text, View } from 'react-native';

import { useTheme } from '../../theme';

type AvatarProps = {
  /**
   * The picture, already in whatever shape this platform needs, or undefined to
   * fall back to initials.
   *
   * Passed through untouched rather than taken apart and rebuilt here. It used
   * to arrive as a uri and a headers map and get reassembled into a plain
   * object, which is the one shape Android drops the Authorization header from.
   * See lib/authedImage.ts: the wrapping is load bearing and a component in the
   * middle must not undo it.
   */
  source?: ImageSourcePropType;
  /** Used for the initials and for the accessibility label. */
  name: string;
  size?: number;
};

/**
 * Initials until there is a picture.
 *
 * The fallback is initials rather than a generic silhouette because a silhouette
 * says nothing and looks like a failed image. Initials are derived from whatever
 * the account has: a display name if there is one, otherwise the part of the
 * email before the at sign, which is never empty for a registered account.
 */
function initialsOf(name: string): string {
  const cleaned = name.split('@')[0].replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
  if (!cleaned) return '?';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

export function Avatar({ source, name, size = 64 }: AvatarProps) {
  const { colors, radius, type } = useTheme();

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Profile picture for ${name}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        backgroundColor: colors.accentSoft,
        borderWidth: 1.5,
        borderColor: colors.outline,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {source ? (
        <Image
          source={source}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          style={[
            type.title,
            {
              color: colors.accent,
              // Scales with the circle so a small avatar in a row and a large
              // one in the header both read correctly.
              fontSize: Math.round(size * 0.36),
              lineHeight: Math.round(size * 0.44),
            },
          ]}
        >
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}

export { initialsOf };
