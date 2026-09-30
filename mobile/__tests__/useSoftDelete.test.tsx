/**
 * The undo window, in isolation from any gesture or row it will eventually
 * back. What matters here is timing and what forces it to resolve early:
 * the five second window itself, Undo actually cancelling it, and every
 * path that has to flush a still-pending delete rather than silently drop
 * it -- unmount, the screen losing focus, and the app backgrounding.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { UNDO_WINDOW_MS, useSoftDelete } from '../hooks/useSoftDelete';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useSoftDelete', () => {
  it('does not commit until the window elapses', () => {
    const commitDelete = jest.fn();
    const { result } = renderHook(() => useSoftDelete<string>(commitDelete));

    act(() => result.current.schedule('log-1'));
    expect(result.current.isPending('log-1')).toBe(true);

    act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS - 1));
    expect(commitDelete).not.toHaveBeenCalled();
  });

  it('commits once the window elapses', () => {
    const commitDelete = jest.fn();
    const { result } = renderHook(() => useSoftDelete<string>(commitDelete));

    act(() => result.current.schedule('log-1'));
    act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS));

    expect(commitDelete).toHaveBeenCalledWith('log-1');
    expect(result.current.isPending('log-1')).toBe(false);
  });

  it('cancel (Undo) stops the commit from ever happening', () => {
    const commitDelete = jest.fn();
    const { result } = renderHook(() => useSoftDelete<string>(commitDelete));

    act(() => result.current.schedule('log-1'));
    act(() => result.current.cancel('log-1'));
    act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS));

    expect(commitDelete).not.toHaveBeenCalled();
    expect(result.current.isPending('log-1')).toBe(false);
  });

  it('re-swiping the same row restarts its window rather than double-committing', () => {
    const commitDelete = jest.fn();
    const { result } = renderHook(() => useSoftDelete<string>(commitDelete));

    act(() => result.current.schedule('log-1'));
    act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS - 1000));
    act(() => result.current.schedule('log-1'));
    // The first timer would have fired here had it not been replaced.
    act(() => jest.advanceTimersByTime(1000));
    expect(commitDelete).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS - 1000));
    expect(commitDelete).toHaveBeenCalledTimes(1);
  });

  it('tracks more than one pending row independently', () => {
    const commitDelete = jest.fn();
    const { result } = renderHook(() => useSoftDelete<string>(commitDelete));

    act(() => {
      result.current.schedule('log-1');
      result.current.schedule('log-2');
    });
    act(() => result.current.cancel('log-1'));
    act(() => jest.advanceTimersByTime(UNDO_WINDOW_MS));

    expect(commitDelete).toHaveBeenCalledTimes(1);
    expect(commitDelete).toHaveBeenCalledWith('log-2');
  });

  it('flush() commits every pending row immediately', () => {
    const commitDelete = jest.fn();
    const { result } = renderHook(() => useSoftDelete<string>(commitDelete));

    act(() => {
      result.current.schedule('log-1');
      result.current.schedule('log-2');
    });
    act(() => result.current.flush());

    expect(commitDelete).toHaveBeenCalledTimes(2);
    expect(commitDelete).toHaveBeenCalledWith('log-1');
    expect(commitDelete).toHaveBeenCalledWith('log-2');
    expect(result.current.pendingCount).toBe(0);
  });

  it('flushes every pending row on unmount rather than losing it', () => {
    const commitDelete = jest.fn();
    const { result, unmount } = renderHook(() => useSoftDelete<string>(commitDelete));

    act(() => result.current.schedule('log-1'));
    unmount();

    expect(commitDelete).toHaveBeenCalledWith('log-1');
  });

  it('flushes every pending row when the app backgrounds', () => {
    // Captured rather than relying on AppState's internal emitter, which
    // the RN test preset does not promise a stable shape for: this is the
    // one seam the hook itself actually depends on.
    let emit: ((state: string) => void) | null = null;
    const subscribe = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        emit = listener as (state: string) => void;
        return { remove: jest.fn() };
      });

    const commitDelete = jest.fn();
    const { result } = renderHook(() => useSoftDelete<string>(commitDelete));
    act(() => result.current.schedule('log-1'));

    act(() => emit?.('background'));

    expect(commitDelete).toHaveBeenCalledWith('log-1');
    subscribe.mockRestore();
  });
});
