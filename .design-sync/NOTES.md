# design-sync notes — Quark

Corrections and findings from syncing this repo. Read before the next run.

## Why this repo is hand-authored, not converted

The `/design-sync` converter has two shapes, `storybook` and `package`. Quark
fits neither, and no amount of config changes that:

- No Storybook, no `*.stories.*`.
- `package.json` is `"private": true` with no `main` / `module` / `exports` /
  `types`. Nothing is exported; there is no library entry point.
- No React. Dependencies are three Tauri packages. `CLAUDE.md` states the
  no-framework choice explicitly — UI components are plain TS classes that build
  DOM imperatively.
- `pnpm build` (`tsc && vite build`) emits the *application*, not a component
  bundle, so there is no `dist/` for `_ds_bundle.js` to ship.

So there is no `window.<globalName>.*` surface, no `<Name>Props`, and nothing a
React-composing design agent could call. The bundle is therefore hand-authored
static HTML cards with `@dsCard` markers — the route the `DesignSync` tool
documents for hand-authored projects. Cards carry markup + the component's real
CSS slice; the design agent gets Quark's look and class vocabulary, not callable
components.

**Do not re-attempt the converter on a later run** unless Quark grows an actual
exported component library.

## How the bundle is produced

- `scripts/extract-ds-slice.mjs <prefix>...` pulls a component's rules out of
  `src/style/base.css`. base.css is a 7,261-line monolith but its classes are
  BEM-namespaced per component, so a prefix match gets the whole slice cleanly.
- `scripts/validate-ds-bundle.mjs` checks the `@import` closure resolves, every
  class a card uses is defined, every bare `var(--x)` is declared, and every card
  has a well-formed `@dsCard` first line. Must exit clean before upload.
- Cards were render-verified with headless Firefox against a throwaway profile
  (the user's Firefox is normally running; without `--profile <dir>` the
  screenshot silently no-ops with "Firefox is already running").

## Findings about Quark itself

These are real observations about the codebase, surfaced by the extraction. None
block the sync; all are worth a look.

1. **`--surface-*`, `--overlay-*` and `--shadow-color` are not themeable.** They
   are declared in `src/theme/vars.css` as white-on-dark tints, no theme TOML
   sets them, and `src/theme/loader.ts` does not derive them. Under the light
   themes (catppuccin-latte, solarized-light, high-contrast) a 4% white tint on a
   light background is invisible — hover states there are effectively unstyled.
   The Foundations/Themes card shows this side by side.
2. **`--border` is dead.** Declared in `vars.css`, referenced 0 times in
   base.css. The live token is `--border-color` (144 uses), which is what
   `loader.ts:164` writes from the theme's `border` key.
3. **Six tokens are referenced but never declared**, all with `var()` fallbacks
   so nothing breaks: `--presence-online` / `--presence-unavailable` /
   `--presence-offline` (base.css:416-425), `--msg-body` (:3842, :5544),
   `--drawer-shut` (:6539), `--keyboard-offset` (:6612). The last two are set at
   runtime; the others read as optional theme hooks that no theme uses. Either
   declare them in vars.css or drop the indirection.
4. **`.confirm-dialog` has no CSS at all.** `ConfirmDialog` passes
   `prefix: "confirm-dialog"` to `DialogBase`, but base.css defines no rules for
   that prefix — so it renders on browser defaults. `.help-dialog` was used as
   the Dialogs card instead because it is fully styled.

## Environment caveats

- Emoji render partly monochrome in the headless Firefox screenshots — that is
  font coverage in the throwaway profile, not a card defect. The category bar and
  several grid cells do render in colour with identical markup.
- Run `cargo` via `nix develop --command` in this repo (unrelated to sync, but it
  bit a prior session).
