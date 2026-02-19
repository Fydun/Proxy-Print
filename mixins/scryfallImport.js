// --- Scryfall Import Mixin ---
// Moxfield URL import, deck text import/sync

export default {
  methods: {
    /**
     * Import a deck from a Moxfield URL.
     *
     * Strategy:
     *   1. Extract deck ID from URL
     *   2. Try Moxfield v3 API (api2.moxfield.com) through multiple CORS proxies
     *   3. Fall back to v2 API (api.moxfield.com) through the same proxies
     *   4. Parse the JSON and populate the import text area
     *
     * Moxfield's API does not set CORS headers, so we must relay through
     * third-party CORS proxies. These are inherently best-effort; when all
     * proxies fail the user is directed to paste the list manually.
     */
    async importDeckFromURL() {
      if (!this.importUrl) return;

      this.isFetchingUrl = true;
      this.errorMessage = "";
      this.importStatus = "Fetching deck…";

      const url = this.importUrl.trim();

      try {
        // --- 1. Extract Deck ID ---
        const deckId = this._extractMoxfieldDeckId(url);
        if (!deckId) {
          throw new Error(
            "Invalid URL — paste a link like moxfield.com/decks/abc123",
          );
        }

        // --- 2. Fetch deck JSON via CORS proxies ---
        const data = await this._fetchMoxfieldDeck(deckId);

        // --- 3. Parse card list from JSON ---
        const lines = this._parseMoxfieldDeck(data);

        if (lines.length === 0) {
          throw new Error(
            "No cards found — the deck may be empty or private.",
          );
        }

        // --- 4. Populate text area ---
        this.importText = lines.join("\n");
        this.importUrl = "";
        this.importStatus = `Imported ${lines.length} entries.`;
      } catch (err) {
        console.error("[Moxfield import]", err);
        this.errorMessage = err.message;
        this.importStatus = "";
      } finally {
        this.isFetchingUrl = false;
      }
    },

    /** Pull the deck public-ID from a Moxfield URL. */
    _extractMoxfieldDeckId(url) {
      const m = url.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/);
      return m ? m[1] : null;
    },

    /**
     * Try every (API version × CORS proxy) combination until one returns
     * valid JSON. Throws on total failure.
     */
    async _fetchMoxfieldDeck(deckId) {
      const apis = [
        `https://api2.moxfield.com/v3/decks/all/${deckId}`,
        `https://api.moxfield.com/v2/decks/all/${deckId}`,
      ];

      // Cache-bust to avoid stale proxy results
      const ts = Date.now();

      const proxies = [
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}&_t=${ts}`,
        (u) =>
          `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}&_t=${ts}`,
        (u) =>
          `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
      ];

      const errors = [];

      for (const api of apis) {
        for (const proxy of proxies) {
          const proxyUrl = proxy(api);
          try {
            this.importStatus = `Trying ${api.includes("v3") ? "v3" : "v2"} API…`;

            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 15_000);

            const res = await fetch(proxyUrl, { signal: ctrl.signal });
            clearTimeout(timer);

            if (!res.ok) {
              errors.push(`HTTP ${res.status}`);
              continue;
            }

            const text = await res.text();

            // Reject Cloudflare challenge pages / soft 404s
            if (this._isBadResponse(text)) {
              errors.push("Blocked / soft-404");
              continue;
            }

            const json = JSON.parse(text); // throws if not JSON
            // Quick sanity check: a valid deck response has a name
            if (!json.name) {
              errors.push("JSON missing 'name'");
              continue;
            }
            return json;
          } catch (e) {
            errors.push(e.name === "AbortError" ? "Timeout" : e.message);
          }
        }
      }

      // All attempts failed — give the user a helpful message
      console.warn("[Moxfield import] All proxy attempts failed:", errors);
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

        // Each bucket is { someId: { quantity, card: { name, ... } }, ... }
        for (const slot of Object.values(bucket)) {
          const qty = slot.quantity || 1;
          const name = slot.card?.name || slot.name;
          if (name) lines.push(`${qty} ${name}`);
        }
      }

      return lines;
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
            found: false,
          });
        } else {
          targets.push({
            type: "simple",
            qty: 1,
            name: simplifyName(line),
            originalName: line.trim(),
            lang: "en",
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

      // 3. Fetch missing from Scryfall
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
            // Just send "Fire". Scryfall handles the rest.
            return { name: t.name };
          });

          try {
            const response = await fetch(
              "https://api.scryfall.com/cards/collection",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifiers }),
              },
            );
            const data = await response.json();

            if (data.data) {
              for (let target of batch) {
                let scryCard = null;
                if (target.type === "specific") {
                  scryCard = data.data.find(
                    (c) =>
                      c.set.toUpperCase() === target.set &&
                      c.collector_number === target.cn,
                  );
                } else {
                  // Match response back to target
                  // Response: "Fire // Ice", Target: "Fire" -> Match
                  const tName = target.name.toLowerCase();
                  scryCard = data.data.find((c) => {
                    const cName = c.name.toLowerCase();
                    // Check exact match, startswith, or face match
                    return (
                      cName === tName ||
                      cName.startsWith(tName) ||
                      (c.card_faces &&
                        c.card_faces[0].name.toLowerCase() === tName)
                    );
                  });
                }

                if (scryCard) {
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
              }
            }

            // Handle Not Found
            if (data.not_found && data.not_found.length > 0) {
              data.not_found.forEach((nf) => {
                // Check if we actually found it despite Scryfall complaining (fuzzy match success)
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
                  // Fallback: try to find which target caused this error using the cleaned name
                  if (name === "Unknown Card") {
                    const possibleTarget = batch.find((t) => !t.found);
                    if (possibleTarget) name = possibleTarget.originalName;
                  }
                  this.importErrors.push(name);
                }
              });
            }
          } catch (e) {
            console.error("API Error", e);
            this.importErrors.push("Network Error - Could not reach Scryfall");
          }
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
