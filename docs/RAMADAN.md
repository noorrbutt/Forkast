# Ramadan mode

Status: shipped, opt-in, off by default.

Ramadan mode swaps the day's meal slots for sehri and iftar, shows a live
countdown to the next one on Home, reorders the desi dish chips on the log
form toward whichever of those two is current, and generates an iftar/sehri
style meal plan on request. Every setting it needs lives on the device; none
of it is sent to the API.

## How the times are computed

Fajr and maghrib are computed on the device with
[`adhan`](https://www.npmjs.com/package/adhan) (pinned to `4.4.6`), using
`CalculationMethod.Karachi` -- the method named for, and tuned for, the
region this app ships to first. The calculation needs only two inputs: a
city's coordinates (`mobile/lib/ramadan.ts`'s `CITIES` table, about a dozen
Pakistani cities, Karachi the default) and a calendar date. It is pure
arithmetic over those two things and the sun's position, so it runs fully
offline and produces the same answer every time it is asked for the same
city and day.

`fastingWindow(date, city, offsetMin)` is the one function everything else
is built on: it returns that day's `{ fajr, maghrib }` as real instants.
`phase(now, window)` places the current moment into one of four states
(`before_sehri`, `fasting`, `iftar`, `night`); `countdownText()` turns that
into the line Home shows ("Iftar in 2h 14m", "Sehri ends in 6h 02m").

**Accuracy.** Two of the four fixed dates tested in
`mobile/__tests__/ramadan.test.ts` were checked against a published Karachi
prayer timetable and held to a 2 minute tolerance; the other two are
snapshots the test asserts against the module's own output, there to catch
a regression in the calculation rather than to prove real-world accuracy
for those specific dates. A calculated time is not the same thing as the
time a mosque or a local timetable actually uses -- methods and
rounding conventions differ by a few minutes -- which is why the feature
offers a correction rather than presenting its number as definitive.

**The +/- minute offset.** Profile's "Minute offset" row shifts both sehri
and iftar by the same number of minutes, so someone whose local timetable
consistently runs a few minutes ahead or behind the calculation can match
it exactly rather than living with a small, constant disagreement. The
offset is added to both times equally; it does not change the length of
the fast, only where it sits against the calculation.

**Timezone handling.** `adhan` reads the *local calendar date* off the
`JavaScript` `Date` object it is given -- whatever year/month/day the
runtime's own clock would report for it -- not an instant. A bare
`new Date()` passed at 11pm or just after midnight can therefore compute
the wrong day's times depending on exactly when it is called.
`fastingWindow` sidesteps this by building a noon `Date` from the
already-known year/month/day before handing it to `adhan`: noon is never
adjacent to a day boundary or a DST transition, so the calendar day read
back out is always the one intended. The test suite runs under both
`TZ=UTC` and `TZ=Asia/Karachi` to prove this holds regardless of the
device's own timezone.

## Privacy: device-only, by design

Ramadan mode's three settings -- on/off, city, and the minute offset --
are **stored only on the device**, via `expo-secure-store` (the same
keystore-backed mechanism `lib/tokenStore.ts` uses for auth tokens, with
the same web/in-memory fallback chain). See `mobile/lib/ramadanStore.ts`.

**What is not sent to Forkast's servers:** the mode being on, which city is
selected, the minute offset, and the fact that Ramadan mode exists on a
given account at all. There is no database column, no migration, and no
API field for any of this. The reasoning is the same one behind the rest
of this app's data minimisation: whether someone fasts is not Forkast's
business to know, store, or infer, and the simplest way to guarantee that
is to never let it leave the phone.

**What does reach the server, and why it still respects the same line:**

- When Ramadan mode is on, generating a plan sends `style: "ramadan"`
  instead of `style: "standard"` on `POST /plans` (see
  `mobile/hooks/usePlans.ts`). This asks for a plan shaped around sehri,
  iftar and a late meal instead of breakfast/lunch/dinner. It reveals that
  *a plan was asked for in this particular style*, the same way choosing a
  "cut" or "bulk" goal already does for weight-loss intent elsewhere in the
  app. It does not reveal the computed times, the city, or the offset, and
  an old client that never sends `style` behaves exactly as it always has.
- The `/dishes` request used for the log form's chip suggestions is
  **identical** whether Ramadan mode is on or off -- no new parameter, no
  hint about the current slot. The chips it returns are re-ordered entirely
  on the device (`rankForRamadanSlot()` in `lib/ramadan.ts`) so that iftar-
  or sehri-typical dishes surface first; the server never learns that the
  reordering happened, let alone why.

In short: the fasting calculation, the settings that drive it, and the
reordering it causes in the UI all stay on the device. The one place
Ramadan-ness crosses the wire is a plan request's `style` field, and only
because a plan is, definitionally, a request sent to a server to generate
something.

## The calendar day boundary

Forkast already buckets a user's day by their stored `timezone`, rolling
over at local midnight (see the README's "Days are the user's local days"
design decision). Ramadan mode does not change this. A meal logged at
1am is still "yesterday" for the dashboard, the streak, and the diary, even
though it may have been eaten well after that day's iftar and would read,
to the person who ate it, as part of the same fasting day that started the
evening before.

**The limitation this creates:** the fasting window itself (fajr to
maghrib) and the calendar day a meal is filed under are two different
clocks that disagree for several hours a night. A late-night snack after
midnight but before the next fajr sits in the *next* calendar day on the
dashboard while still being, in Ramadan terms, part of the night that
followed the *previous* day's iftar. This was a deliberate choice rather
than an oversight: changing the day boundary itself would touch
`insights.py` and the streak logic that every other feature in the app
already depends on, for a discrepancy that only matters for a few hours a
night during one month a year. If this becomes a real complaint, the fix
belongs in a redefinition of "day" for Ramadan specifically, not in a
special case bolted onto the existing one.

## Known limits

- **Ramadan's actual start and end are only an estimate.** `RAMADAN_1448`
  in `lib/ramadan.ts` is a fixed Gregorian date range (2027-02-07 to
  2027-03-10) used *only* to decide when to show the "turn this on?"
  suggestion banner. The real start and end of Ramadan are set by moon
  sighting and can shift by a day in either direction depending on
  location and local authority. The app never uses this range to force the
  mode on, compute a fast, or disable the mode automatically -- it is
  advisory, for a banner, and nothing else.
- **The city list is fixed and Pakistan-only.** About a dozen cities,
  Karachi the default, matching `CalculationMethod.Karachi`'s own intended
  region. There is no "detect my location" and no arbitrary city search;
  someone outside that list has to pick the nearest one and lean on the
  minute offset if the gap is large enough to matter.
- **Nothing switches automatically.** The mode does not turn itself on at
  the start of Ramadan or off at the end. It is a toggle in Profile that
  stays exactly where the person last left it, because the whole feature
  is opt-in by design (see the privacy section above) -- an app that
  silently flips a religious-observance setting on someone's behalf would
  undermine the very reason it is device-only in the first place.
- **The fasting window and the calendar day disagree overnight.** See
  "The calendar day boundary" above.

## Testing on a device

Nothing here needs a real Ramadan to be happening. Everything is pure
functions of coordinates and a date, so you can test the full feature on
any day of the year:

1. Turn the mode on in **Profile -> Ramadan**. Pick a city (Karachi is the
   default) and leave the minute offset at 0 to start.
2. Home should show a fasting card with a live countdown. To see it reach
   different states without waiting hours, temporarily change the device's
   clock (iOS: Settings -> General -> Date & Time, turn off "Set
   Automatically"; Android: Settings -> System -> Date & time) to a time
   just before or after today's fajr or maghrib for your chosen city.
   `fastingWindow()` in `lib/ramadan.ts` computes real sun-based times for
   whatever date the device reports, so this works for any date, not just
   today.
3. On the log screen, type a single letter like "d" with the device clock
   set inside the iftar window; dates and dahi bhalla should surface ahead
   of other matches. Set it inside the sehri window and a lighter dish
   (daliya, anda paratha) should surface first instead.
4. Generate a plan from the Plan tab with the mode on; the meals should be
   labelled Sehri, Iftar and Late rather than Breakfast, Lunch and Dinner.
5. Turn the mode off in Profile. Home's countdown card and the suggestion
   banner should disappear, and Today's slots should return to Breakfast,
   Lunch and Dinner exactly as before the mode was ever touched -- this is
   the one behaviour the test suite pins explicitly: with the mode off, the
   app is unchanged.

Revert the device clock change afterward; leaving it altered can cause
unrelated timestamp confusion elsewhere (certificate checks, token
expiry) for as long as it stays wrong.
