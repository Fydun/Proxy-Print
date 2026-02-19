// --- Version Selection Mixin ---
// Version modal, custom uploads, version selection, card dragging

export default {
  methods: {
    async openVersionSelectModal(index, preserveLang = false) {
      const card = this.cards[index];
      this.activeCardIndex = index;
      this.showVersionModal = true;
      this.versionList = [];
      this.versionSearchQuery = "";

      // 1. Initialize History Array if missing
      if (!card.customImages) card.customImages = [];

      // 2. AUTO-SAVE: If current card is Custom/Local, save it to history immediately
      // This prevents losing it if the user switches to a real card 5 seconds later.
      if (card.set === "CUST" || card.set === "Local") {
        if (!card.customImages.includes(card.src)) {
          card.customImages.unshift(card.src);
        }
      }

      // 3. Set Active Version for UI Highlighting
      this.activeVersion = {
        set: card.set,
        cn: card.cn,
        src: card.src,
      };

      if (!preserveLang) {
        this.versionLang = card.lang || "en";
      }

      this.isFetchingVersions = true;
      this.versionShowBack = card.name.includes("(Back)");

      // 4. Build Custom Options List from History
      const customSet = new Set(card.customImages);

      let customIndex = 1;
      customSet.forEach((src) => {
        this.versionList.push({
          id: `custom-${customIndex++}`,
          set: "CUST",
          setName: "Custom / Local File",
          cn: "---",
          year: "Custom",
          previewSrc: src,
          fullSrc: src,
          backSrc: card.backSrc,
          backPreviewSrc: card.backSrc,
          name: card.name,
        });
      });

      const cacheKey =
        card.oracle_id ||
        card.name.replace(" (Front)", "").replace(" (Back)", "");
      const fullCacheKey = `${cacheKey}_${this.versionLang}`;

      // 1. In-memory cache (instant)
      if (this.versionCache.has(fullCacheKey)) {
        this.versionList.push(...this.versionCache.get(fullCacheKey));
        this.isFetchingVersions = false;
        return;
      }

      // 2. IDB cache (survives page reloads)
      const idbCached = await this.getCachedVersions(fullCacheKey);
      if (idbCached) {
        this.versionCache.set(fullCacheKey, idbCached);
        this.versionList.push(...idbCached);
        this.isFetchingVersions = false;
        return;
      }

      try {
        let query = "";
        if (card.oracle_id) {
          query = `oracle_id:${card.oracle_id} include:extras unique:prints`;
        } else {
          const searchName = card.name
            .replace(" (Front)", "")
            .replace(" (Back)", "");
          query = `!"${searchName}" include:extras unique:prints`;
        }

        if (this.versionLang && this.versionLang !== "en") {
          query += ` lang:${this.versionLang}`;
        }

        const encodedQuery = encodeURIComponent(query);
        let url = `https://api.scryfall.com/cards/search?q=${encodedQuery}&order=released&dir=desc`;
        let hasMore = true;
        let accumulatedVersions = [];

        while (hasMore && this.showVersionModal) {
          const res = await fetch(url);
          const data = await res.json();
          if (data.data) {
            const scryfallVersions = data.data.filter((c) => c.image_status !== 'placeholder').map((c) => {
              let previewSrc = "",
                fullSrc = "",
                backSrc = null,
                backPreviewSrc = null;
              if (c.card_faces && c.card_faces[0].image_uris) {
                previewSrc = c.card_faces[0].image_uris.normal;
                fullSrc =
                  c.card_faces[0].image_uris.png ||
                  c.card_faces[0].image_uris.large;
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
                  c.type_line ||
                  (c.card_faces ? c.card_faces[0].type_line : ""),
              };
            });
            this.versionList.push(...scryfallVersions);
            accumulatedVersions.push(...scryfallVersions);
          }
          if (data.has_more && data.next_page) {
            url = data.next_page;
            await new Promise((r) => setTimeout(r, 100));
          } else {
            hasMore = false;
          }
        }
        if (!hasMore) {
          this.versionCache.set(fullCacheKey, accumulatedVersions);
          this.cacheVersions(fullCacheKey, accumulatedVersions);
        }
      } catch (e) {
        console.error("Error fetching versions", e);
        if (this.versionList.length === 0) {
          if (this.versionLang !== "en") {
            this.errorMessage = `No cards found in ${this.versionLang.toUpperCase()}.`;
          } else {
            this.errorMessage = "Failed to fetch card versions.";
          }
        }
      } finally {
        this.isFetchingVersions = false;
      }
    },
    handleCustomVersionUpload(file) {
      if (!file || this.activeCardIndex === null) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const card = this.cards[this.activeCardIndex];
        const newSrc = e.target.result;

        if (!card.customImages) card.customImages = [];

        card.customImages = card.customImages.filter((img) => img !== newSrc);
        card.customImages.unshift(newSrc);

        card.src = newSrc;
        card.set = "CUST";
        card.setName = "Custom Image";
        card.cn = "";
        card.backSrc = null;
        card.dfcData = null;

        this.showVersionModal = false;
        this.activeCardIndex = null;
      };
      reader.readAsDataURL(file);
    },

    selectVersion(version) {
      if (this.activeCardIndex === null) return;
      const card = this.cards[this.activeCardIndex];

      // 1. Update Metadata
      if (version.id !== "custom-current" && version.set !== "CUST") {
        this.preferredVersions[
          card.dfcData ? card.dfcData.originalName : card.name
        ] = {
          set: version.set,
          cn: version.cn,
          src: version.fullSrc,
          backSrc: version.backSrc,
          oracle_id: card.oracle_id,
        };
      }

      card.set = version.set;
      card.setName = version.setName;
      card.cn = version.cn;
      card.lang = version.lang;

      // Update Stats
      if (version.cmc !== undefined) {
        card.cmc = version.cmc;
        card.color = version.color;
        card.type_line = version.type_line;
        card.color_identity = version.color_identity;
      }

      // 2. Logic for SPLIT Cards (Front or Back halves)
      if (card.isFrontFace || card.isBackFace) {
        // Determine the correct name for this face
        let newFaceName = version.name; // Default to full name
        if (version.name && version.name.includes(" // ")) {
          const parts = version.name.split(" // ");
          newFaceName = card.isBackFace ? parts[1] || parts[0] : parts[0];
        }
        card.name = newFaceName;

        // Determine the correct image
        if (card.isBackFace) {
          // If we are the back face, take the back image (or front if no back exists)
          card.src = version.backSrc || version.fullSrc;
          card.smallSrc = version.backPreviewSrc || version.previewSrc || card.src;
        } else {
          // If we are front face, always take front
          card.src = version.fullSrc;
          card.smallSrc = version.previewSrc || card.src;
        }

        // IMPORTANT: Ensure it stays single-sided!
        card.backSrc = null;

        // Update the DFC Reference so Restore works correctly later
        if (card.dfcData) {
          card.dfcData.frontSrc = version.fullSrc;
          card.dfcData.backSrc = version.backSrc;
          card.dfcData.originalName = version.name;
        }
      } else {
        // 3. Logic for Standard Cards (Whole)
        card.name = version.name || card.name;

        const isVisualBack = card.name.includes("(Back)"); // Legacy check

        if (isVisualBack) {
          card.src = version.backSrc || version.fullSrc;
          card.smallSrc = version.backPreviewSrc || version.previewSrc || card.src;
        } else {
          card.src = version.fullSrc;
          card.smallSrc = version.previewSrc || card.src;
        }

        if (version.backSrc) {
          card.backSrc =
            isVisualBack || card.name.includes("(Front)")
              ? null
              : version.backSrc;
          card.smallBackSrc =
            isVisualBack || card.name.includes("(Front)")
              ? null
              : (version.backPreviewSrc || version.backSrc);
          card.dfcData = {
            frontSrc: version.fullSrc,
            backSrc: version.backSrc,
            originalName: version.name,
          };
        } else {
          card.backSrc = null;
          card.smallBackSrc = null;
          card.dfcData = null;
        }
      }

      this.loadLocalImages();
      this.showVersionModal = false;
      this.activeCardIndex = null;
    },
    onVersionLangChange() {
      if (this.activeCardIndex !== null) {
        // Don't clear the whole cache — just re-open, which will check
        // for cached results for the new language
        this.openVersionSelectModal(this.activeCardIndex, true);
      }
    },
    handleVersionDrop(e) {
      this.isDraggingOverModal = false;
      const files = e.dataTransfer.files;
      if (files.length > 0 && this.activeCardIndex !== null) {
        this.handleCustomVersionUpload(files[0]);
      }
    },

    /* --- Card Dragging Logic --- */
    onCardDragStart(e, index) {
      this.draggedCardIndex = index;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", index);
    },
    onCardDragEnd() {
      this.draggedCardIndex = null;
    },
    onCardDrop(e, targetIndex) {
      this.draggedCardIndex = null;
      const srcIndex = parseInt(e.dataTransfer.getData("text/plain"));
      if (!isNaN(srcIndex) && srcIndex !== targetIndex) {
        const item = this.cards.splice(srcIndex, 1)[0];
        this.cards.splice(targetIndex, 0, item);
      }
    },
  },
};
