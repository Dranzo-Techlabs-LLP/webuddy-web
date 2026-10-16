# Clariva Web — "Clear Water" design system (glass edition)

Status: **v2.1 (2026-10-16): foundation built and verified**. This is the single source of truth for the visual and
interaction redesign. Every surface agent reads it first. The foundation pass turned sections 2–5 into code
(`res/css/clariva/_brand.pcss`, `_fonts.pcss`, `_glass.pcss`, `_motion.pcss`, `src/clariva/ui/`) and recorded the FINAL
values in section 2 (a few hex values were nudged to satisfy the contrast rules in section 9; each nudge is called out
there). Section 11 is the API reference (mixins, classes, React primitives) the surface agents code against.
`test/clariva/designTokens-test.ts` fails if this document and the stylesheets drift apart.

v2.2 (2026-10-16): the surface pass (shell and Chats, Home, room, overlays and forms, wallet, sign-in, QR, refund, calls) is
built and integrated; section 12 records what exists, who owns which selector, and the deliberate differences from sections 4-6.

v2.1 folds in an independent verification of the foundation: Fraunces numerals are proportional (money in a column uses
Inter, section 2 "Type"); two dark text colours were nudged and `--cg-teal-text` was added (section 2, "Text colour by
surface"); floating chrome must be thick glass (section 3, rule 7); the live aurora is confined to two places (rule 6);
the in-app High contrast themes, the wallpaper layer and the skeleton got their fallbacks (rule 8); the transition mixins
can be composed (section 5); the display face has a metrics-matched fallback and a preload (section 2, "Type").

Skills applied: `ui-ux-pro-max` (rules + checklist), `frontend-design` (distinct direction, plan-then-review),
`liquid-glass-frontend` (real frost + aurora + token system), `apple-design` (materials, springs, response, reduced
transparency), `emil-design-eng` (craft, motion by frequency), `animate` (build order for motion), `webapp-testing`
(verification).

## 1. Concept

**Clariva = clarity.** A private conversation with a trusted consultant should feel like looking through clean water:
calm, bright, close. The whole product is **frosted glass floating over a soft aurora of teal and navy**, with ONE warm
accent (amber) reserved for money (credits). Nothing shouts; everything is legible.

* **Signature moment (spend the boldness here, keep the rest quiet):** the living aurora on the *sign-in page* (behind
  ONE glass card) and, on the *Home dashboard* (desktop welcome pane), as a decorative glow behind the greeting area that
  no glass card overlaps, with the logo "surfacing" through the frost on first load. In chat rooms the aurora is
  **static** (performance, and chat is a high-frequency screen); section 3, rule 6 says why nothing blurred may sit on an
  animated layer.
* **Metaphor for shapes:** water drops. Bubbles are soft glass drops with a specular highlight on the upper edge and a
  small tail corner; the consultant card and wallet card are thicker glass "lenses".
* **Not** the AI-default kit: no cream + terracotta, no black + acid-green, no identical rounded-card grids, no
  eyebrow-label-above-every-heading, no gradient text, no purple. Hierarchy comes from size, weight, spacing and
  material thickness, not from decoration.

## 2. Tokens (final values, enforced by `test/clariva/designTokens-test.ts`)

All tokens are CSS custom properties. Light values and every theme-invariant token are on `:root[data-clariva]` in
`res/css/clariva/_brand.pcss`; the dark values override them on `:root[data-clariva] body[class*="cpd-theme-dark"]` (the
theme class lives on `<body>`, see `src/theme.ts`; this is the same mechanism the older `--clariva-*` dark tokens use).
Prefix `--cg-` ("Clariva glass"). The `--clariva-*` tokens stay (used widely); new work uses `--cg-*`. Tokens that are
built FROM other tokens (the surface, backdrop and edge set, section 3) are declared on `body` in `_glass.pcss`, because a
`var()` resolves where it is declared and must see the dark values.

The test reads this section: every token named here must exist (in both themes unless it is theme-invariant), every token
`_brand.pcss` declares must be named here, and every value in the tables below must equal the stylesheet. Change a value in
both places or the build fails.

Text on a glass material uses `--cg-text`, `--cg-text-2`, `--cg-text-3` and the accent texts, not Compound's
`--cpd-color-text-secondary` (4.48:1 on the thinnest light glass over the teal aurora peak, 3.52:1 on the thinnest dark
glass over the brightest point; both measured with the material's `saturate()` boost, section 3). `--cg-text-3` is for
glass and inset tiles only (4.6:1 or more at worst), never directly on the wallpaper and never on the amber wash.

### Palette (6 named colours) and semantic colours

| Token | Light | Dark | Role |
|---|---|---|---|
| `--cg-bg` | `#eaf7f5` | `#06141f` | Mist / Deep Sea: page base under the aurora |
| `--cg-navy` | `#0b1f3a` | `#0b1f3a` | Ink Navy, fixed: text on amber and on the light teal tint |
| `--cg-teal` | `#00b8a0` | `#2fd9c1` | Clarity Teal: brand, decorative tints (NOT text: 2.5:1 on the light base) |
| `--cg-teal-deep` | `#00806e` | `#0a8072` | Deep Teal: a FILL that carries white text (4.87:1 and 4.83:1; dark nudged from `#12a593`, 3.1:1). **Never a text colour** (3.3:1 on the light wallpaper, 2.1:1 on the dark): use `--cg-teal-text` |
| `--cg-amber` | `#f5b544` | `#f5b544` | Amber Coin: credits / wallet ONLY |
| `--cg-coral` | `#d7373f` | `#d13c44` | Coral fill that carries white text (decline, destructive): 4.66:1 and 4.73:1 |
| `--cg-on-teal-deep` | `#ffffff` | `#ffffff` | text on teal-deep |
| `--cg-on-amber` | `#0b1f3a` | `#0b1f3a` | text on amber (9.1:1) |
| `--cg-on-coral` | `#ffffff` | `#ffffff` | text on coral |
| `--cg-coral-text` | `#b3232b` | `#ff8a8f` | coral as text / glyph on glass and inset tiles (errors, debit); dark nudged from `#ff6b72` (3.8:1 on an inset tile) |
| `--cg-teal-text` | `#006f60` | `#2fd9c1` | teal as text / glyph on glass and inset tiles (links, accent labels); NOT on the bare wallpaper (4.1:1 on the light one) |
| `--cg-amber-text` | `#7a4f00` | `#f8c569` | amber-family text on glass, inset tiles and the amber wash; dark nudged from `#f5b544` (4.2:1 on the wash on an inset tile) |
| `--cg-amber-wash` | `rgba(245, 181, 68, 0.22)` | `rgba(245, 181, 68, 0.18)` | quiet amber tag background (credits label) |
| `--cg-text` | `#0b1f3a` | `#eaf6f4` | primary text (Ink Navy / mist) |
| `--cg-text-2` | `#2b4263` | `#b6cbd0` | secondary text |
| `--cg-text-3` | `#4f657f` | `#98b1b8` | tertiary text, glass and inset tiles only (never the wallpaper, never the amber wash) |
| `--cg-line` | `rgba(11, 31, 58, 0.1)` | `rgba(234, 246, 244, 0.12)` | hairline |
| `--cg-line-strong` | `rgba(11, 31, 58, 0.6)` | `rgba(234, 246, 244, 0.6)` | the visible 1px border of every opaque fallback (3:1 or more) |
| `--cg-highlight` | `rgba(255, 255, 255, 0.7)` | `rgba(255, 255, 255, 0.16)` | specular top edge |
| `--cg-scrim` | `rgba(11, 31, 58, 0.45)` | `rgba(2, 8, 14, 0.62)` | modal scrim |
| `--cg-focus` | `#00806e` | `#2fd9c1` | focus ring colour: 2px solid, 2px offset; 3:1 or more on every glass fill over the worst aurora point, on the bare wallpaper and on the solids (but only 1.86:1 on the light tint: see `--cg-focus-on-tint`) |
| `--cg-skeleton` | `rgba(11, 31, 58, 0.08)` | `rgba(234, 246, 244, 0.1)` | placeholder block fill |

### Text colour by surface

Which text colour may sit on which surface. The numbers are the worst case, in :1, over EVERY point of the wallpaper, in
both themes and on all three glass materials, with the material's `saturate()` boost applied (the backdrop is saturated
before the fill is painted over it); "never" marks a pair that can fall below 4.5:1 and is banned. The test recomputes
every number from the tokens and fails when this table is stale.

| Text colour | on glass | on an inset tile | on the amber wash |
|---|---|---|---|
| `--cg-text` | 11.2 | 9.4 | 6.9 |
| `--cg-text-2` | 7.3 | 6.2 | 4.5 |
| `--cg-text-3` | 5.1 | 4.6 | never |
| `--cg-coral-text` | 5.5 | 4.6 | never |
| `--cg-teal-text` | 5.2 | 5.5 | never |
| `--cg-amber-text` | 6.0 | 6.5 | 4.7 |

* The accent texts (`--cg-coral-text`, `--cg-teal-text`, `--cg-amber-text`) are for glass, inset tiles and the opaque
  solids (5.4:1 or more there). None of them is guaranteed on the bare wallpaper: only `--cg-text` (9.3:1 or more) and
  `--cg-text-2` (6.1:1 or more) are.
* `--cg-text-3` must NOT be used on the amber wash (it is 3.4:1 there in the dark theme); coral-text and teal-text do not
  belong on it either. The credits tag is `--cg-amber-text` (or `--cg-text`) on `--cg-amber-wash`.
* Teal has no TEXT token other than `--cg-teal-text`. `--cg-teal-deep` is a fill (white text on it), and `--cg-teal` is
  decorative; neither may colour a glyph or a word.
* Glass that content scrolls under (floating chrome) carries `--cg-text` only: section 3, rule 7.

### Material fills and opaque fallbacks

| Token | Light | Dark | Role |
|---|---|---|---|
| `--cg-fill-thin` | `rgba(255, 255, 255, 0.58)` | `rgba(12, 32, 48, 0.46)` | chips, pills, small controls over the wallpaper (never over scrolling content) |
| `--cg-fill-regular` | `rgba(255, 255, 255, 0.66)` | `rgba(12, 32, 48, 0.52)` | list pane (nothing scrolls under it); never a floating bar (section 3, rule 7) |
| `--cg-fill-thick` | `rgba(255, 255, 255, 0.8)` | `rgba(12, 32, 48, 0.7)` | dialogs, sheets, menus, call sheet, and all floating chrome: room header, composer, tab bar, scroll-to-latest pill (rule 7; 10.3:1 and 5.6:1 for `--cg-text` over black / white content, no nudge needed) |
| `--cg-fill-tint` | `linear-gradient(180deg, rgba(0, 196, 172, 0.82), rgba(0, 170, 148, 0.82))` | `linear-gradient(180deg, rgba(0, 126, 108, 0.84), rgba(0, 104, 92, 0.84))` | outgoing bubbles, primary / accept (no blur) |
| `--cg-fill-inset` | `rgba(255, 255, 255, 0.45)` | `rgba(255, 255, 255, 0.06)` | tiles ON glass (never blurred) |
| `--cg-on-tint` | `#0b1f3a` | `#eaf6f4` | text on the tint (4.5:1 or more on both stops over every backdrop) |
| `--cg-focus-on-tint` | `#0b1f3a` | `#eaf6f4` | the focus ring inside a `cg-glass-tint` scope (= `--cg-on-tint`): 6.3:1 light and 5.0:1 dark on the tint stops, 3:1 or more on the glass around it. `cg-glass-tint` re-points `--cg-focus` and Compound's `--cpd-color-border-focused` to it for the element and every descendant |
| `--cg-tint-edge` | `rgba(0, 128, 110, 0.35)` | `rgba(255, 255, 255, 0.14)` | hairline around a tint |
| `--cg-solid-thin` | `#f0f9f7` | `#0f2638` | opaque fallback of thin |
| `--cg-solid-regular` | `#f5fbfa` | `#0e2232` | opaque fallback of regular |
| `--cg-solid-thick` | `#ffffff` | `#132c3f` | opaque fallback of thick |
| `--cg-solid-tint` | `#27c2ad` | `#0b6b5f` | opaque fallback of tint |
| `--cg-solid-inset` | `#e7f5f2` | `#183349` | opaque fallback of inset |
| `--cg-pane-wash` | `rgba(255, 255, 255, var(--cg-pane-wash-alpha))` | `rgba(6, 20, 31, var(--cg-pane-wash-alpha))` | light veil between the wallpaper and the room / home pane (the aurora shows through; essential text on the bare pane uses `--cg-text` / `--cg-text-2`, never Compound text-secondary) |

The veil's opacity is one theme-invariant token (declared once, in the light block):

| Token | Value | Role |
|---|---|---|
| `--cg-pane-wash-alpha` | `0.35` | the ONE knob for how much aurora the room / home pane lets through (35 % veil: the aurora shows at 65 %; chosen after a browser check, 80 % hid it). Tested between 0.25 and 0.6 |

### Elevation

Layered soft shadows tinted with Ink Navy (never pure black); the inset specular edge is separate (section 3).

| Token | Light | Dark | Role |
|---|---|---|---|
| `--cg-e1` | `0 1px 2px rgba(11, 31, 58, 0.06), 0 2px 8px rgba(11, 31, 58, 0.06)` | `0 1px 2px rgba(0, 6, 12, 0.4), 0 2px 8px rgba(0, 6, 12, 0.3)` | chips |
| `--cg-e2` | `0 2px 4px rgba(11, 31, 58, 0.05), 0 8px 24px rgba(11, 31, 58, 0.1)` | `0 2px 4px rgba(0, 6, 12, 0.35), 0 8px 24px rgba(0, 6, 12, 0.45)` | list pane, panels |
| `--cg-e3` | `0 4px 8px rgba(11, 31, 58, 0.06), 0 16px 48px rgba(11, 31, 58, 0.16), 0 32px 64px rgba(11, 31, 58, 0.1)` | `0 4px 8px rgba(0, 6, 12, 0.4), 0 16px 48px rgba(0, 6, 12, 0.55), 0 32px 64px rgba(0, 6, 12, 0.4)` | dialogs, call sheet, floating chrome |

### Aurora (wallpaper)

`--cg-aurora` is a stack of four large soft `radial-gradient`s (a CSS background, no `filter: blur`) painted over `--cg-bg`
on `<body>` for the whole app (except under the in-app High contrast themes), so every glass surface has something to
refract. It is literal in both theme blocks of `_brand.pcss`. Geometry (`size at position`) is the same in both themes;
only colour and alpha change.

| Layer | Position | Light | Dark |
|---|---|---|---|
| teal | `60% 50% at 8% 6%` (top-left) | `#00b8a0` at .34 | `#2fd9c1` at .26 |
| periwinkle | `55% 55% at 94% 22%` (right) | `#3d7bff` at .24 | `#3d7bff` at .22 |
| aqua | `70% 55% at 55% 104%` (bottom) | `#34e0c8` at .32 | `#34e0c8` at .22 |
| amber | `40% 40% at 98% 98%` (corner) | `#f5b544` at .08 | `#f5b544` at .06 |

Each layer fades to the same colour at alpha 0 by 70 % (aqua 72 %) of its radii. The animated variant (`.cg-aurora--live`)
moves `transform` on ONE pseudo-element in a 72 s ping-pong loop, holds `will-change: transform` only while that runs, is
paused while the tab is hidden or the window has lost focus (`.cg-paused`, set by `ClarivaAurora`) and is disabled under
`prefers-reduced-motion`. It may only be used where section 3, rule 6 allows it. The test rasterises these gradients into a
sweep of the whole box (a grid of 3,321 points plus each layer's peak and centre) and measures every text colour on every
material over every one of those points.

### Shape, z-scale, blur

* Radii, **concentric rule:** inner radius = outer radius - padding (a 22px card with 10px padding holds 12px children).
* Space: Compound `--cpd-space-*` (4px grid); section rhythm 16 / 24 / 32.
* z-scale: local stacking only (upstream dialogs 4000+, context menus 5000+, toasts 101 keep their own).
* Blur and saturation are the numbers of the three glass recipes (section 3).

| Token | Value | Role |
|---|---|---|
| `--cg-r-xs` | `8px` | radius |
| `--cg-r-sm` | `12px` | radius |
| `--cg-r-md` | `16px` | radius |
| `--cg-r-lg` | `22px` | radius |
| `--cg-r-xl` | `28px` | radius |
| `--cg-r-pill` | `999px` | radius |
| `--cg-z-content` | `0` | content |
| `--cg-z-chrome` | `10` | sticky chrome |
| `--cg-z-float` | `20` | floating bars |
| `--cg-z-menu` | `40` | menus |
| `--cg-z-dialog` | `60` | dialogs |
| `--cg-z-toast` | `80` | toasts |
| `--cg-blur-thin` | `14px` | backdrop blur of thin |
| `--cg-blur-regular` | `24px` | backdrop blur of regular |
| `--cg-blur-thick` | `36px` | backdrop blur of thick |
| `--cg-blur-scrim` | `6px` | blur of the modal scrim only |
| `--cg-sat-thin` | `170%` | saturation boost of thin |
| `--cg-sat-regular` | `180%` | saturation boost of regular |
| `--cg-sat-thick` | `190%` | saturation boost of thick |

### Type

* **UI face: Inter** (already shipped by Element; keep it; it matches Android): `--cg-font-ui`.
* **Display face: Fraunces** (variable, self-hosted Latin subset of 117.96 KiB, `opsz` + `wght` + `SOFT` axes,
  `res/fonts/clariva/`) for the *few* big moments: screen titles ("Chats"), the wallet balance numerals, greeting on Home,
  call-ring caller name, sign-in headline, empty-state titles. Never for body, buttons, labels or list rows. Use the
  `cg-display` mixin at **28px and up** (weight 560, `font-variation-settings: "SOFT" 100`, `font-optical-sizing: auto`,
  tracking `-0.02em`); for display text **below 28px** use `cg-display-sm` (the same face with tracking 0: the tight
  tracking is tuned for large sizes). **`"opsz" auto` is not valid inside `font-variation-settings`**: the optical size
  comes from `font-optical-sizing: auto`.
* **Numerals.** The Latin subset has no `tnum`, `lnum` or `pnum` feature (its GSUB lists only `liga` and `rvrn`, its GPOS
  only `kern`), so `font-variant-numeric` does nothing in Fraunces: **Fraunces numerals are proportional**. That is fine
  for a hero balance (large, nothing sits to its right: use `cg-display` alone). Any column or list of amounts (history
  rows, rate chips, the coin chip) must use `cg-numerals`, which switches to the UI face (Inter has `tnum`) with
  `font-variant-numeric: tabular-nums lining-nums`. Never put both mixins on one element: the later `font-family` wins.
* **Swap shift.** `--cg-font-display` is `"Fraunces", "Fraunces Fallback", Georgia, serif`. "Fraunces Fallback" is the
  user's local Georgia scaled to Fraunces' metrics (`size-adjust: 107%`, `ascent-override: 91.4%`,
  `descent-override: 23.8%`, `line-gap-override: 0%`: Fraunces' hhea ascent 1956 / descent 510 / line gap 0 over 2000
  units, divided by 1.07), so the font swap does not reflow the headline. Display text at weight 560 is 105.5-107.5 % as
  wide as Georgia (read from the shipped file's hmtx + HVAR), so 107 % is approximate; only Georgia is matched (Linux and
  Android fall through to `serif`). The woff2 is preloaded in the page head by webpack (`HtmlWebpackInjectPreload`).
* Type scale (rem, so it follows the user's font-size setting) and font stacks:

| Token | Value | Role |
|---|---|---|
| `--cg-fs-xs` | `.75rem` | 12px |
| `--cg-fs-sm` | `.8125rem` | 13px |
| `--cg-fs-md` | `.9375rem` | 15px |
| `--cg-fs-lg` | `1.0625rem` | 17px |
| `--cg-fs-xl` | `1.25rem` | 20px |
| `--cg-fs-2xl` | `1.75rem` | 28px |
| `--cg-fs-3xl` | `2.25rem` | 36px |
| `--cg-fs-4xl` | `3rem` | 48px |
| `--cg-font-display` | `"Fraunces", "Fraunces Fallback", Georgia, serif` | display stack (`_fonts.pcss`) |
| `--cg-font-ui` | `$font-family` | the existing Inter stack (a build-time variable, `_fonts.pcss`) |
| `--cg-display-weight` | `560` | display weight |
| `--cg-display-soft` | `100` | the SOFT axis |
| `--cg-display-tracking` | `-0.02em` | display tracking, `cg-display` only (28px and up; `cg-display-sm` uses 0) |

* Keep line lengths < 75 characters; body line-height 1.45-1.5; headings 1.05-1.15.

## 3. Materials (liquid glass, done honestly)

Real glass = heavy blur + saturation boost + specular top edge + a colourful backdrop to refract.

| Material | Use | Light fill / dark fill | Blur | Saturate | Shadow | Notes |
|---|---|---|---|---|---|---|
| `glass-thin` | chips, pills, small controls over the wallpaper or the pane wash (never over scrolling content) | `rgba(255,255,255,.58)` / `rgba(12,32,48,.46)` | 14px | 170% | `--cg-e1` | |
| `glass-regular` | list pane (over the wallpaper only: nothing scrolls under it); never a floating bar | `.66` / `.52` | 24px | 180% | `--cg-e2` | rule 7 |
| `glass-thick` | dialogs, sheets, menus, call sheet, and ALL floating chrome that content scrolls under (room header, composer, tab bar, scroll-to-latest pill) | `.80` / `.70` | 36px | 190% | `--cg-e3` | rule 7 |
| `glass-tint` | outgoing bubbles, primary/accept | teal gradient `.82` / `.84` + highlight | none | - | `--cg-e1` | text is `--cg-on-tint`, AA |
| `inset` | tiles ON glass | `rgba(255,255,255,.45)` / `rgba(255,255,255,.06)` | **none** | - | hairline only | the nested-blur rule |

Every material also paints the specular edge: a 1px hairline (`--cg-line`) plus a 1px highlight on the top edge
(`--cg-highlight`), both as inset box-shadows, so a material never changes the layout of its element.

The glass model the tests use is what the browser paints: the content behind the element, blurred, run through
`saturate()` (the `--cg-sat-*` boost), THEN the translucent fill over it.

Derived tokens (declared on `body` in `_glass.pcss`; the fallbacks re-point exactly these): `--cg-surface-thin`,
`--cg-surface-regular`, `--cg-surface-thick`, `--cg-surface-tint`, `--cg-surface-inset`, `--cg-surface-pane`,
`--cg-backdrop-thin`, `--cg-backdrop-regular`, `--cg-backdrop-thick`, `--cg-backdrop-scrim`, `--cg-edge`, `--cg-edge-flat`,
`--cg-edge-tint`. A surface never reads `--cg-fill-*` or a literal `blur()` directly (the test enforces it), or it would
bypass the fallbacks.

Hard rules:
1. **Never nest `backdrop-filter`.** A glass panel frosts the background once; everything inside it uses `inset` tints.
2. **Bubbles and list rows have NO `backdrop-filter`** (there can be hundreds). They get translucent fills + a 1px
   specular inset edge; the wallpaper behind the timeline is smooth, so blur adds nothing.
3. **Budget:** at most ~6 `backdrop-filter` elements visible at once (header, list pane, composer, tab bar, one overlay,
   one toast). Large animated layers must not sit under a `backdrop-filter` element in chat rooms.
4. **Text on glass must pass AA against the worst-case backdrop**: every point of the wallpaper (a full sweep, not a few
   samples) after the material's `saturate()` boost, not the flat page colour. `designTokens-test.ts` composites every
   fill over those points for `--cg-text`, `--cg-text-2`, `--cg-text-3`, coral-text, teal-text, amber-text (also on the
   amber wash and on an inset tile), the tint and the focus ring, and fails when the "Text colour by surface" table in
   section 2 goes stale.
5. Popovers/menus/dialogs render at the app root (Element already does via `ContextualMenu`/`Modal`); glass ancestors trap
   `z-index`, so do not move them.
6. **No animated layer under a `backdrop-filter`.** The browser re-blurs a backdrop-filter element on every frame in which
   anything behind it changes, so a drifting layer under a panel re-blurs it 60 times a second. Nothing with
   `backdrop-filter` may overlap an animated layer. The live aurora (`.cg-aurora--live`) is allowed in exactly two
   places: (a) the sign-in page, behind ONE glass card, and (b) the Home dashboard, ONLY as a decorative glow behind the
   greeting area that no glass card overlaps. Everywhere else the wallpaper is the static one on `<body>`. A live aurora
   also pauses while the tab is hidden or the window has lost focus, and holds `will-change` only while it runs.
7. **Floating chrome sits over arbitrary content, not just the aurora.** The room header, the composer, the tab bar and the
   scroll-to-latest pill have photos, videos, bubbles and white documents scrolling under them, so the backdrop can be
   pure white or pure black. Glass that content can scroll under MUST be `cg-glass-thick` (there is no veiled-regular
   exception: a regular fill would need a solid veil of at least 70 % under the text, the pane wash is far lighter), and it may carry ONLY `--cg-text` for
   essential text (never `--cg-text-2`, `--cg-text-3` or `--cg-coral-text`). Measured: `--cg-text` on thick glass is 10.3:1
   over pure black content (light theme) and 5.6:1 over pure white (dark theme), and 4.5:1 or more over saturated colours;
   bare regular glass falls to 3.1:1 over white in the dark theme and thin glass to 2.6:1, which is why the rule exists
   (`--cg-fill-thick` needed no nudge). `designTokens-test.ts` records these numbers and scans the surface partials for a
   floating-chrome selector on bare thin / regular glass.
8. **Fallbacks are part of the design, not an afterthought, and live in ONE place (`_glass.pcss` section 2):**
   `@supports not` (no `backdrop-filter`, prefixed form counted as support), `@media (prefers-reduced-transparency: reduce)`,
   `@media (prefers-contrast: more)` and the in-app High contrast themes (`body.cpd-theme-light-hc` /
   `cpd-theme-dark-hc`: classes, not media queries, so they have their own rule at a higher specificity) switch every
   material to an opaque `--cg-solid-*` surface with a visible 1px border (`--cg-line-strong`, an inset ring: no layout
   shift). The High contrast theme also drops the wallpaper painted on `<body>`; it and the two media queries flatten the
   `.cg-aurora` layer (`background-image: none`, no drift). `@media (forced-colors: active)` gets system colours (`Canvas`,
   `ButtonFace`), hides the `.cg-aurora` layer, gives `.cg-skeleton` a `1px solid CanvasText` outline and draws every
   material's edge as a real `1px solid CanvasText` outline, because box-shadow is not painted there. A surface that uses a
   mixin or a `.cg-*` class inherits all of it; it must not repeat these media queries, and it must not write
   `backdrop-filter`, `blur()`, `--cg-fill-*` or `--cg-solid-*` by hand (the test scans every partial and lists the only
   exception).

## 4. Layout

Desktop (>= 1024): glass **space rail** (72px) | glass **list pane** (~360px) | **room** (the aurora shows through the
timeline; header and composer float as glass). Tablet (768-1023): rail collapses to icons, list pane 320px. Phone
(< 768): single-pane master/detail (already built) + a **floating glass tab bar** (Chats / Wallet / Me) on the list screen
only, hidden inside a room. Safe-area insets respected everywhere (`env(safe-area-inset-*)`); content never hides under
floating bars (reserve padding). Min touch target 44px, 8px between targets.

## 5. Motion (apply the `animate` build order for every animation)

1. **Frequency decides.** 100+/day (keyboard shortcuts, room switching, list navigation, opening the composer): **no
   motion**. Tens/day (hover, new live message, typing dots): <= 160 ms, nearly invisible. Occasional (dialogs, toasts,
   sheets): 200-380 ms. Rare (sign-in, first recharge success, empty-state first view): allowed delight.
2. **Purpose** must be nameable: feedback, spatial continuity, state indication, preventing a jarring change.
3. **Tokens** (`_motion.pcss`, on `:root[data-clariva]`): `--cg-ease-out: cubic-bezier(.23,1,.32,1)`,
   `--cg-ease-in-out: cubic-bezier(.77,0,.175,1)`, `--cg-ease-drawer: cubic-bezier(.32,.72,0,1)`, spring
   `--cg-spring: linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%,
   1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%,
   0.997 69.8%, 1.003 76.9%, 1)` (it is `var(--cg-ease-out)` until `@supports (transition-timing-function: linear(0, 1))`
   upgrades it); durations `--cg-dur-press` 120ms, `--cg-dur-hover` 160ms, `--cg-dur-small` 180ms, `--cg-dur-medium` 240ms,
   `--cg-dur-sheet` 380ms; exits `--cg-dur-exit-small` 120ms, `--cg-dur-exit-medium` 160ms, `--cg-dur-exit-sheet` 250ms
   (~65 % of the enter duration). Press/enter helpers read `--cg-press-scale` (.97), `--cg-press-opacity` (1),
   `--cg-enter-from` / `--cg-exit-to` (`translate3d(0, 6px, 0) scale(.96)` / `translate3d(0, 4px, 0) scale(.96)`) and
   `--cg-lift` (`translate3d(0, -2px, 0)`), which is what lets reduced motion switch movement off in one block.
   **Never `ease-in` on UI. Never `transition: all`. Never `scale(0)`** (start at .94-.97 + opacity).
   **`cg-press`, `cg-hover-lift` and `cg-pressable` set the whole `transition` shorthand, so they CLOBBER any
   `transition:` the surface declared earlier in the rule** (and a second of the three clobbers the first: use
   `cg-pressable` for press + lift). To keep a surface's own transitions, list them in `--cg-transition-extra` on the same
   element (default `color 0s`, appended LAST to the list, inherited like any custom property):
   `--cg-transition-extra: background-color var(--cg-dur-hover) var(--cg-ease-out);`.
   `cg-enter` fills `backwards`, never `both` / `forwards` (a filled-forwards animation would freeze `transform` and
   `opacity` against press and hover on the same element); `cg-exit` keeps `both` because the element is leaving.
4. Animate `transform` and `opacity` only (+ `clip-path` for reveals, + `height` for accordions). Press feedback:
   `:active { transform: scale(.97) }` on every pressable. Popovers originate from their trigger (`transform-origin`);
   dialogs stay centred. Hover motion is gated by `@media (hover:hover) and (pointer:fine)`.
5. Dialogs/menus/toasts use CSS transitions (interruptible), not keyframes. Springs (`--cg-spring`) only for momentum
   and delight: sheet settle, tab-bar indicator, wallet coin glint, ring avatar pulse.
6. Stagger lists only on first reveal of an occasional screen (30-50 ms steps, max 6 items), never on lists the user
   scrolls daily.
7. Everything respects `prefers-reduced-motion` and never blocks input. **Reduced motion is instant; movement tokens are
   also neutralised at the source.** `_a11y.pcss` (imported last) makes every transition and finite animation in the
   Clariva UI zero-length (`!important`), so there is no cross-fade left. `_motion.pcss` has ONE reduced-motion block that
   also sets the movement tokens to `none` / `1` (so presence, press and lift lose their translate and scale even where
   the blanket does not reach) and stops the pulse, the aurora drift (releasing its `will-change`) and the coin glint.

## 6. Surfaces and widgets (what gets built)

**Floating chrome rule (section 3, rule 7).** The room header, the composer, the tab bar and the scroll-to-latest pill float
over scrolling content, so each is `cg-glass-thick` and
carries ONLY `--cg-text` for essential text. **Animated layer rule (rule 6).** Nothing blurred may overlap the live aurora.

**Shell / Chats (agent S1)**
* Glass space rail and list pane over the aurora; large Fraunces title "Chats" that collapses into the header on scroll
  (opacity + translate only); the wallet chip becomes the **coin chip** (amber coin glyph with a specular glint,
  tabular numerals, glass-thin).
* Search pill (glass-thin) with the `Ctrl K` hint; filter chips with a sliding glass indicator (transform only).
* **Room tile** redesign: 52px avatar with **presence ring** (teal when online), name (15/600), preview (13, text-2), time +
  unread badge (teal glass), credits label as a quiet amber-tinted tag; hover = inset lift; selected = thick teal-edge glass.
* **Skeleton rows** (shimmer-free: soft opacity pulse 1.2 s) while the first sync loads; **empty state** with an SVG
  glass-bubble illustration + one primary action.
* **Home dashboard** (desktop right pane when no room is open; replaces the logo + two buttons): the live aurora is
  allowed here ONLY as a decorative glow behind the greeting that no glass card overlaps (rule 6: the WalletCard and the
  rail below it are glass and must sit outside that layer, on the static wallpaper). Fraunces greeting
  ("Good evening, Asha"), **WalletCard** (glass-thick lens: the hero balance in Fraunces, whose numerals are proportional
  and fine at that size, with any column of amounts in `cg-numerals`; "Add credits" primary pill, last recharge line;
  role-aware: consultants see pending-refund count instead of Add credits), **ConsultantsRail**
  (recent DMs as avatar + name + rate chips, horizontally scrollable, click opens the chat), **QuickActions** (Start a chat,
  My QR code, Scan QR). Data comes from existing stores (`WalletStore`, room list); no new API calls.
* **Floating glass tab bar** on phones (Chats / Wallet / Me): `cg-glass-thick` (floating chrome, rule 7), 3 items, icon +
  label, active indicator slides with the spring; Wallet opens the Wallet tab, Me opens settings (reuse the existing
  dispatcher actions).

**Room (agent S2)**
* Floating **glass header** (avatar + presence, name, role badge for consultants, call buttons already present) and
  **floating glass composer** (pill, attach, emoji, send that morphs mic->send with a 160 ms cross-fade and
  `scale(.97)` press, never animates on keyboard send). Both are `cg-glass-thick` (rule 7), `--cg-text` only.
* **Bubbles** as glass drops: incoming = white-ish translucent (no blur) with specular edge, outgoing = teal tint (AA text),
  grouped corners (tail on the last bubble of a group, 6px inner corners inside a group), 16-22px radii, timestamp inside
  the bubble bottom-right (already), delivered/read ticks as inline SVG. Reactions as inset pills (no blur: there can be
  many; section 3, rules 1-3). Reply quote with a teal rail. Link preview + image/file cards as inset tiles.
  **New live message**: 140 ms `translateY(6px)->0` + fade, only when it arrives live (not on history load, not on room
  switch).
* **DmIntroCard** (replaces the "beginning of your direct message history" block in 1:1 chats): large avatar with ring,
  name (Fraunces), role badge, **rate chip** (amber: "100 credits / 24 h") for consultants, short privacy line
  ("Private and end-to-end encrypted"), buttons "Voice" and "Video" (existing call actions), all inside one glass-thick lens.
* **Date chips** (inset pills that scroll with the timeline; a sticky one is floating chrome: `cg-glass-thick`),
  **system events** as quiet centred text (done), **typing indicator** (three dots, 1 s opacity/translate loop, inset pill),
  **scroll-to-latest pill** (`cg-glass-thick` with unread count, slides in 180 ms; floating chrome, rule 7), unread divider
  as a teal hairline with a small label.

**Overlays, forms, wallet, auth (agent S3)**
* All dialogs: glass-thick on a blurred scrim (`backdrop-filter: blur(6px)` on the scrim only, scrim alpha from the token),
  22-28px radius, 220 ms scale(.96)+fade in, 140 ms out; settings dialog with a glass sidebar; context menus / popovers /
  tooltips glass-thick with origin-aware scale; toasts glass-thick stacked top-left with the existing priority logic.
* **Wallet tab + recharge dialog + history**: WalletCard reused (same component family as Home), amount chips as glass
  inset tiles with a selected teal-edge state, history rows with amber/teal amount colouring plus +/- signs (not colour
  alone), skeleton while loading, success state with the one allowed delight (coin glint + check).
* **Sign-in / sign-up / forgot / role dialogs:** the signature page. Live aurora behind ONE glass card (rule 6), logo tile
  surfacing (opacity+blur 8px->0, scale .94->1, 500 ms once), glass-thick auth card, Fraunces headline, Google button
  block (keep the existing notice / retry behaviour untouched), primary pill = Ink Navy with a teal glint.
* QR / refund / pills: restyle with the same materials; no behavioural change.

**Calls (agent S4)**
* Ring toast = glass-thick sheet: caller avatar with two expanding teal rings (transform/opacity, 2 s loop, paused under
  reduced motion), name in Fraunces, "Incoming voice/video call", Accept (Deep Teal glass, white text) and Reject (Coral
  glass) as 48px pills; keep the sound hint, focus and accessible names exactly as today.
* "Call started" tile and Join, header Join/Start buttons, call view chrome around the Element Call iframe (rounded 22px
  frame, glass title strip with the peer name + live duration if already available), minimised/PiP frame. The iframe itself
  is Element Call's own UI and is not restyled.

## 7. Copy

Plain verbs, sentence case, specific labels. Credits are "credits". Errors say what happened and what to do. Empty
states invite an action. No "Oops", no exclamation marks, no emoji as icons. Reuse existing string tables (`authStrings`,
`callsStrings`, `walletStrings`, ...); new strings go in the same files with the same tone.

## 8. Behaviour guardrails

No functional change is acceptable. Everything is flag-free CSS/markup polish except the new widgets, which are additive
components rendered only when `isClarivaEnabled()`; upstream files get minimal `// CLARIVA:` guarded edits. Keep every
existing `data-testid`, class hook used by tests, `aria-*` and keyboard path. Android-parity behaviours (role logic,
gating, billing) are untouched.

## 9. Accessibility and performance guardrails (CRITICAL, from ui-ux-pro-max)

* Contrast: text >= 4.5:1, large text/UI glyphs >= 3:1, measured against the composited worst case behind the material:
  every wallpaper point after the material's `saturate()` boost, and for floating chrome the extremes of arbitrary
  content (pure white, pure black, saturated colours; rule 7). `text-3` may only be used for non-essential text, never on
  the amber wash; the accent texts are for glass, inset tiles and solids, never the bare wallpaper.
* Focus: visible 2px ring on every interactive element, offset 2px, colour with >= 3:1 against its surroundings in both
  themes (`--cg-focus`: Deep Teal `#00806e` in light, Teal `#2fd9c1` in dark; the 2px offset keeps the ring off the element,
  so no separate inner gap token is needed; measured 3:1 or more on every glass fill over the worst aurora point, on the
  bare wallpaper and on the opaque fallbacks). `_a11y.pcss` re-points Compound's `--cpd-color-border-focused` to it for the
  normal themes, so Compound components and every older partial follow; the `-hc` themes keep Compound's colour. Inside a
  `cg-glass-tint` scope the ring is `--cg-focus-on-tint` (the plain ring is 1.86:1 on the light tint).
* Targets >= 44px; no hover-only affordances; `touch-action: manipulation` on pressables.
* `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast`, `forced-colors`, `no backdrop-filter`:
  all handled by the token layer so surface code does not repeat them.
* Dark mode is designed together with light (not inverted); test both.
* Performance: no animated `backdrop-filter`; no animated layer under a `backdrop-filter` (rule 6); no `filter: blur` on
  animated layers; <= ~6 live backdrop filters; images keep intrinsic sizes (no layout shift); fonts `font-display: swap`
  with a metrics-matched fallback and a preload, Fraunces subset < 120 KiB (117.96 KiB); animations on the compositor
  (`transform`/`opacity`) with `will-change` only while animating; a live aurora pauses when the tab is hidden or the
  window loses focus.
* Layout: 375, 390, 768, 1280 widths; no horizontal scroll; safe areas; content padded for floating bars.

## 10. Verification (`webapp-testing`)

Per surface: light + dark x 1280 / 768 / 390 screenshots; keyboard path (Tab order, focus ring visible on glass);
reduced-motion and reduced-transparency emulation; console free of new errors; no layout shift on first paint; the
existing jest suites and the new token/contrast tests pass; before/after screenshots kept in the scratchpad.

## 11. Foundation API (what surface agents code against)

Import order is fixed in `res/css/clariva/_clariva.pcss`: `_brand` (tokens) -> `_fonts` -> `_glass` -> `_motion` -> the surface
partials -> `_a11y` (last). The mixins below are `postcss-mixins` (`@mixin name;` inside a rule, no arguments), so a surface
restyles an existing Element selector without touching markup:

```pcss
:root[data-clariva] .mx_RoomHeader {
    @mixin cg-glass-thick; /* floating chrome: content scrolls under it (rule 7) */
}
:root[data-clariva] .mx_Foo_tile {
    @mixin cg-inset;
    @mixin cg-pressable;
}
```

Most mixins have a utility class of the same name (`.cg-glass-thin`, `.cg-pressable`, `.cg-display`, ...) for new markup.
Mixin-only (no utility class): `cg-press`, `cg-hover-lift`, `cg-presence-hidden`, `cg-presence-shown`, `cg-focus-ring`, and the
internal plumbing `cg-solid-tokens`, `cg-edge-forced`, `cg-aurora-off`. A mixin sets the material's background, backdrop,
shadow and edge; it does not set `color` (except `cg-glass-tint`), radius, padding or `position`. Order inside a rule:
material first, then the surface's own overrides.

### Materials (`_glass.pcss`)

| Mixin / class | Use |
|---|---|
| `cg-glass-thin` | chips, pills, small controls over the wallpaper or the pane wash, never over scrolling content (blur 14, shadow `--cg-e1`) |
| `cg-glass-regular` | list pane (blur 24, `--cg-e2`); never a floating bar (rule 7) |
| `cg-glass-thick` | dialogs, sheets, menus, call sheet AND all floating chrome that content scrolls under: room header, composer, tab bar, scroll-to-latest pill (blur 36, `--cg-e3`; rule 7) |
| `cg-glass-tint` | outgoing bubbles, primary / accept: teal gradient, NO blur, sets `color: var(--cg-on-tint)` and re-points the focus ring to `--cg-focus-on-tint` for the element and its descendants |
| `cg-inset` | a tile ON glass: translucent tint + hairline, NO blur |
| `cg-scrim` | modal scrim: `--cg-scrim` alpha + 6px blur of the page behind it |
| `cg-focus-ring` | `&:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }` (use `-2px` offset in clipped rows) |
| `.cg-aurora` | the wallpaper as a layer filling its positioned parent, behind the parent's content (z-index -1: the parent needs `isolation: isolate`) |
| `.cg-aurora--live` | + a slow drift of one pseudo-element, ONLY on the sign-in page (behind one glass card) and as the Home greeting glow no glass card overlaps (rule 6); `.cg-paused` stops it (hidden tab or blurred window) |

Text colours on any of them: see "Text colour by surface" in section 2 (never Compound's `text-secondary` on glass; on
floating chrome `--cg-text` only). Money is `--cg-amber` family only. Errors are `--cg-coral-text`, links and accent labels
`--cg-teal-text`.

### Motion (`_motion.pcss`)

| Mixin / class | Use |
|---|---|
| `cg-press` | 120ms `scale(.97)` on `:active`, `touch-action: manipulation`, no tap flash |
| `cg-hover-lift` | `translateY(-2px)` on hover, only under `(hover: hover) and (pointer: fine)` |
| `cg-pressable` | both on one element (they would overwrite each other's `transition`) |

**These three set the whole `transition` shorthand and CLOBBER a `transition:` the surface wrote earlier in the same
rule.** Do not write `transition:` next to them; list the surface's own transitions in `--cg-transition-extra` on the
same element (it is appended last, default `color 0s`, inherited like any custom property):

```pcss
:root[data-clariva] .mx_Foo_tile {
    @mixin cg-pressable;

    --cg-transition-extra: background-color var(--cg-dur-hover) var(--cg-ease-out);
}
```

| Mixin / class | Use |
|---|---|
| `cg-presence-hidden` / `cg-presence-shown` | closed and open look of a menu / popover / toast: opacity + translate/scale .96, enter 240ms, exit 160ms, interruptible; set `transform-origin` to the trigger |
| `cg-enter` / `cg-exit` (+ `.cg-enter`, `.cg-exit`) | the same as keyframes, for markup that mounts / unmounts. `cg-enter` fills `backwards` (never `both`: it would freeze `transform` / `opacity` against press and hover); `cg-exit` keeps `both` |
| `cg-pulse` (+ `.cg-pulse`) | 1.2s opacity pulse for skeletons and waiting states |

### Type (`_fonts.pcss`)

| Mixin / class | Use |
|---|---|
| `cg-display` | Fraunces, weight 560, SOFT 100, tracking `-0.02em`: headings and the hero balance at **28px and up** only |
| `cg-display-sm` | the same face with tracking 0, for display text under 28px (a 20px dialog title, a 22px caller name) |
| `cg-numerals` | money in a column or list: switches to the UI face (Inter) with `tabular-nums lining-nums`, because Fraunces numerals are proportional; do not combine it with `cg-display` on one element |

Classes `.cg-display`, `.cg-display-sm`, `.cg-numerals`. `--cg-font-ui` is the Inter stack.

### React primitives (`src/clariva/ui`, import from `../ui`)

* `ClarivaAurora({ live?, className? })`: the wallpaper layer; a live one (rule 6 says where) pauses while the tab is hidden or the window has lost focus (`visibilitychange`, window `blur` / `focus`); reduced motion is CSS only.
* `CoinIcon({ size = 20, glint?, title?, className? })`: the credits coin (amber face, currentColor rim and "C"); `glint` plays one sweep.
* `Skeleton({ width?, height?, radius?, className? })`: a pulsing placeholder block; `radius` is a scale token (`"pill"`) or any CSS length.

### What the foundation changed visibly (everything else is for the surface agents)

* `<body>` paints the aurora (static) over `--cg-bg` for every Clariva session, except under the in-app High contrast
  themes and forced colours.
* The pane right of the list (`.mx_RoomView_wrapper`: a room, the Home pane) shows the aurora through `--cg-pane-wash` (a
  veil of `--cg-pane-wash-alpha`, 35 %) instead of the opaque canvas; with reduced transparency / more contrast / no
  backdrop-filter / forced colours / a High contrast theme it is the stock canvas again. To show more aurora, lower the
  alpha in `_brand.pcss`; it is the only place.
* The display face is preloaded in the page head, and its local fallback keeps the swap from shifting the layout.
* Focus rings are `--cg-focus` everywhere (Compound's `--cpd-color-border-focused` is re-pointed).
* (Foundation pass only; the surface pass has since restyled all of these, section 12.) NOT touched: `.mx_LeftPanel*`, `.mx_SpacePanel`, the room header, the composer, the chats header, dialogs, auth. Clariva's
  own partials paint those with the Compound canvas at a higher specificity; the agent that restyles each one replaces that
  background with a material.

## 12. Implemented surfaces (surface pass, 2026-10-16)

The four surface passes are in and integrated. This section says what exists, where, and which material each piece uses, so
the next change starts from the build and not from the plan in sections 4-6. Browser verification of the surface pass is
the lead's screenshot round; until it is done, treat the visual details below as "written, unit-tested, not yet seen".
`test/clariva/surfaceIntegration-test.ts` guards the seams BETWEEN the partials (the per-surface suites guard each partial).

### Where things live

| Surface | CSS (`res/css/clariva/`) | Components (`src/clariva/components/`) | Upstream edits (`// CLARIVA:`) |
|---|---|---|---|
| Shell, Chats list, Home, phone tab bar | `_chats.pcss`, `_responsive.pcss` | `shell/*`, `chats/*`, `home/*` | `HomePage.tsx`, `LoggedInView.tsx`, `LeftPanel.tsx`, `LandmarkNavigation.ts` |
| Chat room | `_chatroom.pcss`, `_chat.pcss` | `room/*`, `chat/*` | `RoomHeader`, `NewRoomIntro`, `MessageComposer`, `EventTile`, `JumpToBottomButton`, `DateSeparator`, `WhoIsTypingTile`, `MessagePanel` |
| Dialogs, menus, tooltips, toasts, settings, wallet, sign-in, QR, refund dialog | `_dialogs.pcss`, `_auth.pcss`, `_wallet.pcss`, `_qr.pcss` | `auth/*`, `wallet/*`, `qr/*`, `refund/*` | none |
| Calls | `_calls.pcss` | `calls/*` | `CallView.tsx` (title strip), `calls/runtime.ts` (two toast class names) |

### Material per piece (what blurs, and what must not)

| Piece | Material | Notes |
|---|---|---|
| Space rail, Chats list pane | `cg-glass-regular` | on a phone the list pane is the pane wash (no blur): the tab bar floats over it |
| Search pill, coin chip, "+", filter chips, chat rows, badges | `cg-inset` / `cg-glass-tint` | inside the glass pane: rule 1, so the brief's glass-thin is an inset tile with the same edge |
| Phone tab bar, room header, composer pill, scroll-to-latest pill, sticky date chip (only the stuck one), message action bar, DM intro card | `cg-glass-thick` | floating chrome: `--cg-text` only (rule 7) |
| Home wallet card | `cg-glass-thick` | the live aurora is the hero behind the greeting only; the card is a separate block |
| Home quick tiles, call title strip | `cg-glass-thin` | on the pane wash, not over scrolling content |
| Bubbles, reactions, quotes, link preview, file tiles, "Call started" tile | `cg-inset` (incoming) / `cg-glass-tint` (outgoing) | never blurred |
| Dialogs (+ `cg-scrim`), menus, popovers, tooltips, toasts, ring toast | `cg-glass-thick` | contents are inset pills / tiles |
| Sign-in card | `cg-glass-thick` | the ONE blurred layer of the page; the drift pauses while a dialog is open |
| Refund banner (room column) | `cg-glass-regular` | in the flow under the header, nothing scrolls under it |
| Refund chat toasts | `cg-glass-thick` | overlay the timeline |

### One owner per selector (the seams)

* The refund **banner and chat toasts** are `_chat.pcss`'s (layout and material, once). The refund **pill** and the approve
  **dialog** are `_dialogs.pcss`'s. Before the integration pass both partials painted the banner (thin and regular; the later
  one won by accident).
* The header **call buttons** are `_calls.pcss`'s (they win ties over the header's own icon-button rule in `_chatroom.pcss`);
  the phone header padding and the Back arrow's size are `_responsive.pcss`'s; everything else in the header is `_chatroom.pcss`.
* Surface-local helpers that other partials import: `cg-btn-*`, `cg-field`, `cg-field-error`, `cg-error-glyph`,
  `cg-menu-item` and the tokens `--cg-hover-tint`, `--cg-press-tint`, `--cg-field-edge`, `--cg-btn-edge`, `--cg-btn-hover`
  live in `_dialogs.pcss` (imported first), `--cg-progress-track` in `_wallet.pcss`. They are requests to the foundation
  (section 12, "Open requests").
* z-order: floating bars share `--cg-z-float` (20: room header, composer, phone tab bar, start-chat button); the scroll pill
  (`--clariva-z-float`, 10) and the sticky date chip (11) sit under them; the status area (6) is lowest; chat-local toasts
  (`--clariva-z-local-toast`, 100) sit under the app's toast container (101); the phone right-panel sheet (20) is a bar level.

### Deliberate differences from sections 4-6

* The room header is **flush** with the top and sides of the pane (bottom corners 22px) instead of a floating island: messages
  scrolling past a gap above it would show. The composer is the floating pill.
* The primary pill is Ink Navy with a teal rim in light. In dark the dialogs / sign-in use a **mist** pill (navy would vanish
  on dark glass) while the Home and empty-state CTA keep navy with a 1px teal ring: one of them should win (open decision).
* The Home wallet card has **no "last recharge" line** (the store has no such data and no new request is allowed). The call
  title strip has no duration (no call clock in host state); the minimised call card has no peer avatar or mute dot.
* Dialogs, menus and toasts **enter** with a CSS transition from `@starting-style`; they have **no exit** animation because
  `Modal` / `ContextualMenu` / `ToastContainer` unmount at once (open request). Tooltips scale from the centre, not the trigger.
* The Chats filter chips slide by FLIP of the teal drop; the selected chips jump to the front of the row.
* Own messages never play the live-message entrance (their tile mounts twice when the server confirms the send).
* The link preview is 12px (concentric inside the 20px bubble), not 16px.

### Open requests (not done by design: they are foundation or upstream changes)

1. `Modal.tsx` / `ContextualMenu` / `ToastContainer`: a guarded `// CLARIVA:` delayed unmount (about 140 ms dialogs, 120 ms
   menus) plus a closing class, so the exit animations of section 5 can exist.
2. Promote the surface-local tokens and mixins above to `_brand.pcss` / `_glass.pcss` / `_motion.pcss`.
3. Decide the dark-theme primary pill (above).
