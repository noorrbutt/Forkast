# Forkast Design Style Guide

This is the single source of truth for how a Forkast screen is composed. Every
screen is checked against Section 14 before it is considered done, and every
rewrite starts with the self-critique in Section 13.

It is a **hierarchy and composition** document. The ink and saffron palette, the
radii and the structural language in `mobile/theme/tokens.ts` stay as they are.
Nothing here is a rebrand.

---

## 0. How to use this

1. Before touching a screen, write its critique (Section 13). Name the rules it
   breaks. If you cannot name one, the screen may not need changing.
2. Compose the screen against Sections 4 to 11.
3. Run the checklist in Section 14. A screen that fails any hard rule is not done.

Rules marked **MUST** are enforceable and checkable. Rules marked **SHOULD** need
a stated reason to break, written in a comment at the call site.

---

## 1. The diagnosis

Forkast did not look generated because its colours or components were bad. It
looked generated because it had no point of view: every screen was a vertical
stack of same size rounded cards with centred text and nothing for the eye to
land on first. That is what happens when a screen is assembled card by card
instead of composed as a whole.

The evidence, measured rather than felt:

| Symptom | Measurement |
|---|---|
| Dashboard is an undifferentiated stack | 11 `<Card>` elements, all the same radius, padding and weight |
| Nothing is dominant | Largest type is 48px and it is used for both hero numbers and page titles, so they compete |
| Every section wears the same badge | `SectionLabel`, 11px uppercase with letterspacing, on 7 screens |
| Icons as decoration | 104 icon usages, including one beside nearly every section heading |
| Surfaces did not separate | Before the palette rebuild, card against page measured 1.09:1 |

Two of those are named industry tells for generated design: content chopped into
identical rounded cards with one radius regardless of hierarchy, and a tracked
out uppercase eyebrow label above every heading. Forkast had both.

**The failure mode this guide exists to prevent: equal weight everywhere.**

---

## 2. The seven design principles, for Forkast

Not dictionary definitions. What each one means on these screens.

### Contrast
Difference in size, weight and colour is how a screen says what matters. Forkast
had contrast in colour and almost none in size.

- **MUST** Every screen has exactly one element at the top of its visual
  hierarchy, and the gap to the second element is at least one full step of the
  type scale.
- **MUST** Never place two elements of the same type size adjacent and expect the
  reader to know which matters. Change the size, not the colour.

### Balance
Weight distributed across the screen. Forkast was perfectly balanced in the worst
way: everything equal, so the composition was inert.

- **SHOULD** Prefer asymmetric balance. A large hero on the left balanced by two
  small figures on the right reads better than three equal columns.
- **MUST NOT** Centre every element by default. Centring is for a screen with a
  single focal object (welcome, setup, an empty state), not for content.

### Hierarchy
The order the eye is meant to travel. A reader should be able to name the first,
second and third thing they saw, and agree with what you intended.

- **MUST** Every screen can answer: what is the one thing? Write it in a comment
  at the top of the screen component.
- **MUST** Hero, then supporting figures, then everything else. Three levels is
  usually enough; four is a sign the screen is doing two jobs.

### Repetition and consistency
The same idea looks the same everywhere. This is why a design system exists.

- **MUST** A given role always uses the same component. A setting is a `ListRow`.
  A choice among few is a `Chip`. A choice among many is a `Select`.
- **MUST NOT** Two screens solve the same problem differently. If you need
  something new, add it to `components/ui` so the next screen inherits it.

### Proximity
Related things sit together; unrelated things get space, not a border.

- **MUST** Group with space first. Reach for a card only when a group needs a
  surface of its own (Section 6).
- **MUST** Spacing inside a group is always smaller than the spacing around it.
  If the gap inside equals the gap outside, the grouping says nothing.

### Alignment
Everything sits on a shared line. Ragged edges read as unfinished.

- **MUST** One content column per screen, one left edge. Content is left aligned
  by default because it is read, not admired.
- **MUST NOT** Mix left aligned and centred blocks in the same scroll without a
  reason. A centred hero above left aligned content is fine; alternating is not.
- **SHOULD** Numbers in a column align on their right edge so they can be compared.

### White space
Space is the cheapest way to say something is important.

- **MUST** The hero gets more space above and below it than anything else on the
  screen.
- **MUST NOT** Fill space because it is empty. An empty screen is an invitation
  to act, not a hole to plug with cards.

---

## 3. The seven usability heuristics, for Forkast

A screen can be striking and still unusable, or usable and still slop. Both bars
must clear.

### Consistency
- **MUST** One name per action, everywhere. The button that says Sign up leads to
  a screen titled Sign up. Do not say Create account in one place and Sign up in
  another. This exact mismatch shipped once.

### Flexibility
- **MUST** Every input accepts the shape people actually type. Trim whitespace
  from emails, strip non digits from numeric fields.
- **SHOULD** A frequent action has a shortcut. Repeating yesterday's lunch is one
  tap from the diary, not a retyped form.

### Affordance
- **MUST** Anything tappable looks tappable: a fill, or a border of at least 3:1
  against what is behind it. A control with neither is text.
- **MUST** Tap targets are at least 48pt in their smallest dimension.
- This is not theoretical. A button variant shipped with a transparent fill and a
  transparent border, measuring 1.00:1, and users read it as a line of text.

### Clarity
- **MUST** A label says what happens, not what the system calls it.
- **MUST NOT** Use an icon to carry meaning a word should carry. If a heading
  needs an icon to be understood, the heading has the wrong words.

### Usability
- **MUST NOT** Disable the primary action of a form until the form is valid. Keep
  it live and say what is missing when pressed. Hiding the affordance behind the
  action it invites is the worst version of this, and it shipped.
- **MUST** A destructive action is confirmed in a dialog, never by an inline
  expansion that can scroll the warning out of view.

### Visibility
- **MUST** The state of the system is on screen. Loading, empty, error and
  success each have a designed state, not a blank.
- **MUST** A tap that succeeds says so. Silence reads as broken.

### Accessibility
- **MUST** Text clears 4.5:1 against the surface it sits on, and a control's
  boundary clears 3:1 against what is behind it. Both are asserted in
  `__tests__/contrast.test.ts`. Measure against the **card**, not just the page;
  measuring only against the page is how a 1.09:1 chip shipped.
- **MUST NOT** Carry meaning by colour alone. Selection also changes the border
  and adds a tick. Over target also says "over by 200" in words.
- **MUST NOT** Truncate a label. Wrap instead. "Maintain" rendering as "Maint..."
  is a failure, not a cosmetic issue.

---

## 4. Type

One family. Weight, size and space do the work.

### The scale

| Token | Size / weight | Job |
|---|---|---|
| `hero` | 64 / 300 | **Reserved.** The one number or headline a screen leads with |
| `display` | 48 / 300 | Page title, or a secondary numeral on a hero screen |
| `displaySm` | 34 / 300 | Paired numerals, such as a streak count |
| `numeral` | 26 / 300 | A figure inside a stat tile |
| `title` | 21 / 600 | Section or card title |
| `subtitle` | 16 / 600 | Row label, button label |
| `body` | 15 / 400 | Reading text, option labels |
| `caption` | 13 / 400 | Hints, timestamps, secondary detail |
| `labelSoft` | 12 / 500 | Small sentence case label |
| `label` | 11 / 600 caps | **Restricted.** See below |

### Why 64

Derived, not chosen. Measuring the reference screens: the hero numeral runs about
58pt on one and 38pt on the other, supporting numerals about 28pt, captions about
12pt, giving a hero to caption ratio near 5x. At 64, Forkast's hero is 4.92x its
caption and 2.46x its `numeral`, which sits in that range. It is also 1.33x
`display`, enough that a hero can never be mistaken for a page title. The dataviz
form guidance independently puts a dashboard hero figure at 48px or more.

### Rules

- **MUST** `hero` appears at most once per screen. Twice is a rule violation, not
  a judgement call.
- **MUST** `hero` is a number or a short headline, never a sentence.
- **MUST** The `hero` component steps down its own size for long values and large
  system text, so it can never overflow or truncate. The rule lives in the
  component, not in each caller.
- **MUST NOT** Use `label`, the 11px uppercase style, as a heading above every
  section. A tracked out uppercase eyebrow over every block is a named tell of
  generated design, and Forkast had it on 7 screens. `label` is allowed only for
  tab bar labels and for axis or legend text in a chart.
- **SHOULD** Use `title` in sentence case for a section heading. If a section is
  obvious from its content, it needs no heading at all.
- **MUST NOT** Accent a single word of a headline in a different colour or weight.
- **MUST NOT** Append an arrow to a button or link label. Use a chevron component
  where direction matters.

---

## 5. Space

All spacing comes from `spacing` in tokens. No literal numbers in a screen.

| Gap | Token | Used for |
|---|---|---|
| 4 | `xs` | Inside a single line of text and its immediate value |
| 8 | `sm` | Between elements of one thought, such as a label and its field |
| 12 | `md` | Between controls in a row |
| 16 | `lg` | Between rows inside a group |
| 24 | `xl` | Screen gutter, and between groups |
| 32 | `xxl` | Between major sections |
| 48 | `xxxl` | Above and below the hero only |

- **MUST** Proximity rule: the gap inside a group is at least one step smaller
  than the gap around it.
- **MUST** The hero is the only thing that gets `xxxl`. That reservation is what
  makes it read as the hero even before size is considered.
- **MUST** The content column is capped and centred on wide screens. A form
  running the full width of a tablet or a browser is not a design.

---

## 6. Composition: focal or list

This is the rule the old screens broke hardest.

### Lead with one focal element when

The screen answers a single question. A dashboard answers "how is today going".
A meal detail answers "what was this meal". A welcome screen answers "what is
this app".

Shape: one dominant object in the top third, supporting figures immediately
under it at a much smaller size, everything else below and visibly secondary.

```
  +-------------------------------+
  |                               |
  |         [ THE ONE THING ]     |   hero, xxxl above and below
  |                               |
  |   1,400 eaten    250 burned   |   supporting, displaySm or numeral
  +-------------------------------+
  |  secondary content, quieter   |
  |  secondary content, quieter   |
  +-------------------------------+
```

### Use a list or grid when

The items are genuinely repetitive and of equal weight. A diary of past meals is
a list. A row of three serving sizes is a group of equal choices.

### The hard rules

- **MUST NOT** Render a screen as a uniform stack of same size cards unless every
  card holds genuinely repetitive, equal weight content. A dashboard mixing a
  headline stat with secondary data is **never** one uniform stack. This is the
  single rule that would have prevented the 11 card dashboard.
- **MUST** A card exists to give a group its own surface. If a group needs no
  surface, use space instead. Reaching for `<Card>` by reflex is how a screen
  becomes a stack.
- **MUST** If a screen has more than six cards, it is doing more than one job.
  Split it, promote one thing to hero, or demote the rest into list rows.
- **MUST NOT** Give a hero and a secondary card the same radius, padding and
  border. Hierarchy is expressed in the container too, not only in the type.

---

## 7. Emphasis and asymmetry

- **MUST NOT** Give every element equal visual space by default. Equal weight
  everywhere is the failure mode this document exists to prevent.
- **SHOULD** Spend boldness in one place per screen. One element is memorable and
  everything around it is quiet and disciplined.
- **SHOULD** Prefer one large and two small over three medium.
- **MUST** When two things genuinely are equal, make them obviously equal:
  identical size, aligned, evenly spaced. Near equal is worse than either.

---

## 8. Colour, and what each colour's job is

Every colour does exactly one job. Tokens only, never a literal hex in a screen.

| Job | Token | Rule |
|---|---|---|
| Structure | `bg`, `surface`, `surfaceAlt`, `border` | A solved ramp; each step clears a measured floor against the one below |
| Control boundary | `outline` | 3:1 or better against `surface` and `surfaceAlt` |
| Brand and primary action | `accent`, `accentFill`, `accentInk` | Two values, one per theme, because one hex cannot be legible on both |
| Positive state | `success` | Reserved. Never a series colour |
| Attention state | `danger` | Reserved. Never a series colour |
| Inactive | `disabledFill`, `disabledInk` | A different fill, never a faded copy of the enabled one |

### Cuisine colour

Ten cuisines were given generated colours, spaced 36 degrees apart in hue at a
constant lightness. The palette validator failed it on three of six checks:

- Normal vision floor: worst adjacent pair 9.3, needs 15. Desi and American are
  hard to tell apart with full colour vision.
- CVD separation: worst adjacent pair 5.8 deutan and 2.4 tritan, needs 8.
- Lightness band: every value between 0.71 and 0.82, because hue varied and
  lightness did not.

The method caps a categorical palette at eight hues in a fixed order, and lists
"more than about seven colour classes carrying meaning" as an anti pattern:
past that, adjacent classes blur. Ten cannot be made safe by re-picking values.

Therefore:

- **MUST NOT** Use colour as the identity channel for cuisine. Identity is the
  emoji plus the name, both already present and both stronger than a dot.
- **MAY** Use a cuisine colour as a large area accent where exactly one cuisine
  is on screen at a time, such as a meal detail, where no two are adjacent and
  the separation problem does not arise.
- **MUST NOT** Place cuisine colour dots next to each other in a list or a picker.

### Chart series

- **MUST** Two series maximum on the calorie chart, eaten and burned, which is
  well inside the cap.
- **MUST** A chart with two or more series carries a legend, and identity is
  never colour alone.
- **MUST NOT** Use a second y axis. Ever. Two measures of different scale means
  two charts.
- **MUST** Text in a chart wears text tokens, never the series colour. A coloured
  mark beside the label carries identity.

---

## 9. Data display

- **A single current value** is a stat tile. The number is the chart. Not a one
  bar bar chart.
- **The one number a screen leads with** is a hero figure at `hero`.
- **A single ratio against a limit** is a meter: one track, one fill, same ramp.
  Not a two slice pie.
- **More than about seven classes carrying meaning** is a table, not more colours.

### The calorie ring

The dashboard hero is a ring shaped **meter**, not a donut chart. One track, one
fill, one value against one target. This is legitimate for part to whole at a
glance; donuts are an anti pattern for comparing close values, which this is not.

- **MUST** Going over target is visible as more than a colour change. The track
  extends past the target mark and the words say "over by N".
- **MUST** The ring says which number it is measuring. Net and consumed are
  different numbers and a bar that moves for an unexplained reason is worse than
  no bar.

### Marks

- **MUST** Thin marks, recessive grid and axes, 2px lines, markers at least 8px.
- **MUST** A 2px surface gap between adjacent fills so they never merge.
- **SHOULD** Label selectively. Never a number on every point.

---

## 10. Icons and imagery

### Icons: where they are used today

Icons come from `@expo/vector-icons` through `components/ui/Icon.tsx`, which maps
a **meaning** to a glyph so the same idea is never drawn two ways.

**Allowed:**
- The tab bar, one per tab, outline when inactive and filled when active.
- Navigation and interaction affordances: back, close, search, the chevron on a
  row, the raised add button.
- One icon inside an empty state.
- A button icon where it clarifies the action, such as a trash on a delete.
- Cuisine emoji in lists and pickers, which is identity, not decoration.

**Banned:**
- **MUST NOT** Put an icon beside a section heading. This was on 7 screens and is
  a large part of why the app read as templated.
- **MUST NOT** Put a decorative disc behind an icon to give it presence.
- **MUST NOT** Put an icon on a stat tile.
- **MUST NOT** Introduce a glyph that is not in the `Icon` map. Add the meaning to
  the map or do without.

### Imagery

- **MUST NOT** Ship stock photography or decorative illustration. There is none
  in the app and there will be none.
- **MUST** The only images are the user's own meal photos. They appear as a
  thumbnail in the meals list and as the lead element on a meal detail.
- A meal with no photo shows a typographic placeholder, never a generic camera
  glyph in a grey box.

---

## 11. Motion

- **MUST** Motion answers an action. Opening, expanding, confirming, selecting.
- **MUST NOT** Fade and slide up every section on mount. That is the generic
  default and it delays content the reader is waiting for.
- **SHOULD** One orchestrated moment per screen at most.
- **MUST** Durations come from `theme/motion.ts`. Nothing under 120ms, which is
  below the threshold at which a transition reads as motion rather than a flicker.

---

## 12. Words

- Sentence case everywhere except the tab bar.
- A button says what happens: "Log this meal", not "Submit".
- An action keeps its name through the flow. "Sign up" leads to "Sign up".
- An empty state says what will appear here and offers the one action that gets
  the user there.
- An error says what happened and what to do. It does not apologise and it is
  never vague.
- No filler. Every string does one job.

---

## 13. The before and after self-critique

**Required before rewriting any screen.** Write it as a comment at the top of the
screen file, or in the commit body. It is not optional and it is not a summary of
what you changed.

State, in this order:

1. **What the screen was.** Its structure in one sentence. "A vertical stack of
   eleven cards."
2. **Which rules it broke.** Name them from this document, with the measurement
   where there is one. "Section 6: eleven uniform cards on a screen mixing a
   headline stat with secondary data. Section 4: no element above `display`, so
   nothing was dominant. Section 10: an icon beside all five headings."
3. **What the one thing is now.** "Today's calories against target, as a ring."
4. **What was demoted, and why that is correct.** "Burn equivalents and top spot
   moved below the fold. They are reference, not the question the screen answers."

If step 2 comes out empty, stop. Either the screen is already right, or the
critique is not honest enough yet.

---

## 14. The checklist

A screen is not done until every line passes.

**Composition**
- [ ] I can name the one thing, and a stranger would name the same one.
- [ ] Exactly one `hero` on the screen, or none if this screen has no focal value.
- [ ] Not a uniform stack of same size cards, unless the content is genuinely
      repetitive and equal weight.
- [ ] Six cards or fewer, or a written reason why more is right.
- [ ] The hero has more surrounding space than anything else.
- [ ] One content column, one left edge, capped width on wide screens.

**Type**
- [ ] `hero` used at most once, and it cannot overflow or truncate.
- [ ] No uppercase eyebrow label above a section.
- [ ] No single accented word in a headline.
- [ ] No label anywhere can truncate.

**Colour and contrast**
- [ ] No literal hex in the screen. All colour from `useTheme()`.
- [ ] Text 4.5:1 against the surface it actually sits on, card included.
- [ ] Every control has a fill or a 3:1 boundary.
- [ ] Nothing carries meaning by colour alone.
- [ ] No cuisine colour dots adjacent to one another.

**Usability**
- [ ] Tap targets 48pt or more.
- [ ] Primary action never disabled to hide it; it says what is missing instead.
- [ ] Loading, empty and error states all designed.
- [ ] Destructive actions confirmed in a dialog.

**Icons and imagery**
- [ ] No icon beside a section heading.
- [ ] No decorative disc behind an icon.
- [ ] No stock imagery.

**Craft**
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx jest` green, contrast test included.
- [ ] Bundles on web, iOS and Android.
- [ ] No em dashes or en dashes anywhere.

---

## 15. Amending this document

When a screen genuinely needs something this guide forbids, change the guide
first, with the reason, and then the screen. A rule with a growing list of
exceptions in comments is a rule that is wrong.
