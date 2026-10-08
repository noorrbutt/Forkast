# Privacy Policy

**DRAFT. Not yet reviewed by a lawyer. Do not publish until it has been.**
Every `[[FILL: ...]]` below is a fact only you can supply. Publishing with any
of them still in place would itself be a misrepresentation.

**Last updated:** 2026-10-08
**Applies to:** the Forkast mobile app and its API.

---

## Who is responsible for your data

Noor Butt, operating as an individual (sole trader), is the data controller
for the information described here.

- **Address:** [[FILL: postal address -- required by GDPR Art. 13 and by both
  app stores. A PO box is acceptable in most jurisdictions; an email address
  alone is not. Not supplied yet.]]
- **Contact for privacy questions and requests:** noorbbutt@gmail.com
- **Data protection officer:** Not appointed, and not required under GDPR
  Art. 37 for an app at this scale.
- **EU/UK representative:** None appointed. Forkast does not target or
  market to people in the EU/UK specifically; if that changes, GDPR Art. 27
  requires appointing one unless an exemption applies.

## The short version

Forkast is a food diary. It stores what you tell it you ate, and it works out
figures from that. It does not contain advertising, analytics, or any tracking
software. Nothing about you is sold, and nothing is shared with advertisers or
data brokers.

Two outside companies do see some of it, and both are named below: Google, if
you choose to sign in with a Google account, and Groq, which generates the meal
plans if you ask for one.

## What Forkast collects, and why

Everything here is either typed in by you or worked out from what you typed in.
Forkast asks your device for nothing except permission to send you a reminder,
and only if you turn reminders on.

### Your account

| What | Why | Can you avoid it? |
|---|---|---|
| Email address | It identifies the account and is how you sign in | No. It is the account. |
| Password | Signing in. Stored only as an Argon2 hash, never as text | Yes, if you sign in with Google instead |
| Google account identifier | Recognising you when you sign in with Google | Yes, if you use a password instead |
| First and last name | Addressing you by name in the app | Yes. Both are optional and can be left empty |
| Time zone | Deciding which calendar day a meal belongs to | No. Without it your days and streaks are wrong |
| Date the account was created | Account administration | No |

### What you log

| What | Why |
|---|---|
| Dish name, food category and cuisine | The diary entry itself, and the calorie estimate |
| Restaurant name and area | Grouping your meals by place, and the map |
| Serving size | Scaling the calorie estimate |
| Your rating, "fun" score, and whether you ate alone or with others | Features of the diary you chose to fill in. All optional |
| Estimated calories | The figure the app is for |
| The time you logged it | Ordering the diary and bucketing it into days |
| Photographs of meals | Shown in your own diary. Optional |
| A profile picture | Shown on your profile. Optional |

### Health and fitness information

**Read this section carefully.** Some of what Forkast stores is information
about your body and your eating, which several laws treat more strictly than
ordinary personal data:

- the calories you are estimated to have eaten
- the calories you record having burned
- your daily calorie target
- your stated goal: losing weight, holding steady, or gaining weight

Under the UK and EU GDPR this may be **"data concerning health" (Article 9)**,
which cannot be processed at all without a specific legal basis. Forkast relies
on your **explicit consent**, which is why the sign-up screen asks for it in a
box that starts empty, and why you can withdraw it at any time by deleting your
account.

Forkast treats this data as Article 9 health data out of caution, even though
there is a genuine argument either way for a consumer calorie diary (as
opposed to, say, a clinical nutrition app). This is a deliberately
conservative default, not a settled legal conclusion -- confirm it with a
lawyer before relying on it, since the answer changes what you are actually
required to do.

### Technical information

| What | Why | Kept for |
|---|---|---|
| Your IP address, or a hash of it | Rate limiting, so a stranger cannot try a million passwords against your account | At most 24 hours |
| Session tokens | Keeping you signed in. Stored only as a SHA-256 hash | Until you sign out, or 30 days |

Forkast does **not** collect: your device's location, an advertising
identifier, your contacts, your photo library beyond the single picture you
choose, your health app data, crash reports, or usage analytics of any kind.

## What Forkast does not do

- **No advertising.** There is no ad network in the app.
- **No analytics.** No Firebase, no Google Analytics, no Sentry, no Mixpanel,
  no Amplitude, no Segment, and no equivalent. This is verifiable: the app's
  dependency list is public in the repository.
- **No tracking across other apps or websites**, and therefore no App Tracking
  Transparency prompt on iOS, because there is nothing to ask you about.
- **No selling or sharing of personal information** in the sense California's
  CCPA/CPRA uses those words. Forkast has never done this and has no mechanism
  to.
- **No profiling or automated decisions** that produce legal or similarly
  significant effects about you.

## Who else sees your data

### Google, if you choose to sign in with Google

If you tap "Continue with Google", Google tells Forkast your Google account
identifier, your email address, and your first and last name if your Google
profile has them. Google also learns that you use Forkast. This only happens if
you choose that button; signing in with an email and password does not involve
Google at all.

Google's own privacy policy governs what Google does with it:
https://policies.google.com/privacy

### Google Maps, on Android

The map screen draws using Google's mapping software, which collects device and
usage information under Google's own terms. On iOS the map uses Apple Maps. In
the Expo Go development client on Android the map is replaced by a plain list
and no mapping software runs at all.

### Groq, when you ask for a meal plan

Meal plans are generated by a large language model run by **Groq, Inc.** (United
States). When, and only when, you tap to generate a plan, Forkast sends Groq:

- the dish name, food category and cuisine of up to 30 of your recent meals
- whether each was flagged as junk, its estimated calories, and when you logged
  it
- your goal, your time zone, and summary figures such as your average daily
  calories and your current streak

This includes the health information described above. It does **not** include
your name, your email address, your photographs, or your account identifier.

Forkast does not currently operate in, or knowingly offer sign-ups to, the
EU or UK. Until a data processing agreement with Groq and an appropriate
international-transfer mechanism (Standard Contractual Clauses, or the
EU-US Data Privacy Framework if Groq is certified under it) are confirmed in
place, the meal-plan feature must not be offered to users there. Confirm
Groq's current terms and this arrangement with a lawyer before changing that.

You can use every other part of Forkast without ever generating a plan.

### Neon, our database host

Forkast's database is hosted by Neon, Inc. in Ohio, United States. Neon is a
data processor acting on Forkast's instructions and does not use your data
for its own purposes.

### Nobody else

Forkast has no other third-party recipients. Your data is not shared with
advertisers, data brokers, insurers, employers, or social networks.

## What Forkast is allowed to do with it, legally

For people in the UK and EU, under GDPR Article 6:

| Purpose | Legal basis |
|---|---|
| Running your account and showing you your diary | Performance of a contract (Art. 6(1)(b)) |
| Storing and analysing your calorie, goal and burn data | Your explicit consent (Art. 6(1)(a) and Art. 9(2)(a)) |
| Sending your meals to Groq for a plan | Your consent, given by asking for a plan |
| Rate limiting and keeping accounts secure | Legitimate interests (Art. 6(1)(f)): keeping the service usable and your account unbroken |
| Reminders | Your consent, given by turning them on |

## How long it is kept

Your account and everything in it are kept until you delete the account. There
is no inactivity expiry. Deletion is immediate and is described below.

Rate-limiting records are removed by a scheduled maintenance job. Sign-in
sessions are also removed by a scheduled maintenance job, and sooner if you sign
out.

## Deleting your account

You can delete your account and everything in it from inside the app: **Profile
→ Delete my account**. It asks for your password, or for a fresh Google sign-in
if your account has no password, because the action cannot be undone.

Deleting removes your account, every meal you logged, every photograph, your
burned-calorie entries, your generated plans, and all your sign-in sessions,
immediately and permanently from the live database. There is no
Forkast-side recovery period and no Forkast-side backup you can be restored
from. Neon, our database host, keeps a short rolling window of
point-in-time infrastructure backups as a standard part of its service;
these are not used to restore a deleted account and age out automatically
on Neon's own schedule, not ours.

Restaurants you were the first to add remain in the shared list of places, with
their link to you removed. They carry nothing about you.

You can also delete an account without installing the app: sign in to the
web version of Forkast and use Profile → Delete my account from a browser.
See docs/legal/STORE_DISCLOSURES.md for the current URL.

## Your rights

Depending on where you live you have some or all of these. Forkast will honour
all of them for everyone, regardless of where you are, because it is simpler
than checking.

- **See your data.** You can request a JSON export from the app at
  **Profile → Export my data**, which returns the account record, food logs, burn
  logs, and generated plans in a machine-readable format. The export omits
  password hashes and photo bytes but includes whether each log has a photo.
- **Correct it.** Your name, goal, target and time zone are editable in the app.
  Individual meals can be edited or deleted.
- **Delete it.** In the app, as above.
- **Withdraw consent.** Turn reminders off, stop asking for plans, or delete the
  account. Withdrawing does not undo what was already done lawfully.
- **Object, or ask us to restrict processing.** Write to the address above.
- **Complain.** To the data protection authority in your own country -- for
  the UK this is the Information Commissioner's Office, ico.org.uk; for an
  EU country, that country's own DPA.

Californian residents additionally have the rights to know, delete, correct, and
to opt out of sale or sharing. Forkast does not sell or share personal
information, so there is nothing to opt out of, and there is no "Do Not Sell or
Share My Personal Information" link for that reason. You will never be treated
differently for exercising a right.

## Children

Forkast is not intended for children, and calorie tracking is not something to
put in front of one. You must be 13 or older to use it. (13 is the US COPPA
floor; several EU states set their own age of digital consent higher, up to
16 -- if Forkast is offered there, confirm the applicable age per country.)

Forkast does not knowingly collect anything from a child under that age. If you
believe a child has created an account, write to the address above and it will
be deleted.

## Security

Passwords are hashed with Argon2 and never stored or logged in readable form.
Sign-in sessions are stored only as hashes, are rotated every time they are
used, and reusing a spent one revokes every session on the account. Uploaded
images are checked by their actual file signature rather than by what the
uploader claims they are. All traffic to the API is over HTTPS in production.

No system is perfectly secure, and this one has not been penetration tested by a
third party. If you find a security problem, please report it privately: see
SECURITY.md in the repository.

## Where your data is held

Your account and diary are stored on servers in Ohio, United States (Neon,
our database host). Meal plans you generate are processed by Groq, Inc.,
also in the United States. Forkast does not currently serve the EU or UK
(see "Groq, when you ask for a meal plan" above), so no international
transfer safeguard is in place for data from those regions yet.

## Changes

If this policy changes in a way that affects you, you will be told in the app
before the change takes effect, and asked to agree again if the change requires
it. The date at the top always reflects the current version.

## Contact

noorbbutt@gmail.com
[[FILL: postal address -- not supplied yet, required before publishing]]
