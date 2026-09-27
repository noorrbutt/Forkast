import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Which streak milestones have already had their one-time celebration shown.
 *
 * The server reports a milestone every time current_streak matches one of the
 * milestone lengths, not only the first time -- it has no notion of what the
 * client has already displayed. This is the client's half: a flag per
 * milestone day, checked once so a screen re-render or a pull-to-refresh on
 * day 7 doesn't replay the animation a second time.
 *
 * Same storage seam as tokenStore, minus the web branch: there is nothing
 * sensitive here, so a failed read or write just means the celebration might
 * repeat once, not a security concern.
 */

const memory = new Set<string>();

function key(day: number): string {
  return `forkast.milestone.seen.${day}`;
}

export async function hasSeenMilestone(day: number): Promise<boolean> {
  if (Platform.OS === 'web') return memory.has(key(day));
  try {
    return (await SecureStore.getItemAsync(key(day))) != null;
  } catch {
    return memory.has(key(day));
  }
}

export async function markMilestoneSeen(day: number): Promise<void> {
  if (Platform.OS === 'web') {
    memory.add(key(day));
    return;
  }
  try {
    await SecureStore.setItemAsync(key(day), '1');
  } catch {
    memory.add(key(day));
  }
}
