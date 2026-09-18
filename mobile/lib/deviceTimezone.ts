/**
 * The zone this device thinks it is in, or null if it will not say.
 *
 * Shared because the two screens that set a timezone, setup and the profile
 * tab, each carried their own byte-identical copy of it, and the fallback
 * behaviour on a device that cannot answer is exactly the kind of thing that
 * ends up handled one way in one copy and another way in the other.
 */
export function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    // Some Android builds ship an ICU without a resolvable zone. Falling back
    // to the server default is fine; the Profile tab can still fix it later.
    return null;
  }
}
