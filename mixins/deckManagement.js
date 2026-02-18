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

      const snapshotCard = (card) => {
        const currentLocalUrls = {};
        [card.src, card.smallSrc, card.backSrc, card.smallBackSrc].forEach(u => {
          if (u && this.localImages[u]) currentLocalUrls[u] = this.localImages[u];
        });
        return {
          src: card.src,
          smallSrc: card.smallSrc,
          backSrc: card.backSrc,
          smallBackSrc: card.smallBackSrc,
          set: card.set,
          cn: card.cn,
          dfcData: card.dfcData ? { ...card.dfcData } : null,
          localUrls: currentLocalUrls,
        };
      };

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
          localUrls: {},
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

      // --- Phase 2: Batch fetch from Scryfall using /cards/collection ---
      if (needsFetch.length > 0) {
        const BATCH_SIZE = 75;
        for (let i = 0; i < needsFetch.length; i += BATCH_SIZE) {
          const batch = needsFetch.slice(i, i + BATCH_SIZE);

          // Build identifiers: use English set/cn for exact match in target language
          const identifiers = batch.map((card) => {
            const enSnapshot = card.langCache['en'];
            const lookupSet = (enSnapshot?.set || card.set).toLowerCase();
            const lookupCn = enSnapshot?.cn || card.cn;
            return { set: lookupSet, collector_number: lookupCn };
          });

          try {
            // Try exact printings in the target language via collection endpoint
            const res = await fetch(
              "https://api.scryfall.com/cards/collection",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifiers }),
              },
            );
            const data = await res.json();

            // Build lookup map from results
            const foundMap = new Map();
            if (data.data) {
              data.data.forEach((c) => {
                const key = `${c.set.toLowerCase()}_${c.collector_number}`;
                foundMap.set(key, c);
              });
            }

            // Apply results and identify cards that need individual fallback
            const fallbackCards = [];
            for (let j = 0; j < batch.length; j++) {
              const card = batch[j];
              const id = identifiers[j];
              const key = `${id.set}_${id.collector_number}`;
              let matchData = foundMap.get(key);

              // Check if returned card is actually in the target language
              if (matchData && matchData.lang !== targetLang) {
                // Collection returns English by default — try the lang endpoint
                try {
                  const langRes = await fetch(
                    `https://api.scryfall.com/cards/${id.set}/${id.collector_number}/${targetLang}`,
                  );
                  if (langRes.ok) {
                    const langData = await langRes.json();
                    if (langData.image_status !== 'placeholder') {
                      matchData = langData;
                    } else {
                      matchData = null;
                    }
                  } else {
                    matchData = null;
                  }
                  await new Promise((r) => setTimeout(r, 75));
                } catch {
                  matchData = null;
                }
              }

              // Skip placeholders
              if (matchData && matchData.image_status === 'placeholder') {
                matchData = null;
              }

              if (matchData) {
                applyCardData(card, matchData);
                updatedCount++;
              } else {
                fallbackCards.push(card);
              }
              this.langChangeCurrent++;
            }

            // Fallback: for cards not found via exact match, try search
            for (const card of fallbackCards) {
              try {
                let query = `lang:${targetLang} unique:prints`;
                if (card.oracle_id) {
                  query += ` oracle_id:${card.oracle_id}`;
                } else {
                  const cleanName = card.name
                    .split(" // ")[0]
                    .replace(/ \(.*?\)/g, "");
                  query += ` !"${cleanName}"`;
                }

                const searchRes = await fetch(
                  `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=released`,
                );
                if (searchRes.ok) {
                  const searchData = await searchRes.json();
                  const match = searchData.data?.find(c => c.image_status !== 'placeholder') || null;
                  if (match) {
                    applyCardData(card, match);
                    updatedCount++;
                  } else {
                    card.langCache[targetLang] = null;
                    failedCount++;
                  }
                } else {
                  card.langCache[targetLang] = null;
                  failedCount++;
                }
              } catch (e) {
                console.error(`Failed to translate ${card.name}`, e);
                failedCount++;
              }
              await new Promise((r) => setTimeout(r, 75));
            }
          } catch (e) {
            console.error("Batch language change error", e);
            batch.forEach(() => failedCount++);
            this.langChangeCurrent += batch.length;
          }

          // Delay between batches
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      this.langChangeTotal = 0;
      this.langChangeCurrent = 0;
      this.saveSession();
      this.loadLocalImages();

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
