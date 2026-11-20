import { Platform } from 'react-native';

import { readStoredTokens, removeStoredTokens, writeStoredTokens } from '../lib/tokenStore';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const ACCESS_KEY = 'forkast.access_token';
const REFRESH_KEY = 'forkast.refresh_token';
const PAIR = { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'bearer' };

describe('web token storage', () => {
  const nativePlatform = Platform.OS;
  let session: Record<string, string>;

  beforeEach(async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'web', configurable: true });
    session = {};
    (globalThis as { sessionStorage?: Storage }).sessionStorage = {
      getItem: (key) => session[key] ?? null,
      setItem: (key, value) => {
        session[key] = value;
      },
      removeItem: (key) => {
        delete session[key];
      },
      clear: () => {
        session = {};
      },
      key: () => null,
      length: 0,
    } as Storage;
    await removeStoredTokens();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => nativePlatform, configurable: true });
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  });

  it('stores the access token in sessionStorage and keeps refresh only in memory', async () => {
    await writeStoredTokens(PAIR);

    expect(session[ACCESS_KEY]).toBe(PAIR.access_token);
    expect(session[REFRESH_KEY]).toBeUndefined();
    expect(await readStoredTokens()).toEqual(PAIR);
  });

  it('clears the in-memory refresh token when removing a session', async () => {
    await writeStoredTokens(PAIR);
    await removeStoredTokens();

    expect(await readStoredTokens()).toBeNull();
    expect(session[ACCESS_KEY]).toBeUndefined();
    expect(session[REFRESH_KEY]).toBeUndefined();
  });
});

describe('native token storage', () => {
  it('continues to store both tokens in SecureStore', async () => {
    const secureStore = jest.requireMock('expo-secure-store') as {
      setItemAsync: jest.Mock;
    };
    secureStore.setItemAsync.mockClear();

    await writeStoredTokens(PAIR);

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(ACCESS_KEY, PAIR.access_token);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(REFRESH_KEY, PAIR.refresh_token);
  });
});
