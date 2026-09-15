import * as SecureStore from 'expo-secure-store';

import type { TokenPair } from './types';

const ACCESS_KEY = 'forkast.access_token';
const REFRESH_KEY = 'forkast.refresh_token';

/**
 * Fallback used when the platform keystore is unavailable, for example on web
 * where expo-secure-store has no implementation. It keeps the app usable for
 * the session without ever writing a token somewhere persistent and insecure.
 */
const memory = new Map<string, string>();

async function readItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    memory.set(key, value);
  }
}

async function removeItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
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
