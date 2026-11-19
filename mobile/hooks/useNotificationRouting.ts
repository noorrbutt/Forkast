import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import type { NotificationResponse } from 'expo-notifications';

import {
  addNotificationResponseListener,
  clearLastNotificationResponse,
  getLastNotificationResponse,
} from '../lib/notifications';

const LOG_SLOTS = new Set(['breakfast', 'lunch', 'dinner']);

function responseKey(response: NotificationResponse): string {
  const { identifier, content } = response.notification.request;
  return `${identifier}:${response.notification.date}:${response.actionIdentifier}:${content.title}`;
}

function logSlot(response: NotificationResponse): string | null {
  const data = response.notification.request.content.data;
  if (!data || typeof data !== 'object' || !('route' in data) || data.route !== '/log') {
    return null;
  }
  const slot = 'slot' in data && typeof data.slot === 'string' && LOG_SLOTS.has(data.slot)
    ? data.slot
    : '';
  return slot;
}

export function useNotificationRouting(): void {
  const router = useRouter();
  const lastHandled = useRef<string | null>(null);

  const handleResponse = useCallback((response: NotificationResponse) => {
    const key = responseKey(response);
    if (lastHandled.current === key) return;
    lastHandled.current = key;

    const slot = logSlot(response);
    if (slot !== null) {
      router.navigate({ pathname: '/log', params: { slot } });
    }
    void clearLastNotificationResponse();
  }, [router]);

  useEffect(() => {
    const subscription = addNotificationResponseListener(handleResponse);
    void getLastNotificationResponse().then((response) => {
      if (response) handleResponse(response);
    });

    return () => subscription?.remove();
  }, [handleResponse]);
}
