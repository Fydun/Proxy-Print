// --- Token & DFC Management Mixin ---
// Split/restore DFC, token fetching, token resolution

export default {
  methods: {
    splitCard(index) {
      const card = this.cards[index];
      if (!card.backSrc) return;

      // 1. Prepare DFC Data
      if (!card.dfcData) {
        card.dfcData = { frontSrc: card.src, backSrc: card.backSrc };
      }
      if (!card.dfcData.originalName) {
        card.dfcData.originalName = card.name;
      }

      // 2. Determine Clean Names
      // We explicitly look for the separator.
      const separator = " // ";
      let frontName = card.name;
      let backName = card.name; // Default fallback

      if (card.name.includes(separator)) {
        const parts = card.name.split(separator);
        frontName = parts[0];
        backName = parts[1];
      } else {
        // Fallback: If no separator, append markers so user knows which is which
        // (Only happens for custom files or single-name DFCs)
        frontName = card.name + " (Front)";
        backName = card.name + " (Back)";
      }

      // 3. Create Back Card
      const backCard = {
        name: backName,
        src: card.backSrc,
        qty: card.qty,
        set: card.set,
        cn: card.cn,
        setName: card.setName,
        backSrc: null, // Single-sided
        showBack: false,
        dfcData: { ...card.dfcData },
        selected: false,
        oracle_id: card.oracle_id,
        lang: card.lang,
        cmc: card.cmc,
        color: card.color,
        type_line: card.type_line,
        isBackFace: true, // <--- FLAG
      };

      // 4. Update Front Card
      card.name = frontName;
      card.backSrc = null; // Single-sided
      card.isFrontFace = true; // <--- FLAG

      // 5. Insert
      this.cards.splice(index + 1, 0, backCard);
    },
    restoreDFC(index) {
      const card = this.cards[index];
      if (!card.dfcData) return;

      // 1. Identify Partner
      let partnerIndex = -1;
      if (
        index + 1 < this.cards.length &&
        this.cards[index + 1].oracle_id === card.oracle_id
      ) {
        partnerIndex = index + 1;
      } else if (
        index > 0 &&
        this.cards[index - 1].oracle_id === card.oracle_id
      ) {
        partnerIndex = index - 1;
      }

      // 2. Remove Partner
      if (partnerIndex !== -1) {
        this.cards.splice(partnerIndex, 1);
      }

      // 3. Restore
      card.name = card.dfcData.originalName || card.name;
      card.src = card.dfcData.frontSrc;
      card.backSrc = card.dfcData.backSrc;

      // 4. CLEANUP FLAGS (Crucial!)
      delete card.isFrontFace;
      delete card.isBackFace;
    },
    groupDFCs() {
      this.cards.sort((a, b) => {
        const aIsDFC = !!a.backSrc;
        const bIsDFC = !!b.backSrc;
        if (aIsDFC && !bIsDFC) return -1;
        if (!aIsDFC && bIsDFC) return 1;
        return 0;
      });
    },

    isTokenOrHelper(part) {
      const type = (part.type_line || "").toLowerCase();
      const name = (part.name || "").toLowerCase();

      // 1. Official Tokens and Meld Results (The giant backside)
      if (part.component === "token") return true;
      if (part.component === "meld_result") return true;

      // 2. Mechanics via Name (Monarch, Initiative, City's Blessing, Ring, etc)
      if (name === "the monarch") return true;
      if (name === "the initiative") return true;
      if (name === "the city's blessing") return true;
      if (name === "day // night") return true;
      if (name.includes("the ring temps you")) return true;
      if (name === "the ring") return true; // "The Ring" emblem

      // 3. Card Types (Emblems, Dungeons, Planes)
      if (type.includes("emblem")) return true;
      if (type.includes("dungeon")) return true;
      if (type.includes("plane") && !type.includes("planeswalker")) return true; // Planechase
      if (type.includes("phenomenon")) return true;

      return false;
    },
    async fetchTokensForCard(index) {
      const card = this.cards[index];
      if (card.set === "Local" && !card.cn) {
        this.errorMessage = `Cannot fetch tokens for local file "${card.name}".`;
        return;
      }
      this.isFetchingTokens = true;
      try {
        // Use stored all_parts if available (saved at import time), otherwise fetch
        let allParts = card.all_parts;
        if (!allParts) {
          const identifier =
            card.set !== "Local" && card.cn
              ? { set: card.set, collector_number: card.cn }
              : { name: card.name };
          const response = await fetch(
            "https://api.scryfall.com/cards/collection",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ identifiers: [identifier] }),
            },
          );
          const data = await response.json();
          if (data.data && data.data.length > 0) {
            allParts = data.data[0].all_parts;
            // Cache for future use
            card.all_parts = allParts || null;
          }
        }

        if (allParts) {
          const tokenIds = new Set();
          allParts.forEach((part) => {
            if (this.isTokenOrHelper(part)) {
              tokenIds.add(part.id);
            }
          });
          if (tokenIds.size > 0) {
            await this.resolveAndAddTokens(Array.from(tokenIds));
          } else {
            this.errorMessage = `No tokens found for ${card.name}`;
          }
        } else {
          this.errorMessage = `No tokens found for ${card.name}`;
        }
      } catch (e) {
        console.error("Token fetch error", e);
        this.errorMessage = "Failed to fetch tokens.";
      } finally {
        this.isFetchingTokens = false;
      }
    },
    async fetchAllTokens() {
      this.isFetchingTokens = true;
      this.statusMessage = "Scanning deck for tokens and mechanics...";

      const tokensToFetchIds = new Set();

      // 1. Collect token IDs from cards that already have all_parts cached
      const needsFetch = [];
      for (const c of this.cards) {
        if (c.set === "Local" && !c.cn) continue;
        if (c.layout === "token" || c.layout === "double_faced_token") continue;

        if (c.all_parts) {
          c.all_parts.forEach((part) => {
            if (this.isTokenOrHelper(part)) {
              tokensToFetchIds.add(part.id);
            }
          });
        } else {
          needsFetch.push(c);
        }
      }

      // 2. Only fetch cards that don't have all_parts stored
      if (needsFetch.length > 0) {
        const identifiers = needsFetch.map((c) =>
          c.set !== "Local" && c.cn
            ? { set: c.set, collector_number: c.cn }
            : { name: c.name },
        );

        const BATCH_SIZE = 75;
        const batches = [];
        for (let i = 0; i < identifiers.length; i += BATCH_SIZE)
          batches.push({ ids: identifiers.slice(i, i + BATCH_SIZE), cards: needsFetch.slice(i, i + BATCH_SIZE) });

        for (const batch of batches) {
          try {
            const res = await fetch("https://api.scryfall.com/cards/collection", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ identifiers: batch.ids }),
            });
            const data = await res.json();

            if (data.data) {
              data.data.forEach((scryCard) => {
                if (scryCard.layout === "token" || scryCard.layout === "double_faced_token")
                  return;

                // Cache all_parts on the matching deck card for future use
                const deckCard = batch.cards.find(
                  (c) =>
                    (c.set === scryCard.set.toUpperCase() && c.cn === scryCard.collector_number) ||
                    c.name.toLowerCase().startsWith(scryCard.name.toLowerCase().split(" // ")[0])
                );
                if (deckCard && scryCard.all_parts) {
                  deckCard.all_parts = scryCard.all_parts;
                }

                if (scryCard.all_parts) {
                  scryCard.all_parts.forEach((part) => {
                    if (this.isTokenOrHelper(part)) {
                      tokensToFetchIds.add(part.id);
                    }
                  });
                }
              });
            }
            // Be polite to API
            await new Promise((r) => setTimeout(r, 75));
          } catch (e) {
            console.error("Batch token scan error", e);
          }
        }
      }

      try {
        if (tokensToFetchIds.size > 0) {
          this.statusMessage = `Found ${tokensToFetchIds.size} tokens/markers. downloading...`;
          await this.resolveAndAddTokens(Array.from(tokensToFetchIds));
          this.statusMessage = "Tokens added successfully.";
        } else {
          this.errorMessage = "No tokens or extra parts found for this deck.";
        }
      } catch (e) {
        console.error("Token resolve error", e);
        this.errorMessage = "Failed to fetch tokens (Network/API Error).";
      } finally {
        this.isFetchingTokens = false;
        // Clear status after 3s
        setTimeout(() => {
          if (!this.errorMessage) this.statusMessage = "";
        }, 3000);
      }
    },

    async resolveAndAddTokens(tokenIds) {
      const BATCH_SIZE = 75;
      const batches = [];
      for (let i = 0; i < tokenIds.length; i += BATCH_SIZE)
        batches.push(tokenIds.slice(i, i + BATCH_SIZE));

      for (let batchIds of batches) {
        const identifiers = batchIds.map((id) => ({ id }));

        const res = await fetch("https://api.scryfall.com/cards/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers }),
        });
        const data = await res.json();

        if (data.data) {
          data.data.forEach((token) => {
            // Check if we already have this token in the deck list
            // matching by Oracle ID (best) or Set/CN
            const exists = this.cards.some((c) => {
              if (token.oracle_id && c.oracle_id === token.oracle_id)
                return true;
              return (
                c.set === token.set.toUpperCase() &&
                c.cn === token.collector_number
              );
            });

            if (exists) return;

            let src = "",
              backSrc = null,
              smallSrc = "",
              smallBackSrc = null;

            // Handle double-faced tokens (e.g. Incubator // Phyrexian)
            if (token.card_faces && token.card_faces[0].image_uris) {
              src =
                token.card_faces[0].image_uris.png ||
                token.card_faces[0].image_uris.large;
              smallSrc =
                token.card_faces[0].image_uris.small ||
                token.card_faces[0].image_uris.normal ||
                src;
              backSrc =
                token.card_faces[1].image_uris?.png ||
                token.card_faces[1].image_uris?.large;
              smallBackSrc =
                token.card_faces[1].image_uris?.small ||
                token.card_faces[1].image_uris?.normal ||
                backSrc;
            } else {
              src = token.image_uris?.png || token.image_uris?.large;
              smallSrc =
                token.image_uris?.small || token.image_uris?.normal || src;
            }

            if (src) {
              const newCard = {
                name: token.name,
                set: token.set.toUpperCase(),
                cn: token.collector_number,
                src,
                smallSrc,
                backSrc,
                smallBackSrc,
                showBack: false,
                qty: 1,
                dfcData: null,
                selected: false,
                isDuplex: false,
                oracle_id: token.oracle_id,
                lang: token.lang,
                all_parts: token.all_parts || null,
                cmc: token.cmc || 0,
                color: (token.colors || []).join(""),
                color_identity: token.color_identity || [],
                type_line: token.type_line || "",
              };

              if (backSrc) {
                newCard.dfcData = {
                  frontSrc: src,
                  backSrc: backSrc,
                };
              }
              this.cards.push(newCard);
            }
          });
        }
        await new Promise((r) => setTimeout(r, 75));
      }
    },
  },
};
