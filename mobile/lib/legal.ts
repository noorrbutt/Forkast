/**
 * The legal text the app carries with it.
 *
 * Held in the bundle rather than fetched, because both stores require a privacy
 * policy reachable from inside the app and a screen that needs the network to
 * show one is not reachable on a train. The hosted documents are the canonical
 * versions and go into the store listings; these are the same substance, short
 * enough to read on a phone.
 *
 * Keep this in step with docs/legal/. If the two ever disagree, the hosted one
 * is what a regulator will read and this one is what a user was actually shown,
 * which is the worse of the two to have wrong.
 */

export type LegalSection = {
  heading: string;
  /** Paragraphs. Rendered in order, no markup. */
  body: string[];
};

export type LegalDocument = {
  /** Route segment, and the anchor used when another screen links here. */
  slug: 'privacy' | 'terms' | 'tracking' | 'refunds';
  title: string;
  /** One line, shown in the list before you open it. */
  summary: string;
  sections: LegalSection[];
};

/**
 * Where the full, canonical versions live.
 *
 * Empty until they are hosted. The screen hides the "read the full version"
 * link rather than showing one that 404s, which is worse than not offering it.
 */
export const LEGAL_URLS: Record<LegalDocument['slug'], string> = {
  privacy: '',
  terms: '',
  tracking: '',
  refunds: '',
};

export const LAST_UPDATED = 'not yet published';

const PRIVACY: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy',
  summary: 'What Forkast stores, who else sees it, and how to delete it.',
  sections: [
    {
      heading: 'The short version',
      body: [
        'Forkast is a food diary. It stores what you tell it you ate, and works out figures from that.',
        'There is no advertising in it, no analytics, and nothing that tracks you across other apps or websites. Nothing about you is sold.',
      ],
    },
    {
      heading: 'What it stores',
      body: [
        'Your account: email address, your name if you give one, your time zone, and a password stored only as a hash. If you sign in with Google, your Google account identifier instead of a password.',
        'What you log: the dish, the category, the place and area if you name one, your rating, the serving size, the estimated calories, and the time. Photographs of meals, and a profile picture, if you add them.',
        'Health information: your goal, your daily calorie target, the calories you are estimated to have eaten, and any calories you record burning.',
        'Your IP address, for at most 24 hours, purely to stop somebody trying passwords against your account without limit.',
      ],
    },
    {
      heading: 'What it never collects',
      body: [
        'Your device location. Forkast holds no location permission and never asks for one. An area on a meal is a word you typed.',
        'Your advertising identifier, your contacts, your health app data, or any usage analytics. There is no crash reporting.',
      ],
    },
    {
      heading: 'Who else sees it',
      body: [
        'Google, only if you choose to sign in with Google: your Google identifier, email address and name.',
        'Groq, only when you ask for a meal plan: the dish names, categories, calories and timing of up to 30 recent meals, plus your goal and summary figures. Not your name, your email address, or your photographs.',
        'On Android the map is drawn by Google Maps, which collects device data under Google’s own terms. On iOS it uses Apple Maps.',
        'Nobody else. No advertisers, no data brokers.',
      ],
    },
    {
      heading: 'Deleting everything',
      body: [
        'Profile, then Delete my account. It asks for your password, or a fresh Google sign-in if your account has no password, because it cannot be undone.',
        'That erases your account, every meal, every photograph, your burned-calorie entries and your plans, immediately and permanently.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        'You can see, correct and delete your data, export it as JSON from Profile → Export my data, withdraw consent, object to processing, and complain to your data protection authority.',
        'Most of it is editable in the app. For anything else, write to the address in the full policy and it will be handled within one month.',
      ],
    },
  ],
};

const TERMS: LegalDocument = {
  slug: 'terms',
  title: 'Terms',
  summary: 'What Forkast is, what it is not, and the rules for using it.',
  sections: [
    {
      heading: 'Forkast is not medical advice',
      body: [
        'This is the part that matters. Forkast is not a medical device and gives no medical, nutritional or dietary advice.',
        'The calorie figures are estimates worked out from the name of a dish and the category you filed it under. They are not measurements. Nothing was weighed and no nutrition label was read. Two plates of the same dish can differ by a wide margin and Forkast cannot tell.',
        'The meal plans are written by a language model. They are suggestions assembled by software, not by a dietitian, and they can be wrong or unsuitable for you.',
        'Forkast knows nothing about your allergies, your medications, your conditions, or whether you are pregnant.',
        'Do not use it to manage a medical condition, and talk to a doctor or a registered dietitian before changing your diet in a way that matters.',
      ],
    },
    {
      heading: 'If food is difficult right now',
      body: [
        'Counting calories is not good for everyone, and a streak counter can make that worse rather than better.',
        'If you are worried about your relationship with food, please talk to someone qualified. This app is not the right tool for that and is not trying to be.',
      ],
    },
    {
      heading: 'Your account',
      body: [
        'One person, one account. Do not share your password. You are responsible for what happens under your account while it is signed in.',
        'You can delete it at any time from the Profile screen, which erases everything immediately.',
      ],
    },
    {
      heading: 'What you put in',
      body: [
        'Your meals and your photographs remain yours. We claim no ownership.',
        'You give permission to store them and show them back to you, and to send the described part of them to Groq when you ask for a plan.',
        'Do not upload anything unlawful, or a photograph of somebody who has not agreed to it.',
        'Restaurants are a shared list. A place you add first stays there for other people, with nothing about you attached, even after you delete your account.',
      ],
    },
    {
      heading: 'What it costs',
      body: [
        'Nothing. There are no purchases, no subscription and no advertising.',
        'If that ever changes you will be told first, and nothing will be charged without you agreeing to it.',
      ],
    },
    {
      heading: 'Availability',
      body: [
        'Forkast is provided as it is. We do not promise it will always be available or never lose anything, and we do not promise the estimates are accurate, because they are estimates.',
      ],
    },
  ],
};

const TRACKING: LegalDocument = {
  slug: 'tracking',
  title: 'Tracking',
  summary: 'What is stored on your device. Short, because there is very little.',
  sections: [
    {
      heading: 'Forkast does not track you',
      body: [
        'There are no cookies, no advertising identifiers, no analytics and no third-party tracking software in this app.',
        'That is why iOS never shows you the “Allow Forkast to track you?” prompt. There is nothing it would be asking about.',
      ],
    },
    {
      heading: 'What is kept on your device',
      body: [
        'Your sign-in tokens, in the device keychain or keystore, so you stay signed in. In a browser, in local storage instead.',
        'Your reminder times, if you turn reminders on.',
        'Cached images and responses, so the diary does not reload from nothing every time you open it.',
        'All of it goes when you uninstall, and the tokens go when you sign out.',
      ],
    },
    {
      heading: 'Reminders',
      body: [
        'Reminders are scheduled on your device, not sent from a server. No push service is involved and nothing about them leaves the phone.',
      ],
    },
  ],
};

const REFUNDS: LegalDocument = {
  slug: 'refunds',
  title: 'Refunds',
  summary: 'Forkast is free, so there is nothing to refund.',
  sections: [
    {
      heading: 'There is nothing to refund',
      body: [
        'Forkast is free. No purchase price, no subscription, nothing to buy inside it, and no advertising. It never collects a payment detail.',
        'This page exists so that it is already here if that ever changes, and because the stores expect one.',
      ],
    },
    {
      heading: 'If you were charged anything',
      body: [
        'You should not have been. Tell us and we will help you get it back.',
        'Where a charge went through Apple or Google, they hold the money and process the refund, so going to them directly is fastest. We will support the request either way.',
      ],
    },
    {
      heading: 'Deleting your account',
      body: [
        'Free, immediate, and needs nobody’s permission: Profile, then Delete my account. Because the app is free, deleting costs nothing and refunds nothing.',
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: LegalDocument[] = [PRIVACY, TERMS, TRACKING, REFUNDS];

export function legalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);
}

/**
 * The sentence the sign-up screen puts beside its consent box.
 *
 * Separate from the documents because consent has to name what is being
 * consented to, specifically, at the moment it is given. A box saying "I agree
 * to the terms" is not consent to processing health data under GDPR Art. 9,
 * which needs to be explicit and unbundled from everything else.
 */
export const HEALTH_CONSENT_LABEL =
  'I agree that Forkast may store the food I log, my calorie goal and the figures it works out from them, which is health information. I can delete all of it at any time.';

export const TERMS_CONSENT_LABEL =
  'I have read and agree to the Terms and the Privacy Policy.';
