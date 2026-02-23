# Copilot Instructions — Proxy-Print

## Stack & Architecture
- **Vue 3 Options API** loaded via CDN (global `Vue` object), no build step, no bundler, no `.vue` SFCs.
- All components are plain `.js` files using `template: /*html*/ \`...\`` template literals.
- **Tailwind CSS via CDN** with custom config mapping semantic color names (`page`, `surface`, `primary`, etc.) to CSS variables defined in `styles.css`.
- Dark mode uses Tailwind's `class` strategy (`.dark` on `<html>`). Default is dark.
- **jsPDF** is lazy-loaded at PDF generation time only — do not add it to `index.html`.

## File Organization
- `app.js` — Vue `createApp()` entry. All reactive state (`data()`), computed, watchers, lifecycle hooks. Delegates logic to mixins.
- `mixins/*.js` — Business logic modules. Each exports `{ methods: { ... } }`, spread into `app.js` methods. All share `this` (the Vue instance). **Method names must be globally unique across all mixins.**
- `components/*.js` — Modal components + `AppIcon`. Use `v-model` for visibility, props for data, emits for actions.
- `utils/db.js` — IndexedDB helpers for session persistence, paper size constants, `debounce()`.
- `imageWorker.js` — Web Worker for OffscreenCanvas image processing. Has its own IDB connection.

## Key Mixins
| Mixin | Responsibility |
|---|---|
| `persistence.js` | Autosave (debounced 500ms), session load/save to IDB, project JSON export/import |
| `deckManagement.js` | Card add/remove, mass qty, mass language change (3-phase: langCache → IDB → API) |
| `sorting.js` | WUBRG scoring, type/color ranking, multi-key sort |
| `fileHandling.js` | Drag/drop, paste, local file upload, Scryfall batch identification |
| `scryfallImport.js` | Moxfield URL import (CORS proxy cascade), text deck parsing, batch Scryfall fetch |
| `tokenDfc.js` | Split/restore DFC, token fetching via `all_parts` |
| `versionSelect.js` | Version picker (2-tier cache: memory → IDB → API), custom image upload, card drag reorder |
| `imageCache.js` | All `MTGProxyImageCache` IDB ops, worker pool, prefetch, thumbnail pipeline, cache eviction (500MB budget) |
| `pdfGeneration.js` | jsPDF lazy-load, layout math, cut guides, duplex mirroring, CORS image recovery |

## Two IndexedDB Databases
- **`MTGProxyPrinterDB`** — Session state. Single key `"currentSession"`. Managed by `utils/db.js`.
- **`MTGProxyImageCache`** — All cached images/data. Key prefixes: `thumb_`, `lang_`, `versions_`, `card_`, and unprefixed for processed hi-res blobs. Managed by `imageCache.js`. **Worker also writes to this DB** — if you change the schema, update both `imageWorker.js` and `imageCache.js`.

## Non-Reactive Performance Pattern
`this.localImages` (URL→dataURL map) and `this.versionCache` (Map) are **plain objects set in `created()`**, not reactive. A reactive counter `localImagesVersion` is bumped to trigger re-renders. Any template expression using `localImages` must read `localImagesVersion` or call `resolveImage()` to register the dependency. **Do not make these reactive** — Vue Proxy overhead on large datasets kills performance.

## Scryfall API Rules
- **Rate limit:** Max 4 concurrent requests for language changes, batches of 75 for `/cards/collection`, 75–100ms delays between batches. Never add unbounded parallel Scryfall calls.
- **CORS cache-busting:** Use `?t=Date.now()` query param (not `no-cache` headers). `handleImageError()` appends `?fix=cors`.
- **`image_status: "placeholder"` must always be filtered out** — these cards have no real images. Check this in every new Scryfall data path.

## Language Cache System
Each card has `card.langCache` (in-memory only, not persisted to IDB):
- `langCache[langCode]` = snapshot of card data for that language (includes `localUrls` for thumbnail data URLs).
- `langCache[langCode] = null` = confirmed unavailable in that language (skipped instantly on future attempts).
- **3-phase resolution:** (1) in-memory `langCache` → (2) IDB `lang_` key → (3) Scryfall API with fallback name-search.

## DFC / Split Card Complexity
`splitCard()` creates `isFrontFace`/`isBackFace` flags. `selectVersion()` has separate code paths for split vs. whole cards. `restoreDFC()` finds the partner by `oracle_id` adjacency. Test all three paths when modifying card name or DFC logic.

## Card Object Shape
No TypeScript — card shape is implicit and varies by origin (Scryfall import adds `all_parts`, file upload sets `set: "Local"`, DFC split adds `isFrontFace`/`isBackFace`). Always use optional chaining (`?.`) for optional properties.

## Z-Index Hierarchy
toolbar: `z-20` → sort dropdown: `z-30` → sticky deck header: `z-10` → card overlays: `z-10` → floating action bar: `z-30` → drag overlay: `z-40` → modals: `z-50` → lightbox: `z-[100]`.

## Other Gotchas
- **Settings watcher side effects:** Auto-sets card dimensions from preset, clears processed image cache on visual changes, persists dark mode, triggers prefetch. Adding new settings may require updating the `visualChanged` check.
- **`structuredClone()` fails on Vue Proxies** — use `JSON.parse(JSON.stringify(...))` for deep cloning reactive objects.
- **`prefetchRunId` invalidation:** Any new async loop in prefetch must check `this.prefetchRunId !== currentRunId` to abort stale runs.
- **Moxfield CORS proxies are fragile:** 3 proxies × 2 API versions = 6 attempts. If proxies die, update the URL list in `_fetchMoxfieldDeck()`. Note: `corsproxy.io` uses `?<encoded_url>` format (no param name), while `allorigins.win` and `corsproxy.org` use `?url=<encoded_url>`.
- **SettingsModal mutates its `settings` prop directly** (object reference two-way binding, not v-model). This is intentional.
