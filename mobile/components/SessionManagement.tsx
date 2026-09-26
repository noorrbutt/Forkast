import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Dialog, FormError, ListGroup, Loading } from './ui';
import { api, describeError } from '../lib/api';
import type { Uuid } from '../lib/types';
import { useTheme } from '../theme';

type Session = {
  session_id: Uuid;
  created_at: string;
  is_current: boolean;
};

function startedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `Started ${value}`;
  return `Started ${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function SessionManagement() {
  const { colors, radius, spacing, type } = useTheme();
  const queryClient = useQueryClient();
  const [confirmOthers, setConfirmOthers] = useState(false);
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: async () => {
      const response = await api.get<Session[]>('/auth/sessions');
      return response.data;
    },
  });
  const revokeSession = useMutation({
    mutationFn: async (sessionId: Uuid) => {
      await api.delete(`/auth/sessions/${sessionId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });
  const revokeOthers = useMutation({
    mutationFn: async () => {
      await api.post('/auth/sessions/revoke-others');
    },
    onSuccess: async () => {
      setConfirmOthers(false);
      await queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });

  const otherSessions = (sessions.data ?? []).filter((item) => !item.is_current);

  return (
    <View style={{ gap: spacing.md }}>
      <ListGroup title="Devices">
        {sessions.isLoading ? (
          <View style={{ padding: spacing.lg }}>
            <Loading label="Loading sessions" />
          </View>
        ) : null}
        {sessions.isError ? (
          <View style={{ gap: spacing.md, padding: spacing.lg }}>
            <Text style={[type.caption, { color: colors.danger }]}>
              {describeError(sessions.error)}
            </Text>
            <Button label="Retry sessions" variant="secondary" onPress={() => void sessions.refetch()} />
          </View>
        ) : null}
        {sessions.data?.map((item, index) => (
          <View
            key={item.session_id}
            style={{
              minHeight: 64,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              borderBottomWidth: index === sessions.data.length - 1 ? 0 : 1,
              borderBottomColor: colors.border,
            }}
          >
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={[type.body, { color: colors.text }]}>
                {item.is_current ? 'This device' : 'Signed-in session'}
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                {startedAt(item.created_at)}
              </Text>
            </View>
            {item.is_current ? (
              <View
                accessible
                accessibilityRole="text"
                accessibilityLabel="Current session"
                style={{
                  borderRadius: radius.pill,
                  backgroundColor: colors.accentSoft,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                }}
              >
                <Text style={[type.caption, { color: colors.accent }]}>Current</Text>
              </View>
            ) : (
              <Button
                label="Sign out session"
                variant="secondary"
                onPress={() => revokeSession.mutate(item.session_id)}
                disabled={revokeSession.isPending || revokeOthers.isPending}
                loading={revokeSession.isPending && revokeSession.variables === item.session_id}
              />
            )}
          </View>
        ))}
        {sessions.isSuccess && sessions.data.length === 0 ? (
          <Text style={[type.caption, { color: colors.muted, padding: spacing.lg }]}>No active sessions.</Text>
        ) : null}
      </ListGroup>

      {revokeSession.isError ? <FormError>{describeError(revokeSession.error)}</FormError> : null}
      {revokeOthers.isError ? <FormError>{describeError(revokeOthers.error)}</FormError> : null}
      <Button
        label="Sign out of all other devices"
        variant="danger"
        full
        disabled={otherSessions.length === 0 || revokeSession.isPending || revokeOthers.isPending}
        onPress={() => setConfirmOthers(true)}
      />

      <Dialog
        visible={confirmOthers}
        onDismiss={() => !revokeOthers.isPending && setConfirmOthers(false)}
        title="Sign out other devices?"
        message="Every other session will be ended. This device stays signed in."
        actions={[
          {
            label: 'Sign out other devices',
            variant: 'danger',
            onPress: () => revokeOthers.mutate(),
            loading: revokeOthers.isPending,
            disabled: revokeOthers.isPending,
          },
          {
            label: 'Cancel',
            variant: 'secondary',
            onPress: () => setConfirmOthers(false),
            disabled: revokeOthers.isPending,
          },
        ]}
      />
    </View>
  );
}
