// --- Sorting Mixin ---
// WUBRG scoring, type/color ranking, card categorization, sort logic

export default {
  methods: {
    // ---------------------------------------------------------
    //              SORTING HELPERS & LOGIC
    // ---------------------------------------------------------

    // Helper: Calculates a score for WUBRG order
    // Mono: W(1), U(2), B(3), R(4), G(5)
    // Pairs/Trios are weighted higher to appear after mono colors
    // --- SORTING HELPERS ---

    getWUBRGScore(cStr) {
      const raw = Array.isArray(cStr)
        ? cStr.join("")
        : cStr === undefined || cStr === null
          ? ""
          : String(cStr);
      const cleaned = raw.toUpperCase().replace(/[^WUBRG]/g, "");
      if (cleaned.length === 0) return 999; // Truly Colorless (Wastes, Sol Ring)

      // Normalize string (e.g., "GW" -> "GW")
      // Note: Scryfall usually pre-sorts these, but we ensure it.
      const norm = cleaned
        .split("")
        .sort((a, b) => "WUBRG".indexOf(a) - "WUBRG".indexOf(b))
        .join("");

      const weights = {
        W: 1,
        U: 2,
        B: 3,
        R: 4,
        G: 5,
        // Allied
        WU: 6,
        UB: 7,
        BR: 8,
        RG: 9,
        GW: 10,
        WG: 10,
        // Enemy
        WB: 11,
        BW: 11,
        BG: 12,
        GB: 12,
        GU: 13,
        UG: 13,
        UR: 14,
        RU: 14,
        RW: 15,
        WR: 15,
      };

      if (weights[norm]) return weights[norm];

      // 3+ Colors: Sort by length (Trios < 4c < 5c)
      return 50 + norm.length;
    },

    calculateTypeRank(typeLine) {
      if (!typeLine) return 99;
      let t = typeLine.toLowerCase();
      // Remove supertypes to find the "Real" type
      t = t.replace(/\b(basic|legendary|ongoing|snow|world)\b/g, "").trim();

      if (t.includes("creature")) return 1;
      if (t.includes("planeswalker")) return 2;
      if (t.includes("sorcery")) return 3;
      if (t.includes("instant")) return 4;
      if (t.includes("artifact")) return 5;
      if (t.includes("enchantment")) return 6;
      if (t.includes("battle")) return 7;
      if (t.includes("land")) return 8;
      return 99;
    },

    normalizeCmc(value) {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    },

    ensureOriginalOrder() {
      let nextIndex = 0;
      this.cards.forEach((card) => {
        if (Number.isFinite(card._originalIndex)) {
          nextIndex = Math.max(nextIndex, card._originalIndex + 1);
        }
      });

      this.cards.forEach((card) => {
        if (!Number.isFinite(card._originalIndex)) {
          card._originalIndex = nextIndex;
          nextIndex += 1;
        }
      });
    },

    calculateColorRank(card) {
      const type = (card.type_line || "").toLowerCase();
      const rawColors = card.color !== undefined ? card.color : card.colors || "";
      const castingColors = Array.isArray(rawColors)
        ? rawColors.join("")
        : rawColors === undefined || rawColors === null
          ? ""
          : String(rawColors);
      const normalizedCasting = castingColors
        .toUpperCase()
        .replace(/[^WUBRG]/g, "");
      const hasCastingColor = normalizedCasting.length > 0;

      // Derive Color Identity Signature (Sorted String W->U->B->R->G)
      let identitySignature = "";
      if (card.color_identity && Array.isArray(card.color_identity)) {
        const order = "WUBRG";
        identitySignature = [...card.color_identity]
          .map((c) => String(c).toUpperCase())
          .sort((a, b) => order.indexOf(a) - order.indexOf(b))
          .join("")
          .replace(/[^WUBRG]/g, "");
      }

      let categoryScore = 0;
      let signature = normalizedCasting;

      // 1. COLORED CARDS (Top Priority)
      // Includes Creatures, Instants, Colored Artifacts, and Dryad Arbor
      if (hasCastingColor) {
        categoryScore = 0;
        signature = castingColors;
      }
      // 2. COLORLESS LANDS (Lowest Priority)
      // Includes Basics, Shocks, Fetches, Artifact Lands (Tree of Tales)
      else if (type.includes("land")) {
        categoryScore = 4000;
        signature = identitySignature;
      }
      // 3. COLORLESS ARTIFACTS
      // Includes Sol Ring, Signets
      else if (type.includes("artifact")) {
        categoryScore = 3000;
        signature = identitySignature;
      }
      // 4. TRUE COLORLESS
      // Includes Eldrazi, Karn, Ugin
      else {
        categoryScore = 2000;
        signature = identitySignature;
      }

      return categoryScore + this.getWUBRGScore(signature);
    },

    // Helper: Distinguish "Real Cards" (0) from "Extras/Tokens" (1)
    getCardCategory(card) {
      const type = (card.type_line || "").toLowerCase();
      const name = (card.name || "").toLowerCase();
      const layout = (card.layout || "").toLowerCase();

      // 1. Explicit Types
      if (type.includes("token")) return 1;
      if (type.includes("emblem")) return 1;
      if (type.includes("dungeon")) return 1;
      if (type.includes("plane") && !type.includes("planeswalker")) return 1;
      if (type.includes("phenomenon")) return 1;
      if (type.includes("scheme")) return 1;
      if (type.includes("vanguard")) return 1;

      // 2. Specific Mechanics (Monarch, Initiative, etc.)
      const mechanics = [
        "the monarch",
        "the initiative",
        "the city's blessing",
        "day // night",
        "the ring", // The Ring emblem
      ];
      if (
        mechanics.some(
          (m) => name === m || name.includes("the ring tempts you"),
        )
      )
        return 1;

      // 3. Meld Results (The giant backsides)
      // These look like real creatures but belong in the token pile
      const meldBacks = [
        "brisela, voice of nightmares",
        "hanweir, the writhing township",
        "chittering host",
        "withengar unbound",
        "ormendahl, profane prince",
        "urza, planeswalker",
        "mishra, lost to phyrexia",
        "titania, gaea incarnate",
      ];
      if (meldBacks.includes(name)) return 1;

      // 4. Fallback: If Set code starts with 'T' (e.g. TAFR), it's likely a token
      if (card.set && card.set.startsWith("T") && card.set.length === 4)
        return 1;

      return 0; // It's a real card
    },

    sortCards(key) {
      this.ensureOriginalOrder();
      // Build a lightweight fingerprint of the current card order
      const fingerprint = this.cards.map(c => `${c.name}\0${c.set}\0${c.cn}`).join('|');

      // Only reverse if same sort key AND list hasn't been modified since last sort
      if (this.sortState.key === key && this._sortFingerprint === fingerprint) {
        this.sortState.order = this.sortState.order === "asc" ? "desc" : "asc";
      } else {
        this.sortState.key = key;
        this.sortState.order = "asc";
      }

      const modifier = this.sortState.order === "asc" ? 1 : -1;

      // Auto sort: Cards first, then Color > Type > CMC > Name
      if (key === "auto") {
        const getVal = (card, sortKey) => {
          if (sortKey === "color") return this.calculateColorRank(card);
          if (sortKey === "type") return this.calculateTypeRank(card.type_line);
          if (sortKey === "cmc") return this.normalizeCmc(card.cmc);
          if (sortKey === "name") return (card.name || "").toLowerCase();
          if (sortKey === "tokens") return this.getCardCategory(card);
          return 0;
        };

        const passes = ["name", "color", "cmc", "type", "tokens"];
        passes.forEach((passKey) => {
          this.cards.sort((a, b) => {
            const valA = getVal(a, passKey);
            const valB = getVal(b, passKey);

            if (valA < valB) return -1 * modifier;
            if (valA > valB) return 1 * modifier;
            return 0;
          });
        });
      } else {
        this.cards.sort((a, b) => {
          let valA, valB;

        if (key === "color") {
          valA = this.calculateColorRank(a);
          valB = this.calculateColorRank(b);
        } else if (key === "type") {
          // Determine rank (1=Battle ... 8=Land, 99=Other)
          valA = this.calculateTypeRank(a.type_line);
          valB = this.calculateTypeRank(b.type_line);
        } else if (key === "name") {
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
        } else if (key === "cmc") {
          valA = this.normalizeCmc(a.cmc);
          valB = this.normalizeCmc(b.cmc);
        } else if (key === "dfc") {
          valA = !!a.backSrc ? 0 : 1;
          valB = !!b.backSrc ? 0 : 1;
        } else if (key === "original") {
          valA = Number.isFinite(a._originalIndex) ? a._originalIndex : 0;
          valB = Number.isFinite(b._originalIndex) ? b._originalIndex : 0;
        } else if (key === "tokens") {
          // Use new helper to categorize Cards (0) vs Extras (1)
          valA = this.getCardCategory(a);
          valB = this.getCardCategory(b);
        } else if (key === "lang") {
          valA = (a.lang || 'en').toLowerCase();
          valB = (b.lang || 'en').toLowerCase();
        } else {
          return 0;
        }

        if (valA < valB) return -1 * modifier;
        if (valA > valB) return 1 * modifier;

        // STABLE SORT: If values are equal, return 0.
        // This tells JS to keep them in their current relative positions.
        return 0;
      });
      }

      // Snapshot the sorted order so we know if it changes before next sort click
      this._sortFingerprint = this.cards.map(c => `${c.name}\0${c.set}\0${c.cn}`).join('|');
      this.showSortMenu = false;
    },
  },
};
