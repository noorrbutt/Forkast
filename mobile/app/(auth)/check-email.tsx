import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { Button, FormError, Loading, Screen } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { api, describeError } from '../../lib/api';
import { useTheme } from '../../theme';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function CheckEmailScreen() {
  const { colors, layout, spacing, type } = useTheme();
  const { needsSetup } = useAuth();
  const router = useRouter();
  const { email: rawEmail, token: rawToken } = useLocalSearchParams<{
    email?: string | string[];
    token?: string | string[];
  }>();
  const email = first(rawEmail);
  const token = first(rawToken);
  const handledToken = useRef<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  const verification = useMutation({
    mutationFn: async (verificationToken: string) => {
      await api.post('/auth/verify-email', { token: verificationToken });
    },
  });
  const verify = verification.mutate;
  const resend = useMutation({
    mutationFn: async (address: string) => {
      await api.post('/auth/resend-verification', { email: address });
    },
    onSuccess: () =>
      setResendNotice('If that address needs verification, a link is on its way.'),
  });

  useEffect(() => {
    if (!token || handledToken.current === token) return;
    handledToken.current = token;
    verify(token);
  }, [token, verify]);

  const verificationError = verification.isError ? describeError(verification.error) : null;
  const resendError = resend.isError ? describeError(resend.error) : null;
  const continueToApp = () => router.replace(needsSetup ? '/setup' : '/');

  return (
    <Screen>
      <View
        style={{
          width: '100%',
          maxWidth: layout.formWidth,
          alignSelf: 'center',
          gap: spacing.xl,
          paddingTop: spacing.xxl,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.display, { color: colors.text }]}>
            {token ? 'Verify your email.' : 'Check your email.'}
          </Text>
          <Text style={[type.body, { color: colors.muted }]}>
            {token
              ? verification.isSuccess
                ? 'Your email address is verified.'
                : verification.isError
                  ? 'This verification link could not be used.'
                  : 'Verifying your email address.'
              : email
                ? `We sent a verification link to ${email}.`
                : 'Open the verification link we sent to your email address.'}
          </Text>
        </View>

        {token && verification.isPending ? <Loading label="Verifying email" /> : null}
        {verificationError ? <FormError>{verificationError}</FormError> : null}
        {resendNotice ? (
          <Text style={[type.caption, { color: colors.muted }]}>{resendNotice}</Text>
        ) : null}
        {resendError ? <FormError>{resendError}</FormError> : null}

        {email && (!token || verification.isError) ? (
          <Button
            label="Resend verification email"
            variant="secondary"
            onPress={() => resend.mutate(email)}
            loading={resend.isPending}
          />
        ) : null}
        <Button label="Continue to Forkast" size="lg" onPress={continueToApp} />
      </View>
    </Screen>
  );
}