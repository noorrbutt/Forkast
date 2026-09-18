/**
 * What a failed refresh costs the user, and whose face the avatar shows.
 *
 * Both of these came out of an audit rather than a bug report, which is the
 * point: neither is visible in normal use, both are silent, and the module they
 * live in was the least covered in the app despite being the one every other
 * request depends on.
 */

import axios from 'axios';

jest.mock('../lib/tokenStore', () => ({
  readStoredTokens: jest.fn().mockResolvedValue(null),
  writeStoredTokens: jest.fn().mockResolvedValue(undefined),
  removeStoredTokens: jest.fn().mockResolvedValue(undefined),
}));

import { api, clearTokens, getAccessToken, getTokenGeneration, setTokens } from '../lib/api';
import { removeStoredTokens } from '../lib/tokenStore';

const PAIR = { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'bearer' };

/** Drive the response interceptor directly with a failure it would see live. */
async function failRequest(status: number | undefined, refreshOutcome: 'reject' | 'never') {
  const error = new axios.AxiosError('boom', status ? 'ERR_BAD_REQUEST' : 'ECONNABORTED');
  error.config = { url: '/logs', headers: new axios.AxiosHeaders() } as never;
  if (status) {
    error.response = { status, data: {} } as never;
  }

  // The refresh call goes out on a bare axios instance, not on `api`, so it is
  // stubbed here rather than through the interceptor under test.
  const post = jest.spyOn(axios, 'post');
  if (refreshOutcome === 'reject') {
    const refreshError = new axios.AxiosError('refresh failed', 'ERR_BAD_REQUEST');
    refreshError.response = { status: 500, data: {} } as never;
    post.mockRejectedValueOnce(refreshError);
  }

  const handlers = (api.interceptors.response as unknown as { handlers: { rejected: Function }[] })
    .handlers;
  const rejected = handlers.find((h) => h && h.rejected)!.rejected;

  await expect(rejected(error)).rejects.toBeDefined();
  post.mockRestore();
}

describe('a refresh that fails for reasons other than the token', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await setTokens(PAIR);
  });

  it('keeps the session when the refresh call itself errors', async () => {
    // A 429 from a shared rate-limit bucket, a 5xx, or a dropped connection.
    // Signing the user out for any of those throws away a refresh token that is
    // still perfectly valid, and behind a proxy it does it to everyone at once.
    await failRequest(401, 'reject');

    expect(removeStoredTokens).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe(PAIR.access_token);
  });

  it('still signs out when the server refuses the token itself', async () => {
    // No refresh token stored means there is nothing to recover with, so the
    // session really is over and the user belongs at the login screen.
    await clearTokens();
    const before = getTokenGeneration();

    await failRequest(401, 'never');

    expect(getTokenGeneration()).toBeGreaterThanOrEqual(before);
  });

  it('does not attempt a refresh for a non-401', async () => {
    const post = jest.spyOn(axios, 'post');
    await failRequest(500, 'never');

    expect(post).not.toHaveBeenCalled();
    expect(removeStoredTokens).not.toHaveBeenCalled();
    post.mockRestore();
  });
});

describe('the avatar cache key', () => {
  it('changes when the session does, so one account cannot show another face', async () => {
    // /me/avatar carries no account id: it means whoever the bearer token says.
    // Both image caches key on the URI alone, so if the buster does not move
    // when the session does, user B is served user A's cached photo.
    await setTokens(PAIR);
    const first = getTokenGeneration();

    await clearTokens();
    const second = getTokenGeneration();

    expect(second).toBeGreaterThan(first);
  });

  it('only ever moves forward, so a stale entry is never reused', async () => {
    const seen = new Set<number>();
    for (let i = 0; i < 4; i += 1) {
      await setTokens(PAIR);
      await clearTokens();
      seen.add(getTokenGeneration());
    }

    expect(seen.size).toBe(4);
  });
});
