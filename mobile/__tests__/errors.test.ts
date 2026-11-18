/**
 * What the app tells you when it cannot reach the API.
 *
 * Worth pinning, because this is the first thing anyone sees when the address
 * is stale, the server is down, or a firewall is in the way, and a message that
 * names none of those wastes the time it was supposed to save.
 */

import axios from 'axios';

import { API_ORIGIN, REQUEST_TIMEOUT_MS, describeError } from '../lib/api';

const devDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');

function axiosError(code: string, response?: unknown) {
  const error = new axios.AxiosError('boom', code);
  if (response) error.response = response as never;
  return error;
}

function setDevMode(enabled: boolean): void {
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: enabled });
}

afterEach(() => {
  if (devDescriptor) {
    Object.defineProperty(globalThis, '__DEV__', devDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, '__DEV__');
  }
});

describe('when the server cannot be reached', () => {
  it('shows detailed connection diagnostics in development', () => {
    setDevMode(true);
    const message = describeError(axiosError('ECONNABORTED'));

    expect(message).toContain(API_ORIGIN);
    expect(message).toContain('Check the API is running');
    expect(message).toContain(String(Math.round(REQUEST_TIMEOUT_MS / 1000)));
  });

  it('uses a distinct timeout message in release without exposing the API origin', () => {
    setDevMode(false);

    const message = describeError(axiosError('ETIMEDOUT'));

    expect(message).toBe('Connection timed out. Check your internet and try again.');
    expect(message).not.toContain(API_ORIGIN);
    expect(message).not.toContain('Check the API is running');
  });

  it('uses user-facing copy for other release connection failures', () => {
    setDevMode(false);

    const message = describeError(axiosError('ECONNREFUSED'));

    expect(message).toBe("Can't connect. Check your internet and try again.");
    expect(message).not.toContain(API_ORIGIN);
    expect(message).not.toContain('Check the API is running');
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

    expect(message).toContain('500');
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
