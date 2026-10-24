import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useNow } from '../hooks/useNow';

describe('useNow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('ticks forward every 30 seconds while foregrounded', () => {
    const { result } = renderHook(() => useNow());
    const first = result.current;

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(result.current.getTime()).toBeGreaterThan(first.getTime());
  });

  test('stops ticking in the background and catches up on returning to the foreground', () => {
    // Captured rather than relying on AppState's internal emitter, which the
    // RN test preset does not promise a stable shape for: this is the one
    // seam the hook itself actually depends on. Same pattern as
    // __tests__/useSoftDelete.test.tsx.
    let emit: ((state: string) => void) | null = null;
    const subscribe = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        emit = listener as (state: string) => void;
        return { remove: jest.fn() };
      });

    const { result } = renderHook(() => useNow());
    const beforeBackground = result.current;

    act(() => emit?.('background'));
    act(() => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    // No tick fired while backgrounded, so the value is unchanged.
    expect(result.current.getTime()).toBe(beforeBackground.getTime());

    act(() => emit?.('active'));
    // Returning to the foreground re-reads the clock immediately rather
    // than waiting for the next scheduled tick.
    expect(result.current.getTime()).toBeGreaterThan(beforeBackground.getTime());

    subscribe.mockRestore();
  });
});
