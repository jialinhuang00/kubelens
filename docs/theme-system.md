# Theme System

User clicks a colored dot. The entire app changes color. Here's how it works, top to bottom.

---

## 1. The click

`ThemeSwitcherComponent` renders a button with a colored dot. User clicks, dropdown opens, picks a theme.

```
theme-switcher.component.ts
  → pick('grape-soda')
  → themeService.setTheme('grape-soda')
```

## 2. ThemeService applies it

Three things happen in `setTheme()`:

```typescript
// theme.service.ts
setTheme(id: ThemeId): void {
  this.activeTheme.set(id);              // 1. Update signal
  this.applyTheme(id);                   // 2. Set HTML attribute
  localStorage.setItem(STORAGE_KEY, id); // 3. Persist
}

private applyTheme(id: ThemeId): void {
  if (id === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
}
```

After this call, the `<html>` tag looks like:

```html
<html data-theme="grape-soda">
```

That's the only runtime action. No class toggling, no JS color swaps. One attribute change.

## 3. CSS takes over

`styles.scss` defines CSS custom properties (tokens) in two layers:

**Layer 1 — `:root` (default Soft Gold)**
```scss
:root {
  --t-accent: #e8b866;
  --t-bg-body: #0e0b08;
  --t-text-primary: #e8dcc8;
  --t-border: rgba(232, 184, 102, 0.12);
  --t-bg-graph: #0a0804;        // graph always dark
  --t-graph-text: #e8dcc8;
  // ... 30+ tokens
}
```

**Layer 2 — `[data-theme="..."]` overrides**
```scss
[data-theme="grape-soda"] {
  --t-accent: #8050e0;          // purple instead of gold
  --t-bg-body: #eae6f0;         // light purple background
  --t-text-primary: #2a1840;    // dark text for light bg
  --t-bg-graph: #0e081a;        // dark purple (graph stays dark)
  --t-graph-text: #c8b8e0;      // light purple text on dark graph
  // ... all tokens overridden
}
```

When `data-theme="grape-soda"` appears on `<html>`, CSS specificity kicks in. The `[data-theme]` selector wins over `:root`. Every `var(--t-accent)` in the entire app now resolves to `#8050e0` instead of `#e8b866`.

No JavaScript involved. Pure CSS cascade.

## 4. Components consume tokens

Every component uses `var(--t-*)` instead of hardcoded colors:

```scss
// terminal-sidebar.component.scss
.sidebar {
  background: var(--t-bg-body);
  border-right: 1px solid var(--t-border);
}
.sidebar-title {
  color: var(--t-accent);
}
```

When the theme changes, these resolve to new values instantly. No re-render needed. CSS does the work.

## 5. The graph follows the theme

The graph area uses `--t-bg-graph` — a per-theme background that matches the app's overall tone. The default (Soft Gold) is dark. Light themes get light graph backgrounds.

```
default      →  #0a0804  (warm brown-black)
bondi-blue   →  #dce8e8  (light teal)
grape-soda   →  #e0dae8  (light purple)
xp-olive     →  #e0dec8  (light olive)
xp-silver    →  #dcdee6  (light blue-grey)
```

The Cosmos WebGL canvas has `backgroundColor: 'rgba(0,0,0,0)'` — transparent. The CSS `.graph-area { background: var(--t-bg-graph) }` shows through.

Visual effects (nebula, scanlines, grid floor) use `--t-graph-effect-opacity` to fade on light themes (0.3) and stay full on dark (1). Node label text shadows swap via `--t-graph-label-shadow` — dark shadows for dark backgrounds, white shadows for light.

Graph UI elements (action buttons, zoom, keyboard hints, tooltip) use the same `var(--t-*)` tokens as the rest of the app. No special overrides needed — the graph background is the same brightness as the sidebar.

## 5b. WebGL node colors follow the theme

The graph dots aren't just CSS. They're WebGL pixels rendered by Cosmos. So CSS custom properties don't apply directly.

Instead, each theme defines 6 category-level colors as CSS tokens:

```scss
:root {
  --t-kind-namespace: #e8b866;  // gold
  --t-kind-workload: #6dca82;   // jade green
  --t-kind-network: #d0c8b8;    // warm gray
  --t-kind-config: #b8b0a0;     // beige
  --t-kind-storage: #d4956a;    // coral
  --t-kind-rbac: #c8a060;       // warm gold
}

[data-theme="grape-soda"] {
  --t-kind-namespace: #a070f0;  // bright purple
  --t-kind-workload: #c080e0;   // lavender
  --t-kind-network: #90a0d0;    // periwinkle
  --t-kind-config: #a898b8;     // mauve
  --t-kind-storage: #e09070;    // coral
  --t-kind-rbac: #d0a870;       // gold
}
```

At graph init time, `getThemedKindColors()` reads these 6 tokens via `getComputedStyle`, then generates all 22 individual kind colors by shifting brightness:

```typescript
const wk = getCssVar('--t-kind-workload');  // e.g. '#c080e0'
return {
  Deployment: wk,                           // base
  StatefulSet: shiftBrightness(wk, 1.1),    // 10% brighter
  DaemonSet: shiftBrightness(wk, 0.85),     // 15% darker
  // ...
};
```

This map is passed to Cosmos: `nodeColor: (n) => kindColors[n.data.kind]`. Same approach for edge colors.

Result: switch to Grape Soda, the dots turn purple. Switch to Bondi Blue, they turn teal. The sidebar legend reads the same map, so dots and legend always match.

## 6. Backward compatibility

Old components used variable names like `--bg-primary`, `--accent-cyan`. These still work through aliases:

```scss
:root {
  --bg-primary: var(--t-bg-body);
  --bg-secondary: var(--t-bg-surface);
  --accent-cyan: var(--t-accent);
  --text-primary: var(--t-text-primary);
  // ...
}
```

The aliases point to the new tokens. When `--t-bg-body` changes (theme switch), `--bg-primary` follows automatically.

## 7. Persistence

On app startup, `ThemeService` constructor reads from localStorage:

```typescript
constructor() {
  this.applyTheme(this.activeTheme());  // activeTheme = loadTheme()
}

private loadTheme(): ThemeId {
  return (localStorage.getItem(STORAGE_KEY) as ThemeId) || 'default';
}
```

User picks a theme once. It sticks across sessions.

---

## Data flow summary

```
User click
  → ThemeSwitcherComponent.pick('grape-soda')
  → ThemeService.setTheme('grape-soda')
  → document.documentElement.setAttribute('data-theme', 'grape-soda')
  → CSS [data-theme="grape-soda"] { --t-accent: #8050e0; ... }
  → Every var(--t-accent) in every component resolves to #8050e0
  → localStorage.setItem('kubecmds-theme', 'grape-soda')
```

## Token categories

| Prefix | Purpose | Example |
|--------|---------|---------|
| `--t-accent` | Brand/accent color | buttons, highlights, active states |
| `--t-bg-*` | Backgrounds | body, surface, panel, terminal, output, graph |
| `--t-text-*` | Text colors | primary, dim, secondary, on-accent |
| `--t-border*` | Borders | subtle borders, glowing borders |
| `--t-success/error/warning` | Status colors | success badges, error messages |
| `--t-radius-*` | Border radius | sm (4px), md (8px), lg (12px) |
| `--t-shadow-*` | Box shadows | panel drop shadows |
| `--t-gradient-*` | Gradients | header gradient, button gradient |
| `--t-graph-*` | Graph-specific (always dark) | graph bg, graph text, graph border |

## Files involved

| File | Role |
|------|------|
| `src/styles.scss` | Token definitions (`:root` + `[data-theme]` blocks) |
| `src/app/core/services/theme.service.ts` | Runtime: signal state, `data-theme` attribute, localStorage |
| `src/app/shared/components/theme-switcher/` | UI: dropdown with colored dots |
| Every `.component.scss` | Consumer: uses `var(--t-*)` tokens |
