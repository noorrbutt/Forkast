# Store disclosures, answered from the code

The Play Data Safety form and Apple's Privacy Nutrition Label are both sworn
declarations. Getting one wrong is worse than getting it late: Google suspends
apps for a Data Safety form that contradicts observed behaviour, and Apple
treats a wrong label as a misrepresentation rather than a mistake.

Every answer below is derived from what the code does, with the file that proves
it. Re-derive them if the dependency list changes.

---

## App Tracking Transparency (iOS): not required

**Determination: Forkast must not show the ATT prompt, and must declare that it
does not track.**

Apple defines tracking as linking user or device data collected from this app
with data from other companies' apps, websites or offline properties, for
advertising or advertising measurement, **or** sharing it with a data broker.

Forkast does none of it:

| ATT trigger | Present? | Evidence |
|---|---|---|
| Reads IDFA / `ATTrackingManager` | No | No `expo-tracking-transparency`, no `AppTrackingTransparency` usage anywhere |
| Advertising SDK | No | No ad network in `mobile/package.json` |
| Analytics or attribution SDK | No | No Firebase, Sentry, Segment, AppsFlyer, Adjust, Branch, Facebook SDK |
| Shares data with a data broker | No | The only recipients are Google (sign-in you chose) and Groq (a plan you asked for), both processors for a function you requested |
| Combines your data with other companies' data for ads | No | There is no advertising |

**What to do:**

- Do **not** add `NSUserTrackingUsageDescription` to the Info.plist. Including it
  in an app that does not track invites a reviewer to ask what you are tracking.
- Do **not** call `requestTrackingAuthorization`. Prompting without tracking is
  itself a guideline problem.
- In App Store Connect, under "Data Used to Track You", declare **none**.

This determination expires the moment anyone adds an analytics or advertising
SDK. Treat adding one as a change that requires redoing this page.

---

## Apple Privacy Nutrition Label

Three sections. Everything Forkast collects is **"Data Linked to You"**, because
it all hangs off an account.

### Data Used to Track You
**None.** See above.

### Data Linked to You

| Category | Type | Purposes | Source |
|---|---|---|---|
| Contact Info | Email address | App Functionality | `users.email` |
| Contact Info | Name | App Functionality | `users.first_name`, `users.last_name`, optional |
| Health & Fitness | Fitness | App Functionality | `users.goal`, `users.daily_calorie_target`, `burn_logs`, `food_logs.estimated_calories` |
| User Content | Photos | App Functionality | `food_log_photos`, `user_avatars` |
| User Content | Other User Content | App Functionality | `food_logs` (dish names, ratings, notes) |
| Identifiers | User ID | App Functionality | `users.id`, `users.google_sub` |
| Diagnostics | — | Not collected | No crash or performance reporting exists |

### Data Not Collected
Location, Contacts, Browsing History, Search History, Purchases, Financial Info,
Sensitive Info as Apple defines it, Device ID, Advertising Data, Usage Data.

**Note on "Location":** declare **not collected**. `food_logs.area` is a word you
typed, such as "Clifton". The app holds no location permission and never calls a
location API. [[VERIFY before submitting: if you ever add a "find restaurants
near me" feature this answer changes immediately.]]

---

## Google Play Data Safety

### Data collected

| Category | Type | Collected | Shared | Required | Purpose |
|---|---|---|---|---|---|
| Personal info | Name | Yes | No | Optional | App functionality |
| Personal info | Email address | Yes | Yes (Google, at sign-in) | Required | App functionality, Account management |
| Personal info | User IDs | Yes | No | Required | App functionality |
| Health and fitness | Health info | Yes | **Yes (Groq)** | Optional | App functionality |
| Photos and videos | Photos | Yes | No | Optional | App functionality |
| App activity | Other user-generated content | Yes | **Yes (Groq)** | Optional | App functionality |
| App info and performance | Crash logs / Diagnostics | No | No | — | Nothing collects them |

### Security practices

- **Encrypted in transit:** Yes. HTTPS, and a production build refuses to
  compile against a non-HTTPS API URL (`mobile/app.config.js`).
- **Users can request deletion:** Yes, in-app and via a web route.
- **Committed to the Play Families Policy:** No. The app is not for children.
- **Independent security review:** No. Do not claim one.

### The two answers people get wrong

**"Is data shared?"** Play defines sharing as transfer to a *third party*. Groq
receives meal data and health data when a user asks for a plan, so the honest
answer is **yes** for those categories, even though Groq is your processor.
Answering "no" here because "they are only a processor" is the single most
common cause of a Data Safety suspension.

**"Is collection optional?"** Health data is optional in the sense that the user
chooses whether to set a goal or log burned calories, but they cannot use the
app without logging food. Mark food data required and the rest optional.

---

## Account deletion

Play has required, since 2024, that any app allowing account creation offers
account deletion **both in the app and at a URL reachable without installing
it**.

- **In-app:** done. Profile → Delete my account, confirmed with a password or a
  fresh Google sign-in, cascading to every table.
- **Web:** the browser build of Forkast (docs/WEB_DEPLOY.md) is itself the web
  route -- sign in at the deployed URL and use Profile → Delete my account from
  a browser, no install required. Give that URL in the Play Console's account
  deletion field: [[FILL: the deployed web build's own URL, once it has one
  you consider stable enough to put in a store listing]].

---

## App Store Review Guidelines: risks specific to this app

Ordered by how likely each is to cost you a review cycle.

### 1. Health claims and the absence of a disclaimer — HIGH

Guideline 1.4.1 and 5.1.3. An app that estimates calories and generates dietary
plans is a health app in a reviewer's eyes. Forkast currently ships **no
disclaimer anywhere in the interface** saying the figures are estimates and are
not dietary advice.

The plans are generated by a language model, which raises it further: a reviewer
who sees "AI meal plan" will look for the line that says it is not professional
advice.

**Fix:** a visible, persistent disclaimer on the plan screen and in onboarding,
not buried in the terms. Drafted in `docs/legal/TERMS.md` section 3.

### 2. Eating disorder exposure — HIGH, and not only a compliance matter

Calorie counters attract scrutiny for encouraging restrictive eating. Forkast
has a "days since a junk meal" streak, which is a reward mechanic attached to
food restriction, and a junk/not-junk split that moralises food.

Both stores have rejected apps over this, and independently of that it is a real
risk to real users. Consider: an age gate, signposting to a helpline, and not
framing a broken streak as a failure.

Current position: the Terms (section 3, "If food is difficult right now")
signpost NEDA and Beat, and the age floor is set at 13 (Privacy Policy,
"Children"). The streak and junk/clean split themselves have not been
redesigned to soften the restriction framing -- that is a genuine, still-open
product decision, not a compliance checkbox, and is deliberately left here
rather than silently resolved.

### 3. Sign in with Apple — probably not required

Guideline 4.8 requires an equivalent privacy-preserving login option **only**
where the app uses a third-party login service *exclusively*. Forkast offers
email and password alongside Google, so 4.8 is satisfied as it stands.

If you ever make Google the only way in, Sign in with Apple becomes mandatory on
iOS.

### 4. Account deletion in-app — satisfied

Guideline 5.1.1(v). Present and correct.

### 5. Privacy policy link — MISSING, blocks both stores

Both stores require a privacy policy reachable **from inside the app** as well
as a URL in the listing. There is currently no legal text anywhere in the
interface. See the in-app Legal screen added alongside these documents.

### 6. Permissions and purpose strings — mostly good

Android declares only `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED`, and
actively strips three permissions Expo's template adds. That is better than most
apps manage.

`NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` are set in
`mobile/app.config.js`'s `ios.infoPlist`, each stating specifically what
Forkast does with the photo (estimates calories from a meal photo, or uses
a chosen photo as a meal or profile picture) rather than a generic "needs
access" line.

### 7. Demo account for review — needed

Both stores need a working account to review behind the sign-in wall. Provide
the seeded demo credentials, and make sure the reviewer's account is not rate
limited out of existence on first use.

---

## Copyright and assets

| Asset | Source | Status |
|---|---|---|
| Figtree typeface | `@expo-google-fonts/figtree` | SIL Open Font License. Free to bundle and ship commercially. Checked: no acknowledgements or licenses screen exists anywhere in the app yet, so the OFL's requirement to distribute the licence text alongside the font is not currently met. Add one before shipping. |
| `@expo/vector-icons` | Bundled icon sets | Checked: `mobile/components/ui/Icon.tsx` (the only place this repo imports from `@expo/vector-icons`) imports **only Ionicons**, which is MIT-licensed. No CC BY 4.0 set is used, so no attribution requirement applies. |
| App icon, splash, notification icon, monochrome icon | [[FILL: how were these made -- by hand, commissioned, or generated by an AI tool? Not determinable from the repo; git history shows them added in the initial scaffold with no note on provenance. If AI-generated, check that tool's terms for commercial use and whether the output is copyrightable where you are. If commissioned, confirm you hold the copyright, not merely a licence.]] | **Unverified** |
| Restaurant names and areas in the seed data | Real Karachi restaurants | Names are factual and generally not copyrightable. Coordinates are deliberate neighbourhood-level approximations, not surveyed positions (`backend/app/seed/data.py`'s own comment on this). Checked: no code anywhere in this repo calls a Google Maps data API or scrapes Google Maps, so the specific risk of storing data extracted via Google's API/terms does not apply here -- `react-native-maps` only renders map tiles on Android, it never fetches or stores place data. |
| Meal photographs | Uploaded by users | Users grant permission via the Terms; you display them only back to the uploader |

---

## Business details required by the stores

Both listings require a real identity, and Apple additionally requires a trader
declaration in the EU under the Digital Services Act.

- **Legal entity name:** Noor Butt, sole trader.
- **Registered address:** [[FILL: not supplied yet, required before submitting to either store]].
- **Support email address:** noorbbutt@gmail.com.
- **Support URL:** [[FILL: a page or repo README a user can reach for help --
  the GitHub repo itself (if public) is acceptable for a project this size]].
- **Privacy policy URL:** https://github.com/noorrbutt/Forkast/blob/main/docs/legal/PRIVACY.md
  (requires the repo to be public; see mobile/lib/legal.ts's own note on
  keeping the hosted and in-app copies in step).
- **EU trader status:** [[FILL: since February 2025 Apple requires every
  developer distributing in the EU to declare whether they are a trader, and
  has removed apps from EU storefronts where the declaration is missing or
  unverified. An individual sole trader not registered as a business in the
  EU would typically declare "not a trader," but confirm this against
  Apple's own current definition before submitting -- verification takes
  time, so start it early if Forkast will be listed in the EU.]]
