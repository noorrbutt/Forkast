import { act, render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { NotificationResponse } from 'expo-notifications';
import type { ReactNode } from 'react';

import { useNotificationRouting } from '../hooks/useNotificationRouting';

const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

function RouterHarness(): ReactNode {
  useNotificationRouting();
  return null;
}

function response(data: Record<string, unknown>, id = 'notification-1'): NotificationResponse {
  return {
    actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: {
      date: 1_800_000_000_000,
      request: {
        identifier: id,
        content: { title: 'Meal reminder', data },
        trigger: null,
      },
    },
  } as NotificationResponse;
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getLastNotificationResponseAsync.mockResolvedValue(null);
  mocked.addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });
});

describe('notification routing', () => {
  it('routes a foreground tap received by the response listener', async () => {
    render(<RouterHarness />);
    await waitFor(() => expect(mocked.addNotificationResponseReceivedListener).toHaveBeenCalled());

    const listener = mocked.addNotificationResponseReceivedListener.mock.calls[0][0];
    act(() => listener(response({ route: '/log', slot: 'lunch' })));

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/log',
      params: { slot: 'lunch' },
    });
  });

  it('routes a tap delivered by the listener when the app returns from background', async () => {
    render(<RouterHarness />);
    await waitFor(() => expect(mocked.addNotificationResponseReceivedListener).toHaveBeenCalled());

    const listener = mocked.addNotificationResponseReceivedListener.mock.calls[0][0];
    act(() => listener(response({ route: '/log', slot: 'breakfast' })));

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/log',
      params: { slot: 'breakfast' },
    });
  });

  it('routes a cold-start tap from the last response and does not route it twice', async () => {
    const tappedResponse = response({ route: '/log', slot: 'dinner' });
    mocked.getLastNotificationResponseAsync.mockResolvedValue(tappedResponse);

    render(<RouterHarness />);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        pathname: '/log',
        params: { slot: 'dinner' },
      }),
    );

    const listener = mocked.addNotificationResponseReceivedListener.mock.calls[0][0];
    act(() => listener(tappedResponse));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mocked.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });

  it('routes the Log it action through the same reminder route', async () => {
    render(<RouterHarness />);
    await waitFor(() => expect(mocked.addNotificationResponseReceivedListener).toHaveBeenCalled());

    const listener = mocked.addNotificationResponseReceivedListener.mock.calls[0][0];
    act(() => {
      listener({
        ...response({ route: '/log', slot: 'dinner' }),
        actionIdentifier: 'log_it',
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/log',
      params: { slot: 'dinner' },
    });
  });

  it('ignores unknown routes', async () => {
    render(<RouterHarness />);
    await waitFor(() => expect(mocked.addNotificationResponseReceivedListener).toHaveBeenCalled());

    const listener = mocked.addNotificationResponseReceivedListener.mock.calls[0][0];
    act(() => listener(response({ route: '/profile' })));

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
