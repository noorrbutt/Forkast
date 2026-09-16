/**
 * What the app tells you when it cannot reach the API.
 *
 * Worth pinning, because this is the first thing anyone sees when the address
 * is stale, the server is down, or a firewall is in the way, and a message that
 * names none of those wastes the time it was supposed to save.
 */

import axios from 'axios';

import { API_ORIGIN, REQUEST_TIMEOUT_MS, describeError } from '../lib/api';

function axiosError(code: string, response?: unknown) {
  const error = new axios.AxiosError('boom', code);
  if (response) error.response = response as never;
  return error;
}

describe('when the server cannot be reached', () => {
  it('names the address rather than only saying it timed out', () => {
    const message = describeError(axiosError('ECONNABORTED'));

    expect(message).toContain(API_ORIGIN);
    expect(message).toContain(String(Math.round(REQUEST_TIMEOUT_MS / 1000)));
  });

  it('treats a low level timeout the same way', () => {
    expect(describeError(axiosError('ETIMEDOUT'))).toContain(API_ORIGIN);
  });

  it('names the address for a refused connection too', () => {
    expect(describeError(axiosError('ECONNREFUSED'))).toContain(API_ORIGIN);
  });
});

describe('when the server did answer', () => {
  it('prefers the detail the API sent', () => {
    const message = describeError(
      axiosError('ERR_BAD_REQUEST', { status: 422, data: { detail: 'Enter a real timezone' } }),
    );

    expect(message).toBe('Enter a real timezone');
  });

  it('reads the first message out of a validation list', () => {
    const message = describeError(
      axiosError('ERR_BAD_REQUEST', {
        status: 422,
        data: { detail: [{ msg: 'calories must be positive' }] },
      }),
    );

    expect(message).toBe('calories must be positive');
  });

  it('falls back to the status when there is no detail', () => {
    expect(describeError(axiosError('ERR_BAD_RESPONSE', { status: 502, data: {} }))).toContain(
      '502',
    );
  });

  it('does not claim the server was unreachable when it clearly answered', () => {
    const message = describeError(axiosError('ERR_BAD_RESPONSE', { status: 500, data: {} }));

    expect(message).not.toContain('Could not reach');
  });
});

describe('anything else', () => {
  it('uses a plain error message', () => {
    expect(describeError(new Error('something specific'))).toBe('something specific');
  });

  it('has a fallback for a non error', () => {
    expect(describeError('a string')).toBe('Something went wrong.');
  });
});
