# Theme System

kubelens used to ship six themes and a color-dot switcher. It now ships one: **Nord** (theme id `el-nath`). This is how the single theme is wired, and what's left of the old switching machinery.

---

## Why one theme

The multi-theme system worked by layering. `:root` held a default, and each extra theme was a `[data-theme="..."]` block that overrode every token. A `ThemeService` flipped the `data-theme` attribute on `<html>`, CSS specificity did the rest.

That flexibility wasn't earning its keep. Six palettes meant six sets of tokens to keep in sync, and the app only ever looked right in one of them. So the `[data-theme]` blocks were deleted and Nord was folded straight into `:root`. One palette, one block, no CSS switching left.

## 1. Tokens live in `:root`

`src/styles.scss:11-70` defines every design token as a CSS custom property, all in one `:root` block, about 50 in total:

```scss
:root {
  --t-accent: #88c0d0;          // Nord frost blue
  --t-bg-body: #2e3440;         // Nord polar night
  --t-text-primary: #eceff4;    // Nord snow storm
  // ... colors, radii, shadows, graph, kind colors
}
```

This is the only `:root` in `src/`, and no `[data-theme]` block exists anywhere in the styles. Change a value here and the whole app follows.

## 2. Components consume tokens

Every component uses `var(--t-*)` instead of hardcoded colors:

```scss
body { background: var(--t-bg-body); color: var(--t-text-primary); }   // styles.scss:82
.terminal-output { background: var(--t-bg-terminal); }                 // styles.scss:160
.mutation-snackbar { background: var(--t-bg-panel); }                  // styles.scss:215
```

Nothing reads a literal hex. That rule is what made the old switcher possible, and it's still the rule — it's what makes one palette easy to retune.

## 3. The graph is the one place CSS can't reach

Graph dots aren't CSS. They're WebGL pixels rendered by `@cosmograph/cosmos` on a `<canvas>`, so `var(--t-*)` doesn't apply to them directly.

The bridge: six category-level kind colors are declared as tokens in `:root` (`styles.scss:50-57`):

```scss
:root {
  --t-kind-namespace: #a3be8c;  // Nord green
  --t-kind-workload:  #81a1c1;  // Nord blue
  --t-kind-network:   #88c0d0;  // Nord frost
  --t-kind-config:    #8a93a3;  // muted slate
  --t-kind-storage:   #d08770;  // Nord orange
  --t-kind-rbac:      #b48ead;  // Nord purple
}
```

At graph-init time, `getCssVar()` reads a token's computed value off `document.documentElement` (`graph.models.ts:41-43`). On top of it, `getThemedKindColors()` (`graph.models.ts:46-84`) derives the individual kind colors by shifting brightness:

```typescript
const wk = getCssVar('--t-kind-workload');     // '#81a1c1'
return {
  Deployment: wk,                              // base
  StatefulSet: shiftBrightness(wk, 1.1),       // 10% brighter
  DaemonSet: shiftBrightness(wk, 0.85),        // 15% darker
  // ...
};
```

`GraphLayoutService.initializeGraph` feeds that map to Cosmos's `nodeColor` / `linkColor` callbacks (`graph-layout.service.ts:97-117`); the focus ring reads `--t-accent` directly (`:135`). `UniverseComponent` reads the same map for the legend, so dots and legend never drift apart. The Cosmos canvas itself is transparent (`rgba(0, 0, 0, 0)`, `graph-layout.service.ts:96`); the CSS `--t-bg-graph` shows through behind it. If a token is missing at runtime, the static `KIND_COLORS` palette (`graph.models.ts:108`) is the fallback. The benchmark page keeps its own copy of the bridge (`benchmark.component.ts:289`).

So: edit `--t-kind-workload` in `styles.scss`, and both the legend chip and the WebGL dots follow. One source, two render paths.

## 4. Legacy aliases still resolve

Older components referenced names like `--bg-primary` and `--accent-cyan`. Those still work as aliases onto the new tokens (`styles.scss:59-69`), so nothing had to be renamed:

```scss
:root {
  --bg-primary: var(--t-bg-body);
  --accent-cyan: var(--t-accent);
}
```

Anything without the `--t-` prefix is one of these aliases. Delete them only after grepping for the old names.

## 5. `ThemeService` is vestigial

`src/app/core/services/theme.service.ts` still declares all six theme ids — MapleStory towns: `default` (Henesys), `lith-harbor`, `ellinia`, `perion`, `ossyria`, `el-nath` (`theme.service.ts:3`). But `loadTheme()` hardcodes `return 'el-nath'` (`theme.service.ts:51-54`); localStorage is never read, though `STORAGE_KEY` still exists.

One behavior to know about: the service is not a pure no-op. On boot, its constructor applies the active theme (`theme.service.ts:33`), and `applyTheme()` runs `setAttribute('data-theme', 'el-nath')` on `<html>` (`theme.service.ts:43-49`). No stylesheet has a `[data-theme]` selector, so the attribute matches nothing — it's a leftover write with no reader. Every page load sets one dead attribute.

The theme-switcher component that once drove `setTheme()` is deleted; no file matching `*theme-switcher*` exists in `src/`. The service survives only because removing it means touching its injection sites.

---

## Token categories

| Prefix | Purpose | Example |
|--------|---------|---------|
| `--t-accent` | Brand/accent color | buttons, highlights, active states |
| `--t-bg-*` | Backgrounds | body, surface, panel, terminal, output, graph |
| `--t-text-*` | Text colors | primary, dim, secondary, on-accent |
| `--t-border*` | Borders | subtle borders, glowing borders |
| `--t-success/error/warning` | Status colors | badges, error messages |
| `--t-radius-*` | Border radius | sm (4px), md (8px), lg (12px) |
| `--t-shadow-*` | Box shadows | panel drop shadows |
| `--t-kind-*` | Graph node categories | the six WebGL base colors |

## Files involved

| File | Role |
|------|------|
| `src/styles.scss` | All tokens, single `:root` block (Nord) |
| `src/app/features/universe/models/graph.models.ts` | CSS-to-WebGL bridge + fallback palette |
| `src/app/features/universe/services/graph-layout.service.ts` | Feeds bridged colors to Cosmos |
| `src/app/core/services/theme.service.ts` | Vestigial: hardcodes `el-nath`, sets one dead `data-theme` attribute per load |
| Every `.component.scss` | Consumer: uses `var(--t-*)` tokens |
