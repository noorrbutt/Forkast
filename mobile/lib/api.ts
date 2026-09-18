import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

import { readStoredTokens, removeStoredTokens, writeStoredTokens } from './tokenStore';
import type { TokenPair } from './types';

const DEFAULT_BASE_URL = 'http://localhost:8010';

/**
 * EXPO_PUBLIC_ values are inlined into the shipped JS bundle in plaintext,
 * so this prefix is reserved for the API origin and nothing else. No secret
 * may ever be given an EXPO_PUBLIC_ name.
 */
/**
 * How long a request waits before giving up.
 *
 * Generous on purpose: this runs on a phone, sometimes on a slow connection,
 * and a request that would have succeeded in eight seconds should not be
 * abandoned at three. The cost is that an unreachable server takes this long to
 * report itself, which is why the message below names the address rather than
 * saying only that something timed out.
 */
export const REQUEST_TIMEOUT_MS = 15000;

export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
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

/**
 * How many times a session has been torn down on this device.
 *
 * Exported because the authenticated image URLs are the same string for every
 * account -- `/me/avatar` names whoever the bearer token says it is -- and both
 * React Native's image cache and the browser key on the URL alone. Signing out
 * and back in as someone else therefore requests a URI the cache already holds
 * a different person's photo under. Folding this counter into the cache buster
 * is what makes the account change visible to those caches.
 */
export function getTokenGeneration(): number {
  return tokenGeneration;
}

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
    { timeout: REQUEST_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } },
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

/**
 * Whether a failed refresh means the session is genuinely over.
 *
 * Only the server looking at the token and refusing it does. A timeout, a 429
 * or a 5xx says the server could not answer right now, which is not the same
 * thing and must not cost the user their session: behind a proxy with
 * TRUST_PROXY_HEADERS off every caller shares one refresh allowance, so the
 * first busy window would sign out everybody at once, and on a train a dropped
 * connection would do it one user at a time. Both leave a perfectly valid
 * refresh token in the keystore and delete it anyway.
 *
 * performRefresh also throws two plain Errors of its own. "No refresh token
 * stored" is already a dead session and should land on the login screen. The
 * sign out that landed mid-flight has torn the session down itself, so treating
 * it as a rejection here would only repeat work already done.
 */
function refreshWasRejected(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return status === 401 || status === 403 || status === 422;
  }
  return error instanceof Error && error.message === 'No refresh token stored';
}

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
    } catch (refreshError) {
      // Only tear the session down when the refresh token itself was refused.
      // Anything else leaves it in place to be retried on the next request,
      // because the token is still good and the network is not.
      if (refreshWasRejected(refreshError)) {
        await clearTokens();
        authFailureHandler?.();
      }
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
    // A timeout with no response is a "could not reach it" case, so say which
    // address was not reached. On a phone the cause is almost always a stale
    // LAN address, a server that is not running, or a firewall in between, and
    // a bare "the request timed out" points at none of them.
    if (!error.response) {
      const seconds = Math.round(REQUEST_TIMEOUT_MS / 1000);
      const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      return timedOut
        ? `Could not reach ${API_ORIGIN} within ${seconds}s. Check the API is running and that this device can reach that address.`
        : `Could not reach the server at ${API_ORIGIN}.`;
    }
    return `Request failed with status ${error.response.status}.`;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
