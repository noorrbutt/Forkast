import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { useDeleteAccount } from '../hooks/useAuth';
import { describeError } from '../lib/api';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme';
import { Button, Card, Field, Icon, SectionLabel } from './ui';

/**
 * Closing the account for good.
 *
 * Deliberately the quietest thing on the screen until it is opened. It sits
 * behind a disclosure, asks for the password, and then confirms once more,
 * because there is no undo and nothing here can be restored afterwards.
 *
 * It is not hidden, though. An app that stores what someone eats every day owes
 * them a way out that does not involve writing an email, and Play requires one
 * in the app for anything with a signup.
 */
export function DeleteAccount() {
  const { colors, spacing, type } = useTheme();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const remove = useDeleteAccount();

  const confirm = () => {
    if (!password || remove.isPending) return;
    Alert.alert(
      'Delete your account?',
      'Every meal, streak and plan goes with it. This cannot be undone.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Delete for good',
          style: 'destructive',
          onPress: () => {
            remove.mutate(password, {
              // No success handler: deleting signs the user out, which unmounts
              // this screen. Anything set here would be set on a dead component.
              onError: () => haptics.error(),
            });
          },
        },
      ],
    );
  };

  if (!open) {
    return (
      <Button
        label="Delete my account"
        variant="ghost"
        align="center"
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <Card>
      <View style={{ gap: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="trash" size={18} color={colors.danger} />
          <SectionLabel>Delete account</SectionLabel>
        </View>

        <Text style={[type.caption, { color: colors.muted }]}>
          This removes your meals, streaks, burned calories and plans, and signs out every device.
          Restaurants you added stay, since other people log against them.
        </Text>

        <Field
          label="Confirm your password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          textContentType="password"
          editable={!remove.isPending}
        />

        {remove.isError ? (
          <Text style={[type.caption, { color: colors.danger }]}>
            {describeError(remove.error)}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
          <Button
            label="Delete for good"
            variant="danger"
            onPress={confirm}
            disabled={!password || remove.isPending}
            loading={remove.isPending}
          />
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setOpen(false);
              setPassword('');
            }}
            disabled={remove.isPending}
          />
        </View>
      </View>
    </Card>
  );
}
