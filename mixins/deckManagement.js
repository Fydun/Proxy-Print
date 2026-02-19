// --- Deck Management Mixin ---
// Card add/remove, language change, deck editing, sorting

export default {
  methods: {
    removeCard(index) {
      this.cards.splice(index, 1);
    },
    confirmClear() {
      if (confirm("Clear entire deck?")) this.cards = [];
    },
    setMassQty(q) {
      this.cards.forEach((c) => {
        if (c.selected) c.qty = q;
      });
    },
    async massChangeLanguage(targetLang) {
      const selectedCards = this.cards.filter((c) => c.selected);
      if (selectedCards.length === 0) return;

      let updatedCount = 0;
      let failedCount = 0;
      const eligibleCards = selectedCards.filter(c => c.set !== "Local" && c.lang !== targetLang);
      this.langChangeTotal = eligibleCards.length;
      this.langChangeCurrent = 0;
      if (eligibleCards.length === 0) return;

      // Helper to extract image URI safely
      const getImg = (cData) => {
        if (cData.card_faces && cData.card_faces[0].image_uris) {
          return (
            cData.card_faces[0].image_uris.png ||
            cData.card_faces[0].image_uris.large
          );
        }
        return cData.image_uris?.png || cData.image_uris?.large;
      };
      const getBackImg = (cData) => {
        if (cData.card_faces && cData.card_faces[1].image_uris) {
          return (
            cData.card_faces[1].image_uris.png ||
            cData.card_faces[1].image_uris.large
          );
        }
        return null;
      };

      // Helper functions for applying Scryfall data to a card
      const getSmallImg = (cData) => {
        if (cData.card_faces && cData.card_faces[0].image_uris) {
          return cData.card_faces[0].image_uris.small || cData.card_faces[0].image_uris.normal || getImg(cData);
        }
        return cData.image_uris?.small || cData.image_uris?.normal || getImg(cData);
      };
      const getSmallBackImg = (cData) => {
        if (cData.card_faces && cData.card_faces[1]?.image_uris) {
          return cData.card_faces[1].image_uris.small || cData.card_faces[1].image_uris.normal || getBackImg(cData);
        }
        return null;
      };

      const snapshotCard = (card) => ({
        src: card.src,
        smallSrc: card.smallSrc,
        backSrc: card.backSrc,
        smallBackSrc: card.smallBackSrc,
        set: card.set,
        cn: card.cn,
        dfcData: card.dfcData ? { ...card.dfcData } : null,
      });

      const applyCardData = (card, newData) => {
        card.langCache[card.lang] = snapshotCard(card);

        card.src = getImg(newData);
        card.smallSrc = getSmallImg(newData);

        const newBack = getBackImg(newData);
        if (newBack) {
          card.backSrc = newBack;
          card.smallBackSrc = getSmallBackImg(newData);
          card.dfcData = { frontSrc: card.src, backSrc: newBack };
        }

        card.set = newData.set.toUpperCase();
        card.cn = newData.collector_number;
        card.lang = targetLang;
        if (newData.artist) card.artist = newData.artist;

        card.langCache[targetLang] = {
          src: card.src,
          smallSrc: card.smallSrc,
          backSrc: card.backSrc,
          smallBackSrc: card.smallBackSrc,
          set: card.set,
          cn: card.cn,
          dfcData: card.dfcData ? { ...card.dfcData } : null,
        };
      };

      // --- Phase 1: Restore from cache (instant, no network) ---
      const needsFetch = [];
      for (const card of eligibleCards) {
        if (!card.langCache) card.langCache = {};
        if (targetLang in card.langCache) {
          const cached = card.langCache[targetLang];
          if (cached === null) {
            failedCount++;
            this.langChangeCurrent++;
            continue;
          }
          card.langCache[card.lang] = snapshotCard(card);
          card.src = cached.src;
          card.smallSrc = cached.smallSrc;
          card.backSrc = cached.backSrc || null;
          card.smallBackSrc = cached.smallBackSrc || null;
          card.set = cached.set;
          card.cn = cached.cn;
          card.dfcData = cached.dfcData || null;
          card.lang = targetLang;
          if (cached.localUrls) {
            Object.assign(this.localImages, cached.localUrls);
          }
          updatedCount++;
          this.langChangeCurrent++;
          continue;
        }
        needsFetch.push(card);
      }

      // --- Phase 2: Fetch from Scryfall, deduplicated + parallelized ---
      // If you have 4x Lightning Bolt (DMR, 123), we only call Scryfall once
      // for that printing instead of 4 times.
      if (needsFetch.length > 0) {
        // Group cards by unique printing (set + collector number)
        const printGroups = new Map();
        for (const card of needsFetch) {
          const enSnapshot = card.langCache['en'];
          const lookupSet = (enSnapshot?.set || card.set).toLowerCase();
          const lookupCn = enSnapshot?.cn || card.cn;
          const key = `${lookupSet}_${lookupCn}`;
          if (!printGroups.has(key)) {
            printGroups.set(key, { set: lookupSet, cn: lookupCn, cards: [] });
          }
          printGroups.get(key).cards.push(card);
        }

        const uniquePrintings = Array.from(printGroups.values());

        // 2a. Batch IDB cache check — single transaction instead of N serial reads
        const langCacheKeys = uniquePrintings.map(
          (g) => `lang_${g.set}_${g.cn}_${targetLang}`,
        );
        let cachedLangResults;
        try {
          cachedLangResults = await this.getBatchFromCache(langCacheKeys);
        } catch {
          cachedLangResults = new Map();
        }

        // Apply IDB hits immediately, collect network misses
        const needsNetwork = [];
        for (let i = 0; i < uniquePrintings.length; i++) {
          const group = uniquePrintings[i];
          const cached = cachedLangResults.get(langCacheKeys[i]);
          if (cached !== undefined) {
            if (cached && !cached._miss && cached.image_status !== "placeholder") {
              for (const card of group.cards) {
                applyCardData(card, cached);
                updatedCount++;
                this.langChangeCurrent++;
              }
            } else {
              // Known miss — previously confirmed unavailable in this language
              for (const card of group.cards) {
                card.langCache[targetLang] = null;
                failedCount++;
                this.langChangeCurrent++;
              }
            }
          } else {
            needsNetwork.push(group);
          }
        }

        // 2b. Parallel Scryfall fetch (4 concurrent — respects ~10 req/s rate limit)
        const CONCURRENCY = 4;
        const fallbackGroups = [];

        const fetchLangForGroup = async (group) => {
          try {
            const res = await fetch(
              `https://api.scryfall.com/cards/${group.set}/${group.cn}/${targetLang}`,
            );
            const cacheKey = `lang_${group.set}_${group.cn}_${targetLang}`;
            if (res.ok) {
              const data = await res.json();
              if (data.image_status !== "placeholder") {
                this.saveToCache(cacheKey, data); // fire-and-forget
                for (const card of group.cards) {
                  applyCardData(card, data);
                  updatedCount++;
                  this.langChangeCurrent++;
                }
                return;
              }
            }
            // Not found or placeholder — cache the miss
            this.saveToCache(cacheKey, { _miss: true });
            fallbackGroups.push(group);
          } catch {
            fallbackGroups.push(group); // network error → try fallback search
          }
        };

        for (let i = 0; i < needsNetwork.length; i += CONCURRENCY) {
          const chunk = needsNetwork.slice(i, i + CONCURRENCY);
          await Promise.all(chunk.map(fetchLangForGroup));
          // Small gap between chunks to stay well under Scryfall's rate limit
          if (i + CONCURRENCY < needsNetwork.length) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }

        // Start thumbnails + high-res caching NOW for cards already switched,
        // don't wait for the (rare) fallback search path below
        this.loadLocalImages();
        this.runPrefetch();

        // 2c. Fallback name search for printings that failed direct lookup
        const fallbackFetch = async (group) => {
          const representative = group.cards[0];
          try {
            let query = `lang:${targetLang} unique:prints`;
            if (representative.oracle_id) {
              query += ` oracle_id:${representative.oracle_id}`;
            } else {
              const cleanName = representative.name
                .split(" // ")[0]
                .replace(/ \(.*?\)/g, "");
              query += ` !"${cleanName}"`;
            }

            const searchRes = await fetch(
              `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=released`,
            );
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              const match =
                searchData.data?.find(
                  (c) => c.image_status !== "placeholder",
                ) || null;
              if (match) {
                for (const card of group.cards) {
                  applyCardData(card, match);
                  updatedCount++;
                  this.langChangeCurrent++;
                }
                return;
              }
            }
            for (const card of group.cards) {
              card.langCache[targetLang] = null;
              failedCount++;
              this.langChangeCurrent++;
            }
          } catch (e) {
            console.error(`Failed to translate ${representative.name}`, e);
            for (const card of group.cards) {
              failedCount++;
              this.langChangeCurrent++;
            }
          }
        };

        // Fallback searches also parallelized (2 at a time — search endpoint is heavier)
        for (let i = 0; i < fallbackGroups.length; i += 2) {
          const chunk = fallbackGroups.slice(i, i + 2);
          await Promise.all(chunk.map(fallbackFetch));
          if (i + 2 < fallbackGroups.length) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      }

      this.langChangeTotal = 0;
      this.langChangeCurrent = 0;
      this.saveSession();
      this.loadLocalImages();
      this.runPrefetch();

      if (failedCount > 0) {
        this.statusMessage = `Updated ${updatedCount} card(s) to ${targetLang.toUpperCase()}. ${failedCount} card(s) not available in that language.`;
      } else {
        this.statusMessage = `Updated ${updatedCount} card(s) to ${targetLang.toUpperCase()}.`;
      }

      // Clear message after 3 seconds
      setTimeout(() => {
        this.statusMessage = "";
      }, 3000);
    },

    deleteSelected() {
      if (confirm(`Delete ${this.selectedCount} selected cards?`)) {
        this.cards = this.cards.filter((c) => !c.selected);
      }
    },

    openDeckEditor() {
      // Converts current deck back to text format
      const lines = this.cards
        .filter((c) => c.set !== "Local")
        .map((c) => {
          let name = c.name.replace(" (Front)", "").replace(" (Back)", "");
          const langTag =
            c.lang && c.lang !== "en" ? ` [${c.lang.toUpperCase()}]` : "";
          return c.set && c.cn
            ? `${c.qty} ${name} (${c.set}) ${c.cn}${langTag}`
            : `${c.qty} ${name}${langTag}`;
        });
      this.importText = lines.join("\n");
      this.showImportModal = true;
      this.importErrors = [];
    },
    copyDecklist() {
      navigator.clipboard.writeText(this.importText);
    },
  },
};
