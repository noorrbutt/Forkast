import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { TokenPair } from './types';

const ACCESS_KEY = 'forkast.access_token';
const REFRESH_KEY = 'forkast.refresh_token';

export type StoredTokens = {
  access_token: string;
  refresh_token: string | null;
  token_type: string;
};

/**
 * Last resort when nothing else will hold a value.
 *
 * Lost on reload, which is correct for a fallback: the app stays usable for the
 * session and a token is never written anywhere it could outlive the tab.
 */
const memory = new Map<string, string>();

/**
 * Where the web access token lives.
 *
 * expo-secure-store ships an empty object as its web implementation, so every
 * call there fails and the memory map above catches it. That keeps the session
 * alive for the tab, but not across a reload.
 *
 * The refresh token stays in memory only. The access token uses sessionStorage
 * rather than localStorage: it survives a reload but not the tab closing.
 * sessionStorage is still readable by scripts on the page, so it is not a
 * keystore, and web is a preview surface here rather than the shipped product.
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
  } else {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Removing something that was never stored is the state the caller asked
      // for, not a failure.
    }
  }
  memory.delete(key);
}

export async function readStoredTokens(): Promise<StoredTokens | null> {
  const web = webStore();
  if (Platform.OS === 'web' && web) {
    const access = web.getItem(ACCESS_KEY);
    web.removeItem(REFRESH_KEY);
    if (!access) return null;
    const refresh = memory.get(REFRESH_KEY) ?? null;
    return { access_token: access, refresh_token: refresh, token_type: 'bearer' };
  }

  const [access, refresh] = await Promise.all([readItem(ACCESS_KEY), readItem(REFRESH_KEY)]);
  if (!access || !refresh) return null;
  return { access_token: access, refresh_token: refresh, token_type: 'bearer' };
}

export async function writeStoredTokens(pair: TokenPair): Promise<void> {
  const web = webStore();
  if (Platform.OS === 'web') {
    memory.set(REFRESH_KEY, pair.refresh_token);
    if (web) {
      web.setItem(ACCESS_KEY, pair.access_token);
      web.removeItem(REFRESH_KEY);
      return;
    }
    memory.set(ACCESS_KEY, pair.access_token);
    return;
  }

  await Promise.all([
    writeItem(ACCESS_KEY, pair.access_token),
    writeItem(REFRESH_KEY, pair.refresh_token),
  ]);
}

export async function removeStoredTokens(): Promise<void> {
  await Promise.all([removeItem(ACCESS_KEY), removeItem(REFRESH_KEY)]);
}
