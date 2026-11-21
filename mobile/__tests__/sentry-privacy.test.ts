import type * as Sentry from '@sentry/react-native';

import { scrubSentryEvent } from '../app/_layout';

describe('scrubSentryEvent', () => {
  it('removes token and form values from extras, contexts, and exception frames', () => {
    const event = {
      type: undefined,
      extra: { refresh_token: 'secret-refresh-token' },
      contexts: { form: { email: 'person@example.com', password: 'secret-password' } },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  filename: 'app/login.tsx',
                  vars: { accessToken: 'secret-access-token' },
                },
              ],
            },
          },
        ],
      },
    } as Sentry.ErrorEvent;

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.contexts).toBeUndefined();
    expect(scrubbed.exception?.values?.[0].stacktrace?.frames?.[0].vars).toBeUndefined();
    expect(scrubbed.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe(
      'app/login.tsx',
    );
  });

  it('removes runtime variables from thread frames too', () => {
    const event = {
      type: undefined,
      threads: {
        values: [
          {
            stacktrace: {
              frames: [{ vars: { refreshToken: 'secret-refresh-token' } }],
            },
          },
        ],
      },
    } as Sentry.ErrorEvent;

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.threads?.values[0].stacktrace?.frames?.[0].vars).toBeUndefined();
  });
});
