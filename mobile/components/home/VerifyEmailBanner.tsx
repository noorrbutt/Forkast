import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { useMe } from '../../hooks/useAuth';
import { useTheme } from '../../theme';

/**
 * The nudge to verify a password account's email, above everything else.
 *
 * Only a password account can be unverified -- a Google row is verified the
 * moment it exists -- and only until the link is clicked, so this is gone for
 * most accounts within minutes. Above the hero on purpose: the account itself
 * outranks today's number.
 */
export function VerifyEmailBanner() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();
  const me = useMe();

  if (me.data?.email_verified !== false) return null;
  const email = me.data.email;

  return (
    <Pressable
      onPress={() => router.navigate({ pathname: '/check-email', params: { email } })}
      style={{
        backgroundColor: colors.dangerSoft,
        borderRadius: 12,
        padding: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <Text style={[type.caption, { color: colors.text }]}>
        Verify your email to keep your account secure. Tap to resend the link.
      </Text>
    </Pressable>
  );
}
