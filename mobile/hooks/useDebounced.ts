import { useEffect, useState } from 'react';

/**
 * How long a field waits after the last keystroke before it is worth asking.
 *
 * Long enough to swallow the gaps inside a word, short enough that the list
 * still feels like it is keeping up with the typing. Below about 150ms most of
 * the requests come back anyway; much above 350ms and the suggestions start to
 * feel like they are lagging the keyboard rather than following it.
 */
const SETTLE_MS = 250;

/**
 * The value, once someone has stopped changing it.
 *
 * Typing "Student Biryani" into the restaurant field used to issue fifteen
 * requests, one per keystroke, because the raw text went straight into the
 * query key. Server time was small, but on a phone those are fifteen real round
 * trips that queue behind each other and land out of order, so the suggestions
 * visibly flickered while the user was doing the main thing the app is for.
 *
 * Returns the first value immediately rather than waiting a beat for it, so a
 * field that mounts with something already in it does not start out blank.
 */
export function useDebounced<T>(value: T, delay = SETTLE_MS): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), delay);
    // Cleared on every change, which is what makes this a debounce rather than
    // a throttle: only the last keystroke of a burst survives to fire.
    return () => clearTimeout(timer);
  }, [value, delay, settled]);

  return settled;
}
