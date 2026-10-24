import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/** How often the shared clock ticks while the app is in the foreground. */
const TICK_MS = 30_000;

/**
 * One shared clock, ticking every 30 seconds while the app is foregrounded.
 *
 * Every screen that needs "the current moment" (the Ramadan countdown, which
 * slot is open right now, whether a day has rolled over) used to read it with
 * its own `new Date()` -- computed once per render, so a screen left open
 * across a boundary (midnight, maghrib, the top of an hour) kept showing
 * stale state until something else happened to re-render it. One shared
 * ticker means every consumer rolls over together, at the same moment.
 *
 * Paused in the background: a backgrounded screen's countdown does not need
 * to be live, and ticking it anyway would wake the JS thread every 30 seconds
 * for a number nobody is looking at. The clock catches up the instant the app
 * returns to the foreground, via the AppState listener below, rather than
 * waiting for the next scheduled tick.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const start = () => {
      if (intervalRef.current) return;
      setNow(new Date());
      intervalRef.current = setInterval(() => setNow(new Date()), TICK_MS);
    };
    const stop = () => {
      if (!intervalRef.current) return;
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    };

    start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      stop();
      subscription.remove();
    };
  }, []);

  return now;
}
