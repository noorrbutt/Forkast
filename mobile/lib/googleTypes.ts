/**
 * The shape both halves of the Google sign in split agree on.
 *
 * Its own file rather than living in googleAuth.ts, because Metro resolves that
 * name to one of two platform files and a type imported from it would resolve
 * differently per platform. A type has to have exactly one definition, or the
 * two implementations can drift apart without the compiler noticing.
 */

export type GoogleSignInResult =
  /** Google returned a token. The server decides what it means. */
  | { type: 'success'; idToken: string }
  /**
   * The user backed out.
   *
   * Its own case rather than an error, because it is not one: someone who opens
   * the account chooser and changes their mind has done nothing wrong, and
   * showing them a red message saying so is the app arguing with a decision.
   */
  | { type: 'cancelled' };

export type GoogleSignIn = {
  /**
   * Whether the button can be drawn at all.
   *
   * False when no client id was built into this bundle, which is the honest
   * state of a checkout that has not been given Google credentials. The screens
   * hide the button rather than offering one that opens a Google page and fails
   * there, which is the worst of both: it looks supported and is not.
   */
  ready: boolean;
  signIn: () => Promise<GoogleSignInResult>;
};
