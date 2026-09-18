/**
 * Haptic feedback, wrapped so a screen never has to think about it.
 *
 * Three things this handles that calling expo-haptics directly does not:
 *
 * Android is quieter on purpose. Its haptics are coarser and a tick on every
 * chip tap reads as a rattle rather than as feedback, so selection taps are iOS
 * only while the meaningful ones fire everywhere.
 *
 * Failure is silent. Haptics are unavailable on a simulator, on a device with
 * vibration switched off, and on some Android hardware. None of that is worth
 * an unhandled rejection, and none of it should stop a meal being logged.
 *
 * Nothing is awaited by callers. These are fire and forget by design: making a
 * button wait on the taptic engine before it responds would be exactly backwards.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

function fire(run: () => Promise<void>): void {
  void run().catch(() => {
    // No vibration hardware, or the user has it switched off. Not a problem.
  });
}

/** Picking a chip, a star, a serving size. iOS only, see above. */
export function selection(): void {
  if (Platform.OS !== 'ios') return;
  fire(() => Haptics.selectionAsync());
}

/** A meal saved, a plan generated. The one that should feel like an event. */
export function success(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** A request failed, validation rejected the form. */
export function error(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

/** Changing tab, opening a sheet. A bump rather than a tick. */
export function tap(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export const haptics = { selection, success, error, tap };
