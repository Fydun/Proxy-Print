// --- File Handling Mixin ---
// Drag/Drop, Paste, local file uploads, Scryfall file identification

export default {
  methods: {
    handlePaste(e) {
      const items = e.clipboardData.items;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1)
          files.push(items[i].getAsFile());
      }
      if (files.length > 0) {
        e.preventDefault();
        this.processFiles(files);
      }
    },
    onDragEnter(e) {
      if (e.dataTransfer.types.includes("Files")) this.isDraggingFile = true;
    },
    onDragOver(e) {
      e.preventDefault();
    },
    onDragLeave(e) {
      if (e.relatedTarget === null) this.isDraggingFile = false;
    },
    onGlobalDrop(e) {
      e.preventDefault();
      this.isDraggingFile = false;
      if (this.showVersionModal) return;
      this.processFiles(e.dataTransfer.files);
    },

    handleFileSelect(event) {
      this.processFiles(event.target.files);
      event.target.value = "";
    },

    async processFiles(fileList) {
      // Handles local file uploads and tries to identify them via Scryfall API
      this.errorMessage = "";
      const filesToProcess = [];

      // 1. Read all files first
      for (const file of Array.from(fileList)) {
        if (!file.type.startsWith("image/")) continue;
        try {
          const result = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) =>
              resolve({
                originalName: file.name,
                cleanName: file.name
                  .replace(/\.[^/.]+$/, "")
                  .replace(/[_-]/g, " "),
                src: e.target.result,
              });
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          filesToProcess.push(result);
        } catch (e) {
          console.error("File read error", e);
        }
      }
      if (filesToProcess.length === 0) return;

      // 2. Batch identify against Scryfall
      const BATCH_SIZE = 75;
      const batches = [];
      for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE)
        batches.push(filesToProcess.slice(i, i + BATCH_SIZE));

      for (let batch of batches) {
        const identifiers = batch.map((f) => ({ name: f.cleanName }));
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

          // Create map for O(1) lookups
          const foundMap = new Map();
          if (data.data) {
            data.data.forEach((card) => {
              foundMap.set(card.name.toLowerCase(), card);
              if (card.card_faces)
                foundMap.set(card.card_faces[0].name.toLowerCase(), card);
            });
          }

          batch.forEach((file) => {
            // Try finding match
            const match =
              foundMap.get(file.cleanName.toLowerCase()) ||
              Array.from(foundMap.values()).find((c) =>
                c.name.toLowerCase().includes(file.cleanName.toLowerCase()),
              );

            if (match) {
              // Found: Add as real card with local image
              let backSrc = null;
              let set = "CUST";
              let cn = match.collector_number;
              if (match.card_faces && match.card_faces[0].image_uris) {
                backSrc =
                  match.card_faces[1].image_uris?.png ||
                  match.card_faces[1].image_uris?.large;
              }
              const newCard = {
                name: match.name,
                setName: match.set_name,
                src: file.src,
                qty: 1,
                set: set,
                cn: cn,
                backSrc: backSrc,
                showBack: false,
                isDuplex: false,
                selected: false,
                dfcData: backSrc
                  ? { frontSrc: file.src, backSrc: backSrc }
                  : null,
                oracle_id: match.oracle_id,
                lang: match.lang,
                color_identity: match.color_identity || [],
                // Save metadata for sorting
                cmc:
                  match.cmc !== undefined
                    ? match.cmc
                    : match.card_faces
                      ? match.card_faces[0].cmc
                      : 0,
                color: match.colors
                  ? match.colors.join("")
                  : match.card_faces
                    ? (match.card_faces[0].colors || []).join("")
                    : "",
                type_line:
                  match.type_line ||
                  (match.card_faces ? match.card_faces[0].type_line : ""),
              };
              this.cards.push(newCard);
            } else {
              // Not Found: Add as pure local file
              this.cards.push({
                name: file.cleanName,
                src: file.src,
                qty: 1,
                set: "Local",
                cn: "",
                backSrc: null,
                showBack: false,
                dfcData: null,
                isDuplex: false,
                selected: false,
                oracle_id: null,
                lang: "en",
                cmc: 0,
                color: "",
                type_line: "Local File",
              });
            }
          });
        } catch (e) {
          console.error("Identification error", e);
          // Fallback on error: add everything as local
          batch.forEach((file) => {
            this.cards.push({
              name: file.cleanName,
              src: file.src,
              qty: 1,
              set: "Local",
              cn: "",
              backSrc: null,
              showBack: false,
              dfcData: null,
              isDuplex: false,
              selected: false,
              oracle_id: null,
              lang: "en",
              cmc: 0,
              color: "",
              type_line: "Local File",
            });
          });
        }
        await new Promise((r) => setTimeout(r, 100)); // Be nice to API
      }

      // Start background caching for newly added cards
      this.loadLocalImages();
      this.runPrefetch();
    },
  },
};
