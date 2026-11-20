/**
 * The weekly digest is available at any log count, and a first logged day
 * starts the streak. Only an account with no logs needs an unlock hint.
 */
export function unlockHint(logCount: number): string | null {
  if (logCount > 0) return null;
  return 'Log your first meal to start your streak and build your weekly digest.';
}
