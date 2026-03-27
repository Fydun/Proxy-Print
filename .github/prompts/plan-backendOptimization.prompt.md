## Plan: Backend & Performance Optimizations

The app has several high-impact bottlenecks that waste CPU, memory, and network. The following steps address them in priority order.

### Steps

1. **Don't save so often.** Right now, every tiny change to any card — clicking a checkbox, changing a quantity, sorting — instantly saves the entire deck to the browser database. If you click 10 checkboxes in a row, the app saves 10 times in rapid succession. Each save also opens a brand new connection to the database instead of reusing the one it already has.
   - **Fix:** Add a short delay (~500ms) so rapid changes are grouped into a single save. Reuse the database connection like the image cache already does.
   - **Location:** Deep watcher at app.js#L237, `saveToDB`/`loadFromDB` at app.js#L21-L55 (compare with the cached approach at app.js#L2614).

2. **Stop caching full-resolution images as "thumbnails".** The card grid display already uses the small Scryfall thumbnails (`smallSrc`). But `loadLocalImages()` also downloads and caches the **full-resolution** images (`src`, `backSrc`) — even though nothing uses them from this cache. The PDF pipeline has its own separate high-res cache. The click-to-zoom preview can just load from the network on demand.
   - **Fix:** Only download and cache `smallSrc`/`smallBackSrc` in `loadLocalImages()`. Skip the full-res URLs entirely. This cuts the number of images downloaded and stored in half.
   - **Location:** `loadLocalImages()` at app.js#L3355-L3361, `downloadThumbnail()` at app.js#L3336-L3351.

3. **Don't duplicate image data when switching languages.** When you switch a card's language, the app saves a snapshot so you can switch back instantly. But it copies the actual image data (huge base64 strings, 100KB+ each) into that snapshot. For 100 cards switching between 3 languages, this can balloon to hundreds of MB. It only needs to save the Scryfall web address (URL) — the image data is already stored separately in the thumbnail cache.
   - **Fix:** In `langCache` snapshots, store only the Scryfall URLs (like `https://...`). When restoring, let `resolveImage()` look them up in the existing `localImages` cache.
   - **Location:** `langCache` snapshots at app.js#L528-L544 and app.js#L609-L617.

4. **Use all workers during PDF generation.** The app creates up to 8 "helper" workers for processing images, but when generating the PDF, it sends one image at a time and waits for it to finish before sending the next. It's like having 8 cashiers open but only letting one customer through at a time.
   - **Fix:** Send all images on a page to the workers at once, wait for all of them to come back, then write them all to the PDF.
   - **Location:** `generatePDF()` sequential loop at app.js#L3023-L3054.

5. **Load saved thumbnails in bulk.** When the app starts, it loads each saved thumbnail from the browser database one at a time. For a 100-card deck, that's ~200 individual requests to the database. It could ask for all of them in a single request.
   - **Fix:** Open one database transaction and fire all the lookups at once instead of one by one.
   - **Location:** `loadLocalImages()` Phase 1 at app.js#L3363-L3375.

6. **Batch language changes via Scryfall.** When you select 50 cards and change their language, the app asks Scryfall about each card individually (1–2 network requests per card, one at a time). Scryfall supports asking about up to 75 cards in a single request, which would reduce ~100 sequential network calls to ~1.
   - **Fix:** Group eligible cards and use Scryfall's `/cards/collection` batch endpoint instead of per-card fetches.
   - **Location:** `massChangeLanguage()` at app.js#L470-L660.

### Further Considerations (Lower Priority)

1. **Redundant cache check in prefetch.** When prefetching high-res images for PDF, `runPrefetch()` already figures out which images are missing from the cache. But then `processCardToCache()` checks the cache again for each image — a wasted lookup every time. Easy fix: skip the second check.
   - **Location:** `processCardToCache()` at app.js#L2755, vs. `runPrefetch()` at app.js#L2808-L2825.

2. **No automatic cache cleanup.** The image cache in the browser database grows forever — every deck you've ever printed leaves images behind. There's a manual "Clear Cache" button in Help, but no automatic cleanup. Could add a size limit or age-based expiration, but the manual button is likely fine for now.

3. **Image encoding overhead in workers.** Workers convert processed images to base64 text, which is ~33% larger than the raw image data. Storing the raw binary data instead would save space, but requires changes to both the workers and the PDF pipeline. Worth revisiting after the higher-priority steps are done.
