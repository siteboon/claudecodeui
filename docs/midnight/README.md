# MIDNIGHT Design System — v1.1

Dark-first UI system. Warm near-black canvas, frosted glass tiles with inner light, pastel pops, Inter type.

**What's in the box**
- `midnight.css` — tokens + component classes (pure CSS, no build step)
- `tailwind.midnight.config.ts` — Tailwind colors, animations, radii, shadows
- `demo.html` — open directly in a browser for a live component gallery

---

## What's new in v1.1

- **Warmer canvas.** Default background is `#05060A` (was `#000000`). Kills banding on gradients and reads kinder against pastels. Use `.bg-pure-black` for OLED hero moments.
- **Inner light.** Every `.ds-tile`, sheet, and tab bar gets a 1px top-inner highlight. Dark glass now looks *lit*, not flat.
- **Spring motion.** Three named curves: `--midnight-ease` (entrances), `--midnight-spring` (touch feedback, lifts), `--midnight-swift` (40ms press snaps).
- **Unified press.** Every interactive primitive scales to 0.97 on `:active` — one tactile language across the app.
- **Page choreography.** `.page-enter` blurs-in a page, then its direct children stagger fade-up (60ms steps). One directed 3-beat entrance.
- **Per-screen accent.** Put `data-accent="mint"` (or any pastel) on an element — focus rings, selection highlight, input focus borders all inherit. One accent at a time = more composed screens.
- **Semantic radii.** `--r-control` (14px), `--r-card` (22px), `--r-pill` — three sizes replace the previous six.
- **Single display weight.** Inter 500 across all display sizes. Size does the work, not weight.
- **Tabular nums everywhere.** Numbers stop dancing on update.
- **Filmic noise utility.** `.bg-noise` adds a 2%-opacity SVG grain overlay. Kills banding and adds texture.
- **Unified badges.** `trend-chip` merged into `.badge` as `badge-trend-up/-down/-flat`.
- **Reduced-motion that degrades gracefully.** Motion becomes a 120ms cross-fade instead of being killed.

### Breaking changes

- `.btn-dark-pill` / `.btn-light-pill` → use `.btn .btn-pill` (swap `--pill-bg` / `--pill-fg` for variants, or add `.btn-pill-light` for the light variant).
- `.trend-chip`, `.trend-chip-up/-down/-flat` → use `.badge .badge-trend-up/-down/-flat`.
- `.spotlight-card` → removed. `.ds-tile-hover` covers the need; compose `.border-gradient` if you want the ring effect.

---

## Install

**1. Copy both files into your project:**

```
src/midnight.css
tailwind.midnight.config.ts
```

**2. Merge the Tailwind config** into your `tailwind.config.ts`:

```ts
import midnight from './tailwind.midnight.config'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      ...midnight.theme.extend,
      // your own extensions here
    },
  },
}
```

**3. Import the CSS** in your entry point (`main.tsx`, `globals.css`, etc.):

```ts
import './midnight.css'
```

**4. Add `class="dark"`** to your `<html>` element (required for `dark:` variants):

```html
<html lang="en" class="dark">
```

**5. Load the fonts.** MIDNIGHT imports Inter and Geist Mono via Google Fonts at the top of `midnight.css`. For production, self-host them for speed.

---

## Component reference

### Surfaces

| Class              | What it is                                               |
| ------------------ | -------------------------------------------------------- |
| `.ds-tile`         | Primary surface: frosted glass + inner light + edge sheen |
| `.ds-tile-hover`   | Adds lift-on-hover + press-scale (compose both)          |
| `.ds-tile-inset`   | Nested section inside a tile (no blur — avoids stacking) |
| `.ds-tile-plain`   | Solid near-black panel for forms/code                    |

Nesting rule: only one `backdrop-filter` per visual stack. Put blur on the outer `.ds-tile` and use `.ds-tile-inset` / `.ds-tile-plain` for inner sections.

### Pastel cards

`.ds-pastel` + one color modifier. Readable dark text on pastel fills.

```html
<div class="ds-pastel ds-mint p-6">
  <p>Mint-on-deep-green</p>
</div>
```

Colors: `ds-mint`, `ds-peach`, `ds-lavender`, `ds-butter`, `ds-blush`, `ds-sky`.

### Buttons

`.btn-primary` is standalone (white pill, hero CTA). Other variants compose `.btn` + a modifier. Every button presses to 0.97 scale on `:active`.

```html
<button class="btn-primary">Get started</button>
<button class="btn btn-secondary">Cancel</button>
<button class="btn btn-ghost">Dismiss</button>
<button class="btn btn-danger">Delete</button>
<button class="btn btn-pill">Follow</button>
<button class="btn btn-pill btn-pill-light">Open</button>
```

Custom pill colors — override the two vars:
```html
<button class="btn btn-pill" style="--pill-bg: var(--mint); --pill-fg: var(--mint-deep)">
  Paid
</button>
```

### Inputs

```html
<input class="ds-input" placeholder="Email" />
```

Input focus border uses the current `--midnight-accent` — set `data-accent="..."` on a parent to theme.

### Chips

```html
<button class="ds-chip">All</button>
<button class="ds-chip ds-chip-active">Inbox</button>
<span class="ds-chip ds-chip-mint">Paid</span>
```

Colors: `ds-chip-mint`, `ds-chip-peach`, `ds-chip-lavender`, `ds-chip-butter`, `ds-chip-blush`, `ds-chip-sky`.

### Segmented control

```html
<div class="ds-segment">
  <button class="ds-segment-item ds-segment-item-active">Day</button>
  <button class="ds-segment-item">Week</button>
  <button class="ds-segment-item">Month</button>
</div>
```

### Bottom tab bar (mobile)

```html
<nav class="ds-tabbar">
  <button class="ds-tabbar-item ds-tabbar-item-active">
    <span class="ds-tabbar-pill">🏠</span>
    <span class="ds-tabbar-label">Home</span>
  </button>
</nav>
```

### Bottom sheet

```html
<div class="ds-sheet-backdrop"></div>
<div class="ds-sheet">
  <div class="ds-sheet-handle"></div>
</div>
```

### Badges (status + trend)

```html
<span class="badge badge-mint">Active</span>
<span class="badge badge-blush">Failed</span>
<span class="badge badge-sky">Info</span>
<span class="badge badge-neutral">Draft</span>

<span class="badge badge-trend-up">▲ 12%</span>
<span class="badge badge-trend-down">▼ 3%</span>
<span class="badge badge-trend-flat">— 0%</span>
```

Colors: `badge-mint`, `badge-peach`, `badge-lavender`, `badge-butter`, `badge-blush`, `badge-sky`, `badge-neutral`. Trend: `badge-trend-up`, `badge-trend-down`, `badge-trend-flat`.

### Typography

| Class             | Purpose                                    |
| ----------------- | ------------------------------------------ |
| `.font-display`   | Inter medium, tight letter-spacing         |
| `.eyebrow`        | Small uppercase label above sections       |
| `.text-gradient`  | Butter-to-sky gradient text                |
| `.stat-hero`      | Big tabular number (clamp-sized, 500wt)    |
| `.date-hero`      | Display-size date (500wt, tabular)         |

All display sizes use a single weight (Inter 500). Don't add 600/700 — size does the lifting.

### Page layout

```html
<div class="page-container page-enter">
  <div class="page-header">…</div>
  <section>…</section>
  <section>…</section>
</div>
```

`.page-enter` blurs the container in (350ms), then direct children fade-up with a 60ms stagger. Drop it on a page wrapper and you get the signature MIDNIGHT entrance for free.

---

## Design tokens

All tokens are CSS custom properties declared on `:root`. Full list is in `midnight.css`. Key ones:

### Colors

| Token                      | Value                       | Use                              |
| -------------------------- | --------------------------- | -------------------------------- |
| `--midnight-bg`            | `#05060A`                   | Page canvas (warm near-black)    |
| `--midnight-bg-pure`       | `#000000`                   | OLED hero override               |
| `--midnight-bg2`           | `#070709`                   | Sheet / modal wrapper            |
| `--midnight-surface-1`     | `#0A0A0C`                   | Sheet / drawer content           |
| `--midnight-surface-2`     | `#0B0C11`                   | Dark pill button                 |
| `--midnight-surface-3`     | `#16181E`                   | Raised / popup / hover-dark      |
| `--midnight-tile`          | `rgba(255,255,255,0.04)`    | Frosted tile fill                |
| `--midnight-tile-hover`    | `rgba(255,255,255,0.07)`    | Tile hover fill                  |
| `--midnight-border`        | `rgba(255,255,255,0.08)`    | Hairline borders                 |
| `--midnight-border-bright` | `rgba(255,255,255,0.14)`    | Hover / focus border             |
| `--midnight-inner-light`   | `inset 0 1px 0 rgba(255,255,255,0.04)` | Top-inner highlight |
| `--midnight-accent`        | → `--midnight-sky`          | Per-screen accent (themeable)    |
| `--midnight-text`          | `#FFFFFF`                   | Primary text                     |
| `--midnight-text-soft`     | `#F3F4F7`                   | Softer primary for body copy     |
| `--midnight-text2`         | `rgba(255,255,255,0.60)`    | Secondary                        |
| `--midnight-text3`         | `rgba(255,255,255,0.40)`    | Tertiary / placeholder           |
| `--midnight-text4`         | `rgba(255,255,255,0.22)`    | Disabled / hint                  |
| `--midnight-text-muted`    | `#A8ACB6`                   | Neutral gray                     |

### Pastels

Each pastel has a `DEFAULT` and a `-deep` (for dark text on pastel).

| Pastel      | Default   | Deep      |
| ----------- | --------- | --------- |
| `mint`      | `#A8E6CE` | `#0F4A2E` |
| `peach`     | `#FFC5A0` | `#4A2108` |
| `lavender`  | `#C7B9F0` | `#2A1A5C` |
| `butter`    | `#F3DF93` | `#3D2E08` |
| `blush`     | `#F4B5BD` | `#511622` |
| `sky`       | `#B5D3F0` | `#0F2A4D` |

### Per-screen accent

Set `data-accent="mint"` (or any pastel name) on any element — focus rings, input focus border, and `::selection` inside that subtree inherit the color.

```html
<section data-accent="peach">
  <input class="ds-input" placeholder="Peach-themed focus" />
</section>
```

### Radii (semantic)

| Token              | Value   | Use                          |
| ------------------ | ------- | ---------------------------- |
| `--midnight-r-control` | `14px`  | buttons, inputs, chips     |
| `--midnight-r-card`    | `22px`  | tiles, sheets, panels      |
| `--midnight-r-pill`    | `9999px`| pill buttons, chips, badges|

Legacy size tokens (`-sm`, `-md`, `-lg`, `-xl`, `-2xl`) are kept for backcompat but collapse toward the semantic scale. Prefer the semantic names.

### Motion

Three curves, each with a job:

| Token                | Curve                                      | Use                               |
| -------------------- | ------------------------------------------ | --------------------------------- |
| `--midnight-ease`    | `cubic-bezier(0.16, 1, 0.3, 1)`            | Entrances, exits, layout shifts   |
| `--midnight-spring`  | `cubic-bezier(0.34, 1.56, 0.64, 1)`        | Touch feedback, hover lifts       |
| `--midnight-swift`   | `cubic-bezier(0.4, 0, 0.2, 1)`             | Short snaps (<120ms), press       |

### Safe-area

`--safe-top / -bottom / -left / -right` wrap `env(safe-area-inset-*)`. Use for iOS notches and home indicator.

---

## Tailwind animations

All declared in the config. Use as Tailwind utilities:

`animate-fade-up` · `animate-fade-in` · `animate-fade-down` · `animate-slide-in-right` · `animate-slide-in-left` · `animate-scale-in` · `animate-blur-in` · `animate-shimmer` · `animate-shimmer-sweep` · `animate-border-sheen` · `animate-pulse-glow` · `animate-float` · `animate-spin-slow` · `animate-count-up` · `animate-pulse-ring`

Manual stagger delays: `.stagger-1` through `.stagger-10` (80ms increments).

Auto-stagger via `.page-enter` (recommended): apply to a page wrapper — direct children fade-up in a 60ms ladder. No manual `.stagger-N` needed.

---

## Gotchas

**Backdrop-filter doesn't stack.** Nested `.ds-tile` inside `.ds-tile` looks muddy. Use `.ds-tile-inset` or `.ds-tile-plain` for inner sections.

**Mobile perf.** Heavy blur is expensive on low-end devices. The system already reduces blur on `max-width: 767px` for `.topbar-glass`. If you see jank, replace `.ds-tile` with a solid surface on mobile.

**Inter stylistic sets.** `font-feature-settings: 'ss01', 'cv01', 'cv02'` enables Inter's single-story `a`, alt-shape `l`, and curved-foot `i`. Remove if you don't like them.

**Tabular nums are on globally.** Set at the `html` level. If you want proportional digits in a specific element, override with `font-variant-numeric: normal`.

**`.btn` base.** All button variants except `.btn-primary` require composing `.btn` + variant. `.btn-primary` is standalone because it's pill-shaped while others are control-sized rounded-rects.

**Dark-only.** The system has no light mode. `darkMode: 'class'` in the Tailwind config is forward-compat only — you can ignore it if you never plan to add a light theme.

**Font loading.** Inter + Geist Mono come from Google Fonts via `@import`. In production, self-host (`@fontsource/inter`, etc.) to cut render-blocking.

---

## License

Use it however you want.
