// --- Bulk Data Mixin ---
// Loads Scryfall "All Cards" bulk JSON into memory and provides
// instant local lookups, bypassing API rate limits entirely.
// The parsed data (~2.3 GB) is stored in non-reactive plain objects
// set in created() to avoid Vue Proxy overhead.

export default {
  methods: {
    /**
     * Load a Scryfall bulk-data JSON file from disk.
     * Expects the "All Cards" or "Default Cards" export format:
     * a top-level JSON array of card objects.
     */
    async loadBulkDataFile(file) {
      if (!file) return;
      this.bulkDataStatus = "loading";
      this.bulkDataProgress = "Reading file…";
      this.bulkDataPercent = 0;

      try {
        // --- Phase 1: Read file with stream progress ---
        const totalBytes = file.size;
        const reader = file.stream().getReader();
        const chunks = [];
        let bytesRead = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          bytesRead += value.length;
          const pct = Math.round((bytesRead / totalBytes) * 100);
          if (pct !== this.bulkDataPercent) {
            this.bulkDataPercent = pct;
            this.bulkDataProgress = `Reading file… ${pct}%`;
          }
        }

        this.bulkDataProgress = "Decoding text…";
        this.bulkDataPercent = 100;
        await new Promise((r) => setTimeout(r, 20));

        const blob = new Blob(chunks);
        const text = await blob.text();
        chunks.length = 0; // free chunk refs

        // --- Phase 2: Parse JSON (synchronous, can't report granular progress) ---
        this.bulkDataProgress = "Parsing JSON…";
        this.bulkDataPercent = 0;
        await new Promise((r) => setTimeout(r, 20));
        const cards = JSON.parse(text);

        if (!Array.isArray(cards)) {
          throw new Error("Expected a JSON array of card objects.");
        }

        // --- Phase 3: Index cards with progress ---
        const total = cards.length;
        this.bulkDataProgress = `Indexing 0 / ${total.toLocaleString()} cards…`;
        this.bulkDataPercent = 0;
        await new Promise((r) => setTimeout(r, 20));

        // Build indexes — plain objects, NOT reactive
        const byOracleId = {};  // oracle_id → [card, card, …] sorted newest→oldest
        const byName = {};      // lowercase name → [card, card, …]
        const BATCH = 50000;    // yield to UI every N cards

        for (let i = 0; i < total; i++) {
          const c = cards[i];

          // Skip digital-only and placeholder cards
          if (c.digital) continue;
          if (c.image_status === "placeholder") continue;

          // Index by oracle_id
          if (c.oracle_id) {
            if (!byOracleId[c.oracle_id]) byOracleId[c.oracle_id] = [];
            byOracleId[c.oracle_id].push(c);
          }

          // Index by name (lowercased for case-insensitive lookup)
          const nameLower = (c.name || "").toLowerCase();
          if (nameLower) {
            if (!byName[nameLower]) byName[nameLower] = [];
            byName[nameLower].push(c);
          }

          // Yield to UI periodically
          if (i % BATCH === 0 && i > 0) {
            const pct = Math.round((i / total) * 100);
            this.bulkDataPercent = pct;
            this.bulkDataProgress = `Indexing ${i.toLocaleString()} / ${total.toLocaleString()} cards… ${pct}%`;
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        // --- Phase 4: Sort indexes ---
        this.bulkDataProgress = "Sorting versions…";
        this.bulkDataPercent = 95;
        await new Promise((r) => setTimeout(r, 0));

        const sortDesc = (a, b) =>
          (b.released_at || "").localeCompare(a.released_at || "");
        for (const key in byOracleId) byOracleId[key].sort(sortDesc);
        for (const key in byName) byName[key].sort(sortDesc);

        // Store on the instance (non-reactive, set in created())
        this.bulkByOracleId = byOracleId;
        this.bulkByName = byName;

        this.bulkDataStatus = "loaded";
        this.bulkDataProgress = "";
        this.bulkDataPercent = 100;
        this.bulkDataCardCount = total;
      } catch (e) {
        console.error("Bulk data load error:", e);
        this.bulkDataStatus = "error";
        this.bulkDataProgress = e.message || "Unknown error";
        this.bulkDataPercent = 0;
        this.bulkByOracleId = {};
        this.bulkByName = {};
      }
    },

    unloadBulkData() {
      this.bulkByOracleId = {};
      this.bulkByName = {};
      this.bulkDataStatus = "none";
      this.bulkDataProgress = "";
      this.bulkDataCardCount = 0;
    },

    /** Check if bulk data is available */
    hasBulkData() {
      return this.bulkDataStatus === "loaded";
    },

    /**
     * Look up all printings for a card from bulk data.
     * Returns an array sorted newest→oldest, or null if bulk data unavailable.
     *
     * @param {Object} opts
     * @param {string} [opts.oracle_id]
     * @param {string} [opts.name]
     * @param {string} [opts.lang] - Filter to specific language (optional)
     * @returns {Array|null}
     */
    bulkLookupPrintings({ oracle_id, name, lang }) {
      if (!this.hasBulkData()) return null;

      let results = null;

      if (oracle_id && this.bulkByOracleId[oracle_id]) {
        results = this.bulkByOracleId[oracle_id];
      } else if (name) {
        const cleanName = name
          .replace(" (Front)", "")
          .replace(" (Back)", "")
          .toLowerCase();
        results = this.bulkByName[cleanName] || null;
      }

      if (!results) return null;

      // Filter by language if requested
      if (lang) {
        results = results.filter((c) => c.lang === lang);
      }

      return results.length > 0 ? results : null;
    },

    /**
     * Pick a single printing from bulk data based on a strategy.
     * Strategies: 'newest', 'oldest', 'default', 'full-art', 'borderless',
     *             'extended-art', 'retro-frame'
     *
     * @returns {Object|null} A raw Scryfall card object, or null.
     */
    bulkPickVersion({ oracle_id, name, lang }, strategy) {
      const printings = this.bulkLookupPrintings({ oracle_id, name, lang });
      if (!printings) return null;

      // For English printings only (version changes stay in current lang by default)
      const pool = printings;

      switch (strategy) {
        case "newest":
          return pool[0] || null;

        case "oldest":
          return pool[pool.length - 1] || null;

        case "default": {
          // Scryfall's "default" print is typically the newest non-promo,
          // non-oversized, paper-legal English printing.
          const def = pool.find(
            (c) =>
              c.lang === "en" &&
              !c.oversized &&
              !c.promo &&
              c.games?.includes("paper"),
          );
          return def || pool.find((c) => c.lang === "en") || pool[0] || null;
        }

        case "full-art":
          return pool.find((c) => c.full_art) || null;

        case "borderless":
          return pool.find((c) => c.border_color === "borderless") || null;

        case "extended-art":
          // Scryfall marks extended art via frame_effects
          return (
            pool.find(
              (c) => c.frame_effects && c.frame_effects.includes("extendedart"),
            ) || null
          );

        case "retro-frame":
          return (
            pool.find((c) => c.frame === "1993" || c.frame === "1997") || null
          );

        default:
          return pool[0] || null;
      }
    },

    /**
     * Build the version list for the version select modal from bulk data.
     * Returns an array in the same format as the Scryfall API version list,
     * or null if bulk data is unavailable.
     */
    bulkBuildVersionList({ oracle_id, name, lang }) {
      const printings = this.bulkLookupPrintings({ oracle_id, name, lang });
      if (!printings) return null;

      return printings.map((c) => {
        let previewSrc = "",
          fullSrc = "",
          backSrc = null,
          backPreviewSrc = null;

        if (c.card_faces && c.card_faces[0].image_uris) {
          previewSrc = c.card_faces[0].image_uris.normal;
          fullSrc =
            c.card_faces[0].image_uris.png || c.card_faces[0].image_uris.large;
          backPreviewSrc = c.card_faces[1].image_uris?.normal;
          backSrc =
            c.card_faces[1].image_uris?.png ||
            c.card_faces[1].image_uris?.large;
        } else {
          previewSrc = c.image_uris?.normal;
          fullSrc = c.image_uris?.png || c.image_uris?.large;
        }

        return {
          id: c.id,
          name: c.name,
          set: c.set.toUpperCase(),
          setName: c.set_name,
          cn: c.collector_number,
          year: c.released_at ? c.released_at.substring(0, 4) : "????",
          previewSrc,
          fullSrc,
          backPreviewSrc,
          backSrc,
          artist: c.artist || "",
          frame: c.frame || "",
          border: c.border_color || "",
          games: c.games || [],
          full_art: c.full_art || false,
          textless: c.textless || false,
          lang: c.lang,
          cmc:
            c.cmc !== undefined
              ? c.cmc
              : c.card_faces
                ? c.card_faces[0].cmc
                : 0,
          color: c.colors
            ? c.colors.join("")
            : c.card_faces
              ? (c.card_faces[0].colors || []).join("")
              : "",
          color_identity: c.color_identity || [],
          type_line:
            c.type_line || (c.card_faces ? c.card_faces[0].type_line : ""),
        };
      });
    },
  },
};
