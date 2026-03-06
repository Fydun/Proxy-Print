// --- Scryfall Import Mixin ---
// Moxfield / MTGGoldfish / MTGTop8 URL import, deck text import/sync

export default {
  methods: {
    /**
     * Import a deck from a Moxfield, MTGGoldfish, or MTGTop8 URL.
     *
     * Detects the source from the URL and delegates to the appropriate fetcher.
     * All fetchers populate the import text area with "qty name" lines.
     */
    async importDeckFromURL() {
      if (!this.importUrl) return;

      this.isFetchingUrl = true;
      this.importIsError = false;
      this.importStatus = "Fetching deck…";

      const url = this.importUrl.trim();

      try {
        let lines;

        if (url.includes("mtggoldfish.com")) {
          lines = await this._importFromMTGGoldfish(url);
        } else if (url.includes("mtgtop8.com")) {
          lines = await this._importFromMTGTop8(url);
        } else if (url.includes("moxfield.com")) {
          lines = await this._importFromMoxfield(url);
        } else {
          throw new Error(
            "Unsupported URL — paste a Moxfield, MTGGoldfish, or MTGTop8 link.",
          );
        }

        if (!lines || lines.length === 0) {
          throw new Error(
            "No cards found — the deck may be empty or private.",
          );
        }

        // Populate text area
        this.importText = lines.join("\n");
        this.importUrl = "";
        this.importStatus = `Imported ${lines.length} entries.`;
      } catch (err) {
        console.error("[Deck import]", err);
        this.importIsError = true;
        this.importStatus = err.message;
      } finally {
        this.isFetchingUrl = false;
      }
    },

    // ─── Moxfield ────────────────────────────────────────────────

    async _importFromMoxfield(url) {
      const deckId = this._extractMoxfieldDeckId(url);
      if (!deckId) {
        throw new Error(
          "Invalid URL — paste a link like moxfield.com/decks/abc123",
        );
      }

      const data = await this._fetchMoxfieldDeck(deckId);
      return this._parseMoxfieldDeck(data);
    },

    /** Pull the deck public-ID from a Moxfield URL. */
    _extractMoxfieldDeckId(url) {
      const m = url.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/);
      return m ? m[1] : null;
    },

    /**
     * Try Moxfield API endpoints through proxies until one returns valid JSON.
     * Tries v3 first, then v2. Throws on total failure.
     */
    async _fetchMoxfieldDeck(deckId) {
      const ts = Date.now();
      const apis = [
        { url: `https://api2.moxfield.com/v3/decks/all/${deckId}?_t=${ts}`, label: "v3" },
        { url: `https://api.moxfield.com/v2/decks/all/${deckId}?_t=${ts}`, label: "v2" },
      ];

      for (const api of apis) {
        const text = await this._fetchViaProxy(api.url, `Trying Moxfield ${api.label} API…`);
        if (!text) continue;

        try {
          const json = JSON.parse(text);
          if (json.name) return json;
        } catch { /* not valid JSON, try next */ }
      }

      throw new Error(
        "Could not reach Moxfield (CORS proxy issue). " +
          'Try pasting your deck list manually — on Moxfield click ••• → "Export" → copy the text.',
      );
    },

    /** Detect Cloudflare blocks, Moxfield 404s, and other bad responses. */
    _isBadResponse(text) {
      if (!text || text.length < 10) return true;
      const markers = [
        "Just a moment",
        "Cloudflare",
        '"status":404',
        '"title":"Not Found"',
        "Enable JavaScript and cookies",
        "Attention Required",
      ];
      const head = text.slice(0, 2000);
      return markers.some((m) => head.includes(m));
    },

    /** Shared CORS proxy list. Each fn takes a target URL and returns a proxied URL. */
    _corsProxies() {
      return [
        (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://corsproxy.org/?url=${encodeURIComponent(u)}`,
      ];
    },

    /**
     * Fetch a URL through the CORS proxy cascade. Returns the response text.
     * @param {string} targetUrl - The actual URL to fetch
     * @param {string} statusLabel - Shown in importStatus during fetch
     * @param {number} [timeout=45000] - Abort timeout in ms
     * @returns {string} response text
     */
    async _fetchViaProxy(targetUrl, statusLabel, timeout = 45_000) {
      const proxies = this._corsProxies();
      const errors = [];

      for (const proxy of proxies) {
        const proxyUrl = proxy(targetUrl);
        try {
          this.importStatus = statusLabel;
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeout);

          const res = await fetch(proxyUrl, { signal: ctrl.signal });
          clearTimeout(timer);

          if (res.status === 413) {
            throw new Error(
              "This deck is too large for automatic import. " +
                "Copy the deck list manually and paste it into the text box above.",
            );
          }

          if (!res.ok) {
            errors.push(`HTTP ${res.status}`);
            continue;
          }

          const text = await res.text();
          if (this._isBadResponse(text)) {
            errors.push("Blocked / soft-404");
            continue;
          }

          return text;
        } catch (e) {
          if (e.message.includes("too large")) throw e;
          errors.push(e.name === "AbortError" ? "Timeout" : e.message);
        }
      }

      console.warn("[Proxy fetch] All attempts failed:", errors);
      return null; // caller decides what to do
    },

    // ─── MTGGoldfish ─────────────────────────────────────────────

    /**
     * Import from a MTGGoldfish URL.
     * Supports /deck/{id} and /archetype/{slug} URLs.
     */
    async _importFromMTGGoldfish(url) {
      let deckId = this._extractGoldfishDeckId(url);

      if (!deckId) {
        // Archetype page — fetch HTML and extract the deck download link
        deckId = await this._resolveGoldfishArchetypeDeckId(url);
      }

      if (!deckId) {
        throw new Error(
          "Could not find a deck on this MTGGoldfish page.",
        );
      }

      // Fetch the plain-text deck list
      const ts = Date.now();
      const downloadUrl = `https://www.mtggoldfish.com/deck/download/${deckId}?_t=${ts}`;

      const text = await this._fetchViaProxy(downloadUrl, "Fetching MTGGoldfish deck…");
      if (!text) {
        throw new Error(
          "Could not reach MTGGoldfish (CORS proxy issue). " +
            "Try the Download button on MTGGoldfish, then paste the text above.",
        );
      }

      return this._parseGoldfishText(text);
    },

    /** Extract numeric deck ID from /deck/{id} URLs. */
    _extractGoldfishDeckId(url) {
      const m = url.match(/mtggoldfish\.com\/deck\/(\d+)/);
      return m ? m[1] : null;
    },

    /**
     * For /archetype/ URLs, fetch the HTML and find the download link
     * which contains the numeric deck ID.
     */
    async _resolveGoldfishArchetypeDeckId(url) {
      const ts = Date.now();
      const html = await this._fetchViaProxy(
        `${url}${url.includes("?") ? "&" : "?"}_t=${ts}`,
        "Resolving archetype deck…",
      );
      if (!html) return null;

      // Look for: href="/deck/download/7593082" or full URL variant
      const m = html.match(/\/deck\/download\/(\d+)/);
      return m ? m[1] : null;
    },

    /**
     * Parse the plain-text download from MTGGoldfish.
     * Format: "4 Card Name\n" with blank lines between sections.
     */
    _parseGoldfishText(text) {
      const lines = [];
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Each line is "4 Card Name" — keep as-is since processImport() parses this format
        if (/^\d+/.test(trimmed)) {
          lines.push(trimmed);
        }
      }
      return lines;
    },

    // ─── MTGTop8 ──────────────────────────────────────────────────

    /**
     * Import from a MTGTop8 URL.
     * URL format: mtgtop8.com/event?e=80711&d=813461&f=LE
     * The `d` parameter is the deck ID used for the MTGO text export.
     */
    async _importFromMTGTop8(url) {
      const m = url.match(/[?&]d=(\d+)/);
      if (!m) {
        throw new Error(
          "Could not find a deck ID in this MTGTop8 URL. " +
            "Make sure the URL contains a 'd' parameter (e.g. ?d=813461).",
        );
      }
      const deckId = m[1];

      // The /mtgo?d= endpoint returns a plain text deck list with no CORS issues
      // but we still go through proxies in case the user's browser blocks it.
      const downloadUrl = `https://mtgtop8.com/mtgo?d=${deckId}`;
      const text = await this._fetchViaProxy(downloadUrl, "Fetching MTGTop8 deck…");
      if (!text) {
        throw new Error(
          "Could not reach MTGTop8 (CORS proxy issue). " +
            "Try copying the deck list manually from the site.",
        );
      }

      // Format: "4 Card Name\n" with "Sideboard" separator line
      const lines = [];
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.toLowerCase() === "sideboard") continue;
        if (/^\d+/.test(trimmed)) {
          lines.push(trimmed);
        }
      }
      return lines;
    },

    /**
     * Extract "qty name" lines from a Moxfield API response.
     * Handles both v3 (boards.{zone}) and v2 (top-level zone maps).
     */
    _parseMoxfieldDeck(data) {
      const lines = [];

      // v3 structure: data.boards.mainboard / .sideboard / .commanders / etc.
      // v2 structure: data.mainboard / data.sideboard / data.commanders / etc.
      const zones =
        data.boards != null
          ? data.boards // v3
          : data; // v2

      const zoneNames = [
        "commanders",
        "companions",
        "mainboard",
        "sideboard",
      ];

      for (const zone of zoneNames) {
        const bucket = zones[zone];
        if (!bucket || typeof bucket !== "object") continue;

        // v3 nests cards under bucket.cards; v2 puts them directly on the bucket
        const cards = bucket.cards ?? bucket;

        // Each entry is { quantity, card: { name, ... } }
        for (const slot of Object.values(cards)) {
          if (!slot || typeof slot !== "object") continue;
          const qty = slot.quantity || 1;
          const name = slot.card?.name || slot.name;
          if (name) lines.push(`${qty} ${name}`);
        }
      }

      return lines;
    },

    /**
     * Try to resolve a card name via Scryfall fuzzy search.
     * Works for English names (typo-tolerant) and foreign / printed names.
     * Returns a Scryfall card object or null.
     */
    async _resolveByFuzzyName(name) {
      try {
        const res = await fetch(
          `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
        );
        if (!res.ok) return null;
        const card = await res.json();
        if (card.image_status === "placeholder") return null;
        return card;
      } catch {
        return null;
      }
    },

    /**
     * Build a deck card entry from a Scryfall card object and an import target.
     * Returns the card object ready for `this.cards`, or null if no image.
     */
    _buildCardFromScryfall(scryCard, target) {
      let src = "",
        backSrc = null,
        smallSrc = "",
        smallBackSrc = null;

      if (scryCard.card_faces && scryCard.card_faces[0].image_uris) {
        src =
          scryCard.card_faces[0].image_uris.png ||
          scryCard.card_faces[0].image_uris.large;
        smallSrc =
          scryCard.card_faces[0].image_uris.small ||
          scryCard.card_faces[0].image_uris.normal ||
          src;
        backSrc =
          scryCard.card_faces[1].image_uris?.png ||
          scryCard.card_faces[1].image_uris?.large;
        smallBackSrc =
          scryCard.card_faces[1].image_uris?.small ||
          scryCard.card_faces[1].image_uris?.normal ||
          backSrc;
      } else {
        src = scryCard.image_uris?.png || scryCard.image_uris?.large;
        smallSrc =
          scryCard.image_uris?.small ||
          scryCard.image_uris?.normal ||
          src;
      }

      if (!src) return null;

      const newCard = {
        name: scryCard.name,
        set: scryCard.set.toUpperCase(),
        setName: scryCard.set_name,
        cn: scryCard.collector_number,
        src,
        smallSrc,
        backSrc,
        smallBackSrc,
        showBack: false,
        qty: target.qty,
        dfcData: null,
        selected: false,
        isDuplex: false,
        oracle_id: scryCard.oracle_id,
        lang: target.lang,
        all_parts: scryCard.all_parts || null,
        cmc:
          scryCard.cmc ??
          (scryCard.card_faces ? scryCard.card_faces[0].cmc : 0),
        color: scryCard.colors
          ? scryCard.colors.join("")
          : scryCard.card_faces
            ? (scryCard.card_faces[0].colors || []).join("")
            : "",
        color_identity: scryCard.color_identity || [],
        type_line:
          scryCard.type_line ||
          (scryCard.card_faces ? scryCard.card_faces[0].type_line : ""),
      };
      if (backSrc) {
        newCard.dfcData = { frontSrc: src, backSrc: backSrc };
      }
      return newCard;
    },

    async processImport() {
      this.isImporting = true;
      this.importStatus = "Analyzing...";
      this.importErrors = [];
      this.errorMessage = "";

      const lines = this.importText.split("\n").filter((l) => l.trim() !== "");
      const targets = [];

      // MATCHERS
      // 1. Specific: "4 Fire // Ice (DMR) 215"
      // Note: We Capture the name loosely, then clean it up later.
      const specificRegex =
        /^(?:(\d+)(?:\s*x\s*|\s+))?(.+?)\s+\(([a-zA-Z0-9]+)\)\s+([a-zA-Z0-9]+)(?:\s+\[([a-zA-Z]+)\])?$/;

      // 2. Simple: "4 Fire // Ice"
      const simpleRegex =
        /^(?:(\d+)(?:\s*x\s*|\s+))?(.+?)(?:\s+\[([a-zA-Z]+)\])?$/;

      // HELPER: The "Cheat" -> Take only the left side of a split card
      const simplifyName = (rawName) => {
        return rawName.split("//")[0].split("/")[0].trim();
      };

      for (let line of lines) {
        line = line.trim();
        if (line.startsWith("//") || line.startsWith("#")) continue;

        let match = line.match(specificRegex);
        if (match) {
          targets.push({
            type: "specific",
            qty: match[1] ? parseInt(match[1]) : 1,
            name: simplifyName(match[2]), // "Fire // Ice" becomes "Fire"
            originalName: match[2].trim(), // Keep original for reference
            set: match[3].trim().toUpperCase(),
            cn: match[4].trim(),
            lang: match[5] ? match[5].toLowerCase() : "en",
            langExplicit: !!match[5],
            found: false,
          });
          continue;
        }

        match = line.match(simpleRegex);
        if (match) {
          targets.push({
            type: "simple",
            qty: match[1] ? parseInt(match[1]) : 1,
            name: simplifyName(match[2]), // "Fire // Ice" becomes "Fire"
            originalName: match[2].trim(),
            lang: match[3] ? match[3].toLowerCase() : "en",
            langExplicit: !!match[3],
            found: false,
          });
        } else {
          targets.push({
            type: "simple",
            qty: 1,
            name: simplifyName(line),
            originalName: line.trim(),
            lang: "en",
            langExplicit: false,
            found: false,
          });
        }
      }

      const nextCards = [];
      const fetchQueue = [];
      const usedLocalIds = new Set();

      // 2. Check against existing cards
      for (let target of targets) {
        let existingMatch;
        const customMatch = this.cards.find(
          (c) =>
            (c.set === "CUST" || c.set === "Local") &&
            (c.name.toLowerCase() === target.name.toLowerCase() ||
              c.name.toLowerCase().startsWith(target.name.toLowerCase())),
        );

        if (customMatch) {
          existingMatch = customMatch;
        } else if (target.type === "specific") {
          existingMatch = this.cards.find(
            (c) =>
              c.set === target.set &&
              c.cn === target.cn &&
              (c.lang || "en") === target.lang,
          );
        } else {
          // Fuzzy match against existing deck
          // Check if existing card name STARTS WITH our simplified target name
          // e.g. Existing: "Fire // Ice", Target: "Fire" -> Match!
          existingMatch = this.cards.find((c) => {
            const cName = c.name.toLowerCase();
            const tName = target.name.toLowerCase();
            return (
              (cName === tName || cName.startsWith(tName)) &&
              (c.lang || "en") === target.lang
            );
          });
        }

        if (existingMatch) {
          // FIX: Don't re-fetch if it's Local OR Custom
          if (
            existingMatch.set !== "Local" &&
            existingMatch.set !== "CUST" &&
            existingMatch.cmc === undefined
          ) {
            fetchQueue.push(target);
          } else {
            const clone = JSON.parse(JSON.stringify(existingMatch));
            clone.qty = target.qty;
            nextCards.push(clone);
            target.found = true;
            if (existingMatch.set === "Local") usedLocalIds.add(existingMatch);
          }
        } else {
          fetchQueue.push(target);
        }
      }

      // 3. Fetch missing from Scryfall (with IDB card cache)
      if (fetchQueue.length > 0) {
        const BATCH_SIZE = 75;
        const batches = [];
        for (let i = 0; i < fetchQueue.length; i += BATCH_SIZE)
          batches.push(fetchQueue.slice(i, i + BATCH_SIZE));

        for (let batch of batches) {
          this.importStatus = `Fetching ${batch.length} new cards...`;

          const identifiers = batch.map((t) => {
            if (t.type === "specific") {
              return { set: t.set, collector_number: t.cn };
            }
            return { name: t.name };
          });

          // Check IDB card cache first — skip API calls for already-known cards
          let cachedCards;
          try {
            cachedCards = await this.getCardsFromCache(identifiers);
          } catch {
            cachedCards = new Map();
          }

          // Build API batch only for cache-missed cards
          const uncachedIndices = [];
          const uncachedIdentifiers = [];
          for (let i = 0; i < identifiers.length; i++) {
            if (!cachedCards.has(i)) {
              uncachedIndices.push(i);
              uncachedIdentifiers.push(identifiers[i]);
            }
          }

          try {
            // Merge cached + fresh API results into one map
            const allResults = new Map(cachedCards); // index → card data

            if (uncachedIdentifiers.length > 0) {
              const response = await fetch(
                "https://api.scryfall.com/cards/collection",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ identifiers: uncachedIdentifiers }),
                },
              );
              const data = await response.json();

              if (data.data) {
                // Cache each response for future imports
                for (const card of data.data) {
                  this.cacheCardData(card);
                }

                // Map responses back to original batch indices
                for (const origIdx of uncachedIndices) {
                  const target = batch[origIdx];
                  let scryCard = null;
                  if (target.type === "specific") {
                    scryCard = data.data.find(
                      (c) =>
                        c.set.toUpperCase() === target.set &&
                        c.collector_number === target.cn,
                    );
                  } else {
                    const tName = target.name.toLowerCase();
                    scryCard = data.data.find((c) => {
                      const cName = c.name.toLowerCase();
                      return (
                        cName === tName ||
                        cName.startsWith(tName) ||
                        (c.card_faces &&
                          c.card_faces[0].name.toLowerCase() === tName)
                      );
                    });
                  }
                  if (scryCard) allResults.set(origIdx, scryCard);
                }
              }

              // Handle Not Found
              if (data.not_found && data.not_found.length > 0) {
                data.not_found.forEach((nf) => {
                  const isActuallyFound = batch.some(
                    (t) =>
                      t.found &&
                      (nf.name?.toLowerCase().includes(t.name.toLowerCase()) ||
                        t.name.toLowerCase().includes(nf.name?.toLowerCase())),
                  );

                  if (!isActuallyFound) {
                    let name =
                      nf.name ||
                      (nf.set
                        ? `${nf.set} #${nf.collector_number}`
                        : "Unknown Card");
                    if (name === "Unknown Card") {
                      const possibleTarget = batch.find((t) => !t.found);
                      if (possibleTarget) name = possibleTarget.originalName;
                    }
                    this.importErrors.push(name);
                  }
                });
              }
            }

            // Process all results (cached + fresh) uniformly
            for (let idx = 0; idx < batch.length; idx++) {
              const target = batch[idx];
              let scryCard = allResults.get(idx);

              if (!scryCard && cachedCards.has(idx)) {
                scryCard = cachedCards.get(idx);
              }

              // For cached results, match by target type
              if (!scryCard && !allResults.has(idx)) continue;
              if (!scryCard) continue;

              target.found = true;

              // Handle Language (IDB-persistent: same set/cn/lang never fetched twice)
              if (target.lang !== "en") {
                const langData = await this.fetchScryfallLang(
                  scryCard.set,
                  scryCard.collector_number,
                  target.lang,
                );
                if (langData) scryCard = langData;
              }

              let src = "",
                backSrc = null,
                smallSrc = "",
                smallBackSrc = null;

              // Image logic
              if (
                scryCard.card_faces &&
                scryCard.card_faces[0].image_uris
              ) {
                src =
                  scryCard.card_faces[0].image_uris.png ||
                  scryCard.card_faces[0].image_uris.large;
                smallSrc =
                  scryCard.card_faces[0].image_uris.small ||
                  scryCard.card_faces[0].image_uris.normal ||
                  src;
                backSrc =
                  scryCard.card_faces[1].image_uris?.png ||
                  scryCard.card_faces[1].image_uris?.large;
                smallBackSrc =
                  scryCard.card_faces[1].image_uris?.small ||
                  scryCard.card_faces[1].image_uris?.normal ||
                  backSrc;
              } else {
                src =
                  scryCard.image_uris?.png || scryCard.image_uris?.large;
                smallSrc =
                  scryCard.image_uris?.small ||
                  scryCard.image_uris?.normal ||
                  src;
              }

              if (src) {
                const newCard = {
                  name: scryCard.name,
                  set: scryCard.set.toUpperCase(),
                  setName: scryCard.set_name,
                  cn: scryCard.collector_number,
                  src,
                  smallSrc,
                  backSrc,
                  smallBackSrc,
                  showBack: false,
                  qty: target.qty,
                  dfcData: null,
                  selected: false,
                  isDuplex: false,
                  oracle_id: scryCard.oracle_id,
                  lang: target.lang,
                  all_parts: scryCard.all_parts || null,
                  // Metadata
                  cmc:
                    scryCard.cmc ??
                    (scryCard.card_faces ? scryCard.card_faces[0].cmc : 0),
                  color: scryCard.colors
                    ? scryCard.colors.join("")
                    : scryCard.card_faces
                      ? (scryCard.card_faces[0].colors || []).join("")
                      : "",
                  color_identity: scryCard.color_identity || [],
                  type_line:
                    scryCard.type_line ||
                    (scryCard.card_faces
                      ? scryCard.card_faces[0].type_line
                      : ""),
                };
                if (backSrc) {
                  newCard.dfcData = { frontSrc: src, backSrc: backSrc };
                }
                nextCards.push(newCard);
              }
            }
          } catch (e) {
            console.error("API Error", e);
            this.importErrors.push("Network Error - Could not reach Scryfall");
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      // 4. Resolve foreign / fuzzy names for cards not found by the batch API
      const unfoundTargets = fetchQueue.filter((t) => !t.found);
      if (unfoundTargets.length > 0) {
        this.importStatus = `Resolving ${unfoundTargets.length} name(s) via search…`;

        for (const target of unfoundTargets) {
          const fuzzyResult = await this._resolveByFuzzyName(
            target.originalName || target.name,
          );
          if (!fuzzyResult) continue;

          target.found = true;
          const detectedLang = fuzzyResult.lang;

          // Auto-detect language when the user didn't supply an explicit tag
          if (!target.langExplicit && detectedLang !== "en") {
            target.lang = detectedLang;
          }

          // Remove from importErrors (batch not_found may have added it)
          const errName = (target.originalName || target.name).toLowerCase();
          const errIdx = this.importErrors.findIndex(
            (e) => e.toLowerCase() === errName,
          );
          if (errIdx !== -1) this.importErrors.splice(errIdx, 1);

          // Start from the canonical English print so fetchScryfallLang
          // can resolve the requested language for the best available set.
          let scryCard = fuzzyResult;
          if (detectedLang !== "en") {
            try {
              const enRes = await fetch(
                `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(fuzzyResult.name)}`,
              );
              if (enRes.ok) {
                const enCard = await enRes.json();
                if (enCard.image_status !== "placeholder") {
                  scryCard = enCard;
                }
              }
            } catch { /* use fuzzyResult as fallback */ }
            await new Promise((r) => setTimeout(r, 100));
          }

          // Cache the English card for future imports
          if (scryCard.lang === "en") this.cacheCardData(scryCard);

          // Fetch the requested language version
          if (target.lang !== "en") {
            const langData = await this.fetchScryfallLang(
              scryCard.set,
              scryCard.collector_number,
              target.lang,
            );
            if (langData) {
              scryCard = langData;
            } else {
              // fetchScryfallLang failed — fall back to original fuzzy result
              // if it was already in the target language
              if (fuzzyResult.lang === target.lang) scryCard = fuzzyResult;
            }
          }

          const newCard = this._buildCardFromScryfall(scryCard, target);
          if (newCard) nextCards.push(newCard);

          await new Promise((r) => setTimeout(r, 100));
        }
      }

      const remainingLocalFiles = this.cards.filter(
        (c) => c.set === "Local" && !usedLocalIds.has(c),
      );
      nextCards.push(...remainingLocalFiles);

      this.cards = nextCards;
      this.isImporting = false;

      // Cache thumbnails locally, then start high-res prefetch
      this.loadLocalImages();
      this.runPrefetch();

      if (this.importErrors.length > 0) {
        this.importStatus = `Complete. ${this.importErrors.length} cards could not be found.`;
      } else {
        this.importStatus = "Sync complete.";
        setTimeout(() => {
          this.showImportModal = false;
          this.importStatus = "";
        }, 800);
      }
    },
  },
};
