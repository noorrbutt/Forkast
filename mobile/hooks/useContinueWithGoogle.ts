import { useCallback, useState } from 'react';

import { describeError } from '../lib/api';
import { useGoogleSignIn } from '../lib/googleAuth';

/**
 * Press the button, go to Google, come back with a token, do something with it.
 *
 * Written once because three screens needed the identical dance and two of them
 * had already grown their own copy of it: sign up, sign in, and the delete
 * confirmation for an account that has no password to confirm with. The three
 * differ only in what they do with the token, which is the argument. It is
 * named `spend` rather than anything beginning with "use", because the lint
 * rule that keeps hooks out of callbacks goes on the name alone and reads a
 * parameter called useToken as a hook being called inside one.
 *
 * What the dance actually is, and why none of it is obvious:
 *
 * Backing out is not a failure. Someone who opens the account chooser and
 * changes their mind has done nothing wrong, and a red line under that is the
 * app arguing with a decision. So a cancellation leaves `problem` untouched and
 * the screen looks exactly as it did.
 *
 * `busy` spans the whole thing, not just the request. The trip out to Google is
 * the slow half and a mutation's own isPending knows nothing about it, so a
 * screen relying on that alone leaves its button live and unpressed for as long
 * as the chooser is open.
 *
 * `finally` matters more than it looks. Without it a refusal from Google leaves
 * the screen busy forever, with the form button disabled behind it and no way
 * back short of navigating away.
 */
export function useContinueWithGoogle(spend: (idToken: string) => Promise<unknown>) {
  const google = useGoogleSignIn();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (busy) return;
    setProblem(null);
    setBusy(true);
    try {
      const result = await google.signIn();
      if (result.type === 'success') await spend(result.idToken);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  }, [busy, google, spend]);

  return {
    /**
     * Whether this build was given a Google client id at all. The screens hide
     * the button when it is false rather than disabling it: a disabled control
     * says the feature exists and implies the user did something to deserve it
     * greyed out, where absence says the honest thing.
     */
    ready: google.ready,
    busy,
    /** Google's refusal, or the server's. Null once anything else is typed. */
    problem,
    clearProblem: useCallback(() => setProblem(null), []),
    start,
  };
}
