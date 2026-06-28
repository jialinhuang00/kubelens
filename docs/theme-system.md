# Theme System

kubelens used to ship five themes and a color-dot switcher. It now ships one: **Nord**. This is how the single theme is wired, and what's left of the old switching machinery.

---

## Why one theme

The multi-theme system worked by layering. `:root` held a default (Soft Gold), and each extra theme was a `[data-theme="..."]` block that overrode every token. A `ThemeService` flipped the `data-theme` attribute on `<html>`, CSS specificity did the rest.

That flexibility wasn't earning its keep. Five palettes meant five sets of tokens to keep in sync, and the app only ever looked right in one of them. So the `[data-theme]` blocks were deleted and Nord was folded straight into `:root`. No switching, no attribute, no second palette to maintain.

## 1. Tokens live in `:root`

`src/styles.scss` defines every color as a CSS custom property, all in one `:root` block:

```scss
:root {
  --t-accent: #88c0d0;          // Nord frost blue
  --t-bg-body: #2e3440;         // Nord polar night
  --t-text-primary: #eceff4;    // Nord snow storm
  // ... 30+ tokens
}
```

There is no `[data-theme]` block anywhere in the file. Change a value here and the whole app follows.

## 2. Components consume tokens

Every component uses `var(--t-*)` instead of hardcoded colors:

```scss
.sidebar {
  background: var(--t-bg-body);
  border-right: 1px solid var(--t-border);
}
.sidebar-title {
  color: var(--t-accent);
}
```

Nothing reads a literal hex. That's the rule that kept the old switcher possible, and it's still the rule — it's just what makes one coherent palette easy to retune.

## 3. The graph is the one place CSS can't reach

Graph dots aren't CSS. They're WebGL pixels rendered by Cosmos, so `var(--t-*)` doesn't apply to them directly.

The bridge: six category-level kind colors are declared as tokens in `:root`:

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

At graph-init time, `getThemedKindColors()` reads these six tokens with `getComputedStyle`, then derives all ~22 individual kind colors by shifting brightness:

```typescript
const wk = getCssVar('--t-kind-workload');     // '#81a1c1'
return {
  Deployment: wk,                              // base
  StatefulSet: shiftBrightness(wk, 1.1),       // 10% brighter
  DaemonSet: shiftBrightness(wk, 0.85),        // 15% darker
  // ...
};
```

That map feeds Cosmos: `nodeColor: (n) => kindColors[n.data.kind]`. The sidebar legend reads the same map, so dots and legend never drift apart. The Cosmos canvas itself is transparent (`backgroundColor: 'rgba(0,0,0,0)'`); the CSS `--t-bg-graph` shows through behind it.

(Lives in `universe/models/graph.models.ts`, `universe/services/graph-layout.service.ts`, `universe/components/universe.component.ts`.)

## 4. Legacy aliases still resolve

Older components referenced names like `--bg-primary` and `--accent-cyan`. Those still work as aliases onto the new tokens, so nothing had to be renamed:

```scss
:root {
  --bg-primary: var(--t-bg-body);
  --accent-cyan: var(--t-accent);
}
```

## 5. `ThemeService` is vestigial

`src/app/core/services/theme.service.ts` still has `setTheme()` / `applyTheme()` that toggle a `data-theme` attribute. With zero `[data-theme]` blocks in the CSS, that attribute now matches nothing — setting it is a no-op for color. The service is kept only so existing injections don't break; it no longer drives the look. The palette is `:root`, full stop. The dead `shared/components/theme-switcher/` component is likewise unused.

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
| `universe/` graph files | Read `--t-kind-*` → generate WebGL node colors |
| `src/app/core/services/theme.service.ts` | Vestigial: toggles a now-unused `data-theme` attribute |
| Every `.component.scss` | Consumer: uses `var(--t-*)` tokens |
