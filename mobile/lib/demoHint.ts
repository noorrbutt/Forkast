/**
 * The demo account a public browser build can offer on its sign in screen.
 *
 * Off unless a build asks for it, because the shipped app has no demo account
 * and a phone that printed credentials under the sign in form would be inviting
 * strangers into whichever account those happened to be.
 *
 * The credentials come from the environment rather than from this file. They
 * belong to whoever seeded the backend the build points at, they change when
 * that database is reset, and a password committed here would outlive both.
 * The switch and the two values are separate on purpose: the switch is the
 * decision to show anything, and a switch left on with nothing to show renders
 * nothing rather than "Email: undefined".
 *
 * Read through `process.env.NAME` written out in full, for the reason
 * lib/googleConfig.ts gives: Expo inlines these by matching the literal text.
 */

export type DemoAccount = { email: string; password: string };

export function demoAccount(): DemoAccount | null {
  if (process.env.EXPO_PUBLIC_DEMO_HINT !== 'true') return null;

  const email = process.env.EXPO_PUBLIC_DEMO_EMAIL ?? '';
  const password = process.env.EXPO_PUBLIC_DEMO_PASSWORD ?? '';
  if (!email || !password) return null;

  return { email, password };
}
