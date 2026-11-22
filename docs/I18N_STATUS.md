# Mobile i18n status

`mobile/lib/i18n.ts` registers English (`en`) and Urdu (`ur`), selects Urdu for
Urdu device locales, and falls back to English. The language test verifies both
locale files have matching key trees.

Urdu exists. RTL is handled: `mobile/lib/language.ts` sets `document.dir` on web
and uses React Native's `I18nManager` on native. Native layout direction changes
require closing and reopening the app.

Counts are direct user-facing literal occurrences in each route file's JSX text
and common copy props (for example `title`, `label`, and `placeholder`).
They exclude imported constants, shared components/layouts, comments, and
dynamic/API-provided text; they are not whole-screen totals. “Yes” means the
screen's primary static copy uses translations, not that dynamic content is
localized.

| Screen | Translated | Hardcoded strings | Note |
|---|---:|---:|---|
| Dashboard (`/`) | Yes | 0 | Main copy is in translated shared components. |
| Onboarding | Yes | 0 | Uses onboarding keys. |
| Meal log | Yes | 0 | Capture, confirm, and manual forms use translations. |
| Diary / history | Yes | 0 | List and map UI copy uses diary keys. |
| Plan | No | 10 | Headings, actions, and errors are hardcoded. |
| Streaks | No | 11 | Screen copy and actions are hardcoded. |
| Profile | No | 58 | Settings, account, and language section are mostly hardcoded. |
| Meal detail / edit | No | 35 | Detail, edit, and delete copy is hardcoded. |
| Trends | No | 5 | Titles and empty/error copy are hardcoded. |
| Setup | No | 7 | Goal, target, and action copy is hardcoded. |
| Map (`/map`) | No* | 0 | Legacy route redirects to the diary's map view. |
| Welcome | No | 5 | Auth welcome copy is hardcoded. |
| Sign in | No | 12 | Form labels and actions are hardcoded. |
| Sign up | No | 17 | Form labels and actions are hardcoded. |
| Forgot password | No | 5 | Form copy is hardcoded. |
| Check email | No | 3 | Verification copy and actions are hardcoded. |
| Reset password | No | 8 | Form copy is hardcoded. |
| Reset confirmation | No | 1 | Confirmation action is hardcoded. |

`*` The map route has no screen of its own. The shared tab bar's Plan, Streaks,
and Profile labels remain hardcoded.
