import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

import { readStoredTokens, removeStoredTokens, writeStoredTokens } from './tokenStore';
import type { TokenPair } from './types';

const DEFAULT_BASE_URL = 'http://localhost:8010';

/**
 * EXPO_PUBLIC_ values are inlined into the shipped JS bundle in plaintext,
 * so this prefix is reserved for the API origin and nothing else. No secret
 * may ever be given an EXPO_PUBLIC_ name.
 */
export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

/** Requests that must never carry a bearer token or trigger a refresh. */
const PUBLIC_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];

function isPublicPath(url?: string): boolean {
  if (!url) return false;
  return PUBLIC_PATHS.some((path) => url.includes(path));
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let authFailureHandler: (() => void) | null = null;

/**
 * Bumped every time the session is torn down.
 *
 * A refresh that is already in flight when the user signs out would otherwise
 * resolve afterwards and write a valid token pair straight back into the
 * keystore, silently signing them back in. Sign out is not serialised behind
 * the refresh either, because /auth/logout never returns a 401 and so never
 * goes through the retry path.
 */
let tokenGeneration = 0;

/** Registered by AuthProvider so a dead refresh token sends the user to login. */
export function setAuthFailureHandler(handler: (() => void) | null): void {
  authFailureHandler = handler;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export async function hydrateTokens(): Promise<TokenPair | null> {
  const stored = await readStoredTokens();
  accessToken = stored?.access_token ?? null;
  refreshToken = stored?.refresh_token ?? null;
  return stored;
}

export async function setTokens(pair: TokenPair): Promise<void> {
  accessToken = pair.access_token;
  refreshToken = pair.refresh_token;
  await writeStoredTokens(pair);
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export async function clearTokens(): Promise<void> {
  tokenGeneration += 1;
  refreshInFlight = null;
  accessToken = null;
  refreshToken = null;
  await removeStoredTokens();
}

api.interceptors.request.use((config) => {
  if (accessToken && !isPublicPath(config.url)) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

/** Shared across concurrent 401s so only one refresh call ever goes out. */
let refreshInFlight: Promise<TokenPair> | null = null;

async function performRefresh(): Promise<TokenPair> {
  const current = refreshToken;
  const generation = tokenGeneration;
  if (!current) throw new Error('No refresh token stored');

  // A bare axios call, deliberately not `api`, so the refresh itself can never
  // re-enter this interceptor and start a retry loop.
  const response = await axios.post<TokenPair>(
    `${API_BASE_URL}/auth/refresh`,
    { refresh_token: current },
    { timeout: 15000, headers: { 'Content-Type': 'application/json' } },
  );
  if (generation !== tokenGeneration) {
    // Signed out while this was in flight. Throwing rather than storing keeps
    // the sign out final; the pair is simply discarded.
    throw new Error('Session ended while refreshing');
  }

  await setTokens(response.data);
  return response.data;
}

function refreshOnce(): Promise<TokenPair> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh();
    void refreshInFlight.then(
      () => {
        refreshInFlight = null;
      },
      () => {
        refreshInFlight = null;
      },
    );
  }
  return refreshInFlight;
}

type RetriableConfig = InternalAxiosRequestConfig & { _forkastRetried?: boolean };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    const cannotRecover =
      status !== 401 ||
      !original ||
      original._forkastRetried === true ||
      isPublicPath(original.url) ||
      !refreshToken;

    if (cannotRecover) {
      if (status === 401 && !isPublicPath(original?.url)) {
        await clearTokens();
        authFailureHandler?.();
      }
      return Promise.reject(error);
    }

    // The flag lives on the request config, so a retried request that 401s
    // again falls straight through instead of refreshing forever.
    original._forkastRetried = true;

    try {
      const pair = await refreshOnce();
      original.headers.set('Authorization', `Bearer ${pair.access_token}`);
      return await api.request(original);
    } catch {
      await clearTokens();
      authFailureHandler?.();
      return Promise.reject(error);
    }
  },
);

/** Turns an axios failure into a short line fit for an ErrorState. */
export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail.length > 0) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown };
      if (typeof first?.msg === 'string') return first.msg;
    }
    if (error.code === 'ECONNABORTED') return 'The request timed out.';
    if (!error.response) return `Could not reach the server at ${API_ORIGIN}.`;
    return `Request failed with status ${error.response.status}.`;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
