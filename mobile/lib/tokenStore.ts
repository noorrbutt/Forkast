import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { TokenPair } from './types';

const ACCESS_KEY = 'forkast.access_token';
const REFRESH_KEY = 'forkast.refresh_token';

/**
 * Last resort when nothing else will hold a value.
 *
 * Lost on reload, which is correct for a fallback: the app stays usable for the
 * session and a token is never written anywhere it could outlive the tab.
 */
const memory = new Map<string, string>();

/**
 * Where a token lives on web.
 *
 * expo-secure-store ships an empty object as its web implementation, so every
 * call there fails and the memory map above catches it. That works, but it also
 * signs you out on every refresh, which on web is constant.
 *
 * sessionStorage rather than localStorage, deliberately. A token in
 * localStorage outlives the tab and is readable by any script that gets onto
 * the page; sessionStorage is gone the moment the tab closes, which keeps the
 * blast radius the same as the in memory version while surviving the reload
 * that makes web usable at all. It is still not a keystore, and web is a
 * preview surface here rather than the shipped product.
 */
function webStore(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    // Private mode and blocked site data both make this throw on access rather
    // than on use, so it is probed here and never assumed.
    const probe = globalThis.sessionStorage;
    probe.setItem('forkast.probe', '1');
    probe.removeItem('forkast.probe');
    return probe;
  } catch {
    return null;
  }
}

async function readItem(key: string): Promise<string | null> {
  const web = webStore();
  if (web) return web.getItem(key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  const web = webStore();
  if (web) {
    web.setItem(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    memory.set(key, value);
  }
}

async function removeItem(key: string): Promise<void> {
  const web = webStore();
  if (web) {
    web.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Removing something that was never stored is the state the caller asked
    // for, not a failure.
  }
  memory.delete(key);
}

export async function readStoredTokens(): Promise<TokenPair | null> {
  const [access, refresh] = await Promise.all([readItem(ACCESS_KEY), readItem(REFRESH_KEY)]);
  if (!access || !refresh) return null;
  return { access_token: access, refresh_token: refresh, token_type: 'bearer' };
}

export async function writeStoredTokens(pair: TokenPair): Promise<void> {
  await Promise.all([
    writeItem(ACCESS_KEY, pair.access_token),
    writeItem(REFRESH_KEY, pair.refresh_token),
  ]);
}

export async function removeStoredTokens(): Promise<void> {
  await Promise.all([removeItem(ACCESS_KEY), removeItem(REFRESH_KEY)]);
}
