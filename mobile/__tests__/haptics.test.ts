/**
 * The haptics wrapper.
 *
 * Worth testing rather than trusting, because every failure mode here is
 * silent. The wrapper swallows rejections on purpose, so a broken call would
 * not surface as an error anywhere: it would simply mean the app stopped
 * feeling like anything.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { haptics } from '../lib/haptics';

const mocked = Haptics as jest.Mocked<typeof Haptics>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('on iOS', () => {
  it('ticks when a chip is selected', () => {
    haptics.selection();
    expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('uses the success notification when a meal is saved', () => {
    haptics.success();
    expect(mocked.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  it('uses warning rather than error for a broken streak', () => {
    haptics.warning();
    expect(mocked.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Warning,
    );
  });

  it('uses error when a request fails', () => {
    haptics.error();
    expect(mocked.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
  });

  it('uses a light impact for a tab change, not a selection tick', () => {
    haptics.tap();
    expect(mocked.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(mocked.selectionAsync).not.toHaveBeenCalled();
  });
});

describe('when the device cannot vibrate', () => {
  it('stays silent rather than rejecting', async () => {
    mocked.selectionAsync.mockRejectedValueOnce(new Error('no taptic engine'));

    expect(() => haptics.selection()).not.toThrow();
    // Let the swallowed rejection settle; an unhandled one would fail the run.
    await new Promise<void>((resolve) => {
      setImmediate(() => resolve());
    });
  });

  it('does not block the caller, since nothing awaits it', () => {
    mocked.notificationAsync.mockImplementationOnce(
      () => new Promise(() => undefined) as Promise<void>,
    );

    const before = Date.now();
    haptics.success();
    expect(Date.now() - before).toBeLessThan(50);
  });
});

describe('on Android', () => {
  // Platform.OS is read at call time, so overriding the property is enough and
  // avoids resetting modules. Mocking the deep Platform path does not work here:
  // the module imports Platform from the react-native barrel, which resolves
  // separately.
  const original = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => original, configurable: true });
  });

  it('skips the selection tick, which reads as a rattle there', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });

    haptics.selection();

    expect(mocked.selectionAsync).not.toHaveBeenCalled();
  });

  it('still fires the meaningful ones', () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });

    haptics.success();
    haptics.tap();

    expect(mocked.notificationAsync).toHaveBeenCalled();
    expect(mocked.impactAsync).toHaveBeenCalled();
  });
});
