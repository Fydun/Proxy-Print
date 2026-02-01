import AppIcon from "./components/AppIcon.js";
import SettingsModal from "./components/SettingsModal.js";
import HelpModal from "./components/HelpModal.js";
import PreviewModal from "./components/PreviewModal.js";
import ImportModal from "./components/ImportModal.js";
import VersionSelector from "./components/VersionSelector.js";

const { createApp } = Vue;
const { jsPDF } = window.jspdf;

// --- CONSTANTS ---
const DB_NAME = "MTGProxyPrinterDB";
const STORE_NAME = "appState";
const PAPER_SIZES = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
};

// --- HELPER: IndexedDB Persistence ---
const saveToDB = (data) => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(data, "currentSession");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
};
const loadFromDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get("currentSession");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
    request.onerror = () => reject(request.error);
  });
};

createApp({
  components: {
    AppIcon,
    SettingsModal,
    PreviewModal,
    HelpModal,
    ImportModal,
    VersionSelector,
  },
  data() {
    return {
      // Deck State
      cards: [],
      globalDuplex: false,

      // App State
      isGenerating: false,
      isFetchingTokens: false,
      statusMessage: "",
      errorMessage: "",

      // Modals
      showImportModal: false,
      showVersionModal: false,
      showSettingsModal: false,
      showPreviewModal: false,
      showSortMenu: false,
      showSearchHelp: false,
      showHelpModal: false,

      // Import Logic
      importText: "",
      importUrl: "",
      isFetchingUrl: false,
      isImporting: false,
      importStatus: "",
      importErrors: [],

      // Version Selector
      activeCardIndex: null,
      isFetchingVersions: false,
      versionList: [],
      versionSearchQuery: "",
      versionLang: "en",
      versionShowBack: false,
      isDraggingOverModal: false,

      // Drag & Drop
      isDraggingFile: false,
      draggedCardIndex: null,
      previewImage: null,

      // Settings
      settings: {
        paperSize: "a4",
        cardPreset: "standard",
        cardWidth: 63,
        cardHeight: 88,
        cardScale: 100,
        gapSize: 0,
        cutMarks: "lines",
        pageBg: "white",
        bleedMm: 0,
        proxyMarker: false,
        darkMode: false,
      },

      // Cache & Preferences
      versionCache: new Map(),
      preferredVersions: {},
      sortState: { key: "", order: "asc" },
      previewPages: [],
      backdropInteract: false,
    };
  },
  computed: {
    totalCards() {
      return this.cards.reduce((sum, card) => sum + card.qty, 0);
    },
    selectedCount() {
      return this.cards.filter((c) => c.selected).length;
    },
    allSelected() {
      return this.cards.length > 0 && this.cards.every((c) => c.selected);
    },
    detectedCardCount() {
      if (!this.importText) return 0;
      const lines = this.importText
        .split("\n")
        .filter(
          (l) =>
            l.trim().length > 0 && !l.startsWith("//") && !l.startsWith("#"),
        );
      return lines.length;
    },
    hasDFC() {
      return this.cards.some((c) => c.backSrc);
    },
    // Filters versions in the modal based on search query
    filteredVersions() {
      if (!this.versionSearchQuery) return this.versionList;
      const queryParts = this.versionSearchQuery.toLowerCase().split(/\s+/);
      return this.versionList.filter((ver) => {
        if (ver.id === "custom-current") return true;
        return queryParts.every((part) => {
          let isNegative = false,
            term = part;
          if (term.startsWith("-")) {
            isNegative = true;
            term = term.substring(1);
          }
          let match = false;

          if (term.includes(":")) {
            const [key, val] = term.split(":");
            if (!val) return true;
            switch (key) {
              case "year":
                match = ver.year.includes(val);
                break;
              case "set":
              case "s":
                match =
                  ver.set.toLowerCase().includes(val) ||
                  ver.setName.toLowerCase().includes(val);
                break;
              case "frame":
                if (val === "old") {
                  match = ["1993", "1997"].includes(ver.frame);
                } else if (val === "modern") {
                  match = ver.frame === "2003";
                } else if (["new", "ori", "origin"].includes(val)) {
                  match = ver.frame === "2015";
                } else {
                  // Fallback: Allows 1993, 2015, future, etc to match themselves directly
                  match = ver.frame && ver.frame.includes(val);
                }
                break;
              case "border":
                match = ver.border && ver.border.includes(val);
                break;
              case "game":
                match = ver.games && ver.games.includes(val);
                break;
              case "artist":
              case "a":
                match = ver.artist && ver.artist.toLowerCase().includes(val);
                break;
              case "is":
                if (val === "fullart") match = ver.full_art;
                else if (val === "textless") match = ver.textless;
                break;
              case "not":
                if (val === "fullart") match = !ver.full_art;
                else if (val === "textless") match = !ver.textless;
                break;
              default:
                match = true;
            }
          } else {
            match =
              ver.set.toLowerCase().includes(term) ||
              ver.setName.toLowerCase().includes(term) ||
              (ver.artist && ver.artist.toLowerCase().includes(term)) ||
              ver.year.includes(term);
          }
          return isNegative ? !match : match;
        });
      });
    },
  },
  watch: {
    cards: {
      handler(newCards) {
        this.saveSession();
      },
      deep: true,
    },
    globalDuplex() {
      this.saveSession();
    },
    settings: {
      handler(newVal) {
        // Auto-set dimensions based on presets
        if (newVal.cardPreset === "standard") {
          newVal.cardWidth = 63;
          newVal.cardHeight = 88;
        } else if (newVal.cardPreset === "yugioh") {
          newVal.cardWidth = 59;
          newVal.cardHeight = 86;
        } else if (newVal.cardPreset === "mini_us") {
          newVal.cardWidth = 41;
          newVal.cardHeight = 63;
        } else if (newVal.cardPreset === "mini_eu") {
          newVal.cardWidth = 44;
          newVal.cardHeight = 68;
        } else if (newVal.cardPreset === "tarot") {
          newVal.cardWidth = 70;
          newVal.cardHeight = 120;
        }
        if (newVal.darkMode) {
          document.documentElement.classList.add("dark");
          localStorage.setItem("darkMode", "true");
        } else {
          document.documentElement.classList.remove("dark");
          localStorage.setItem("darkMode", "false");
        }
        this.saveSession();
      },
      deep: true,
    },
  },
  async mounted() {
    //Wait for saved settings to load from IndexedDB
    await this.loadSession();



    //Attach Event Listeners
    window.addEventListener("keydown", this.handleKeydown);
    window.addEventListener("dragenter", this.onDragEnter);
    window.addEventListener("dragover", this.onDragOver);
    window.addEventListener("dragleave", this.onDragLeave);
    window.addEventListener("drop", this.onGlobalDrop);
    window.addEventListener("paste", this.handlePaste);
  },
  unmounted() {
    window.removeEventListener("keydown", this.handleKeydown);
    window.removeEventListener("dragenter", this.onDragEnter);
    window.removeEventListener("dragover", this.onDragOver);
    window.removeEventListener("dragleave", this.onDragLeave);
    window.removeEventListener("drop", this.onGlobalDrop);
    window.removeEventListener("paste", this.handlePaste);
  },
  methods: {
    /* --- Backdrop Helpers --- */
    handleBackdropMouseDown(e) {
      // Only set flag if clicking strictly on the background (self), not children
      this.backdropInteract = e.target === e.currentTarget;
    },
    handleBackdropClick(closeAction) {
      // Only close if mousedown ALSO started on the background
      if (this.backdropInteract) {
        closeAction();
      }
      this.backdropInteract = false;
    },
    toggleDarkMode() {
      this.settings.darkMode = !this.settings.darkMode;
    },

    /* --- Core & Persistence --- */

    async saveSession() {
      try {
        const rawData = {
          cards: this.cards,
          globalDuplex: this.globalDuplex,
          settings: this.settings,
          preferredVersions: this.preferredVersions,
        };

        const data = JSON.parse(JSON.stringify(rawData));
        await saveToDB(data);
      } catch (e) {
        console.warn("Storage issue", e);
      }
    },

    async loadSession() {
      try {
        const parsed = await loadFromDB();

        if (parsed && parsed.cards) {
          this.cards = parsed.cards.map((c) => ({
            ...c,
            selected: false,
          }));

          this.globalDuplex = parsed.globalDuplex || false;

          if (parsed.settings) {
            this.settings = {
              ...this.settings,
              ...parsed.settings,
            };
          }

          if (parsed.preferredVersions) {
            this.preferredVersions = parsed.preferredVersions;
          }
        }
      } catch (e) {
        console.error("Load error", e);
      }
    },

    saveProject() {
      const exportData = {
        cards: this.cards,
        globalDuplex: this.globalDuplex,
        settings: this.settings,
      };

      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(exportData, null, 2));

      const node = document.createElement("a");
      node.href = dataStr;
      node.download = "proxy-deck.json";

      document.body.appendChild(node);
      node.click();
      node.remove();
    },

    loadProject(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);

          if (json.cards) {
            this.cards = json.cards;
            this.globalDuplex = json.globalDuplex || false;

            if (json.settings) {
              this.settings = {
                ...this.settings,
                ...json.settings,
              };
            }
          } else if (Array.isArray(json)) {
            this.cards = json;
          }

          this.saveSession();
        } catch (err) {
          this.errorMessage = "Error parsing JSON.";
        }
      };

      reader.readAsText(file);
      event.target.value = "";
    },

    /* --- UI Interaction --- */
    handleKeydown(e) {
      if (e.key === "Escape") {
        if (this.previewImage) this.previewImage = null;
        else if (this.showImportModal) this.showImportModal = false;
        else if (this.showVersionModal) this.showVersionModal = false;
        else if (this.showSettingsModal) this.showSettingsModal = false;
        else if (this.showPreviewModal) this.showPreviewModal = false;
        else if (this.showSearchHelp) this.showSearchHelp = false;
        this.showSortMenu = false;
      }
    },
    toggleSelectAll() {
      const target = !this.allSelected;
      this.cards.forEach((c) => (c.selected = target));
    },
    deselectAll() {
      this.cards.forEach((c) => (c.selected = false));
    },

    /* --- Deck Management (Add/Remove/Edit) --- */
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

      this.statusMessage = `Fetching ${targetLang.toUpperCase()} images for ${selectedCards.length} card(s)...`;
      let updatedCount = 0;

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

      for (const card of selectedCards) {
        // Skip local files or if language is already set
        if (card.set === "Local" || card.lang === targetLang) continue;

        try {
          let newData = null;

          // STRATEGY 1: Try to get the EXACT same printing in the new language
          // Endpoint: /cards/:set/:cn/:lang
          if (card.set && card.cn) {
            const exactRes = await fetch(
              `https://api.scryfall.com/cards/${card.set}/${card.cn}/${targetLang}`,
            );
            if (exactRes.ok) {
              newData = await exactRes.json();
            }
          }

          // STRATEGY 2: Fallback - specific print not found, find ANY print in this language
          // Endpoint: /cards/search (using oracle_id if available, or name)
          if (!newData) {
            let query = `lang:${targetLang} unique:prints`;
            if (card.oracle_id) {
              query += ` oracle_id:${card.oracle_id}`;
            } else {
              // Remove existing language tags or split card names for search
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
              // Take the first match (most recent printing usually due to order=released)
              if (searchData.data && searchData.data.length > 0) {
                newData = searchData.data[0];
              }
            }
          }

          // APPLY UPDATES
          if (newData) {
            card.src = getImg(newData);

            // Handle Back faces (DFC)
            const newBack = getBackImg(newData);
            if (newBack) {
              card.backSrc = newBack;
              card.dfcData = { frontSrc: card.src, backSrc: newBack };
            }

            // Update Metadata so the UI reflects the actual version found
            card.set = newData.set.toUpperCase();
            card.cn = newData.collector_number;
            card.lang = targetLang;
            // Optional: Update artist/frame data if you use them for sorting
            if (newData.artist) card.artist = newData.artist;

            updatedCount++;
          }
        } catch (e) {
          console.error(`Failed to translate ${card.name}`, e);
        }

        // Small delay to respect Scryfall rate limits (75ms)
        await new Promise((r) => setTimeout(r, 75));
      }

      this.saveSession();
      this.statusMessage = `Updated ${updatedCount} cards to ${targetLang.toUpperCase()}.`;

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

    // ---------------------------------------------------------
    //              NEW SORTING HELPERS & LOGIC
    // ---------------------------------------------------------

    // Helper: Calculates a score for WUBRG order
    // Mono: W(1), U(2), B(3), R(4), G(5)
    // Pairs/Trios are weighted higher to appear after mono colors
    // --- SORTING HELPERS ---

    getWUBRGScore(cStr) {
      if (!cStr || cStr.length === 0) return 999; // Truly Colorless (Wastes, Sol Ring)

      // Normalize string (e.g., "GW" -> "GW")
      // Note: Scryfall usually pre-sorts these, but we ensure it.
      const norm = cStr
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

      if (t.includes("battle")) return 1;
      if (t.includes("planeswalker")) return 2;
      if (t.includes("creature")) return 3;
      if (t.includes("sorcery")) return 4;
      if (t.includes("instant")) return 5;
      if (t.includes("artifact")) return 6;
      if (t.includes("enchantment")) return 7;
      if (t.includes("land")) return 8;
      return 99;
    },

    calculateColorRank(card) {
      const type = (card.type_line || "").toLowerCase();
      const castingColors = card.color || "";
      const hasCastingColor = castingColors.length > 0;

      // Derive Color Identity Signature (Sorted String W->U->B->R->G)
      let identitySignature = "";
      if (card.color_identity && Array.isArray(card.color_identity)) {
        const order = "WUBRG";
        identitySignature = [...card.color_identity]
          .sort((a, b) => order.indexOf(a) - order.indexOf(b))
          .join("");
      }

      let categoryScore = 0;
      let signature = castingColors;

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
      // Toggle order if clicking the same header twice
      if (this.sortState.key === key) {
        this.sortState.order = this.sortState.order === "asc" ? "desc" : "asc";
      } else {
        this.sortState.key = key;
        this.sortState.order = "asc";
      }

      const modifier = this.sortState.order === "asc" ? 1 : -1;

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
          valA = a.cmc || 0;
          valB = b.cmc || 0;
        } else if (key === "dfc") {
          valA = !!a.backSrc ? 1 : 0;
          valB = !!b.backSrc ? 1 : 0;
        } else if (key === "tokens") {
          // Use new helper to categorize Cards (0) vs Extras (1)
          valA = this.getCardCategory(a);
          valB = this.getCardCategory(b);
        } else {
          return 0;
        }

        if (valA < valB) return -1 * modifier;
        if (valA > valB) return 1 * modifier;

        // STABLE SORT: If values are equal, return 0.
        // This tells JS to keep them in their current relative positions.
        return 0;
      });

      this.showSortMenu = false;
      this.saveSession();
    },
    /* --- File Handling (Drag/Drop/Paste) --- */
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
    },

    /* --- Scryfall API: Import & Deck Sync --- */

    async importDeckFromURL() {
      // IMMEDIATE LOG: Confirm function is running
      console.log("--- IMPORT STARTING ---");
      console.log("URL Input:", this.importUrl);

      // 1. Basic Input Validation
      if (!this.importUrl) {
        console.warn("Import aborted: No URL provided");
        return;
      }

      this.isFetchingUrl = true;
      this.errorMessage = "";
      this.importStatus = "Starting trace... (Check Console)";

      const url = this.importUrl.trim();
      const startTime = Date.now();
      const traceLog = [];

      // Helper to log to both Console (Real-time) and TraceLog (History)
      const log = (msg) => {
        const time = ((Date.now() - startTime) / 1000).toFixed(2);
        const fullMsg = `[${time}s] ${msg}`;
        console.log(fullMsg);
        traceLog.push(fullMsg);
      };

      try {
        // 2. Validate Moxfield Domain & Extract Deck ID
        const moxfieldRegex = /moxfield\.com\/decks\/([a-zA-Z0-9\-_]+)/;
        const match = url.match(moxfieldRegex);

        if (!match) {
          log("Regex failed: URL did not match expected Moxfield format.");
          throw new Error(
            "Invalid URL. Please enter a valid Moxfield deck link.",
          );
        }

        const deckId = match[1];
        log(`Deck ID extracted: ${deckId}`);

        // STRATEGY: "Strict Validation"
        // We prioritize the API, then Main Page.
        // We intentionally skip 'Embed' because it consistently returns empty shells via proxy.
        // We rely on the Main Page's __NEXT_DATA__ blob which is robust even without JS.
        const targets = [
          {
            name: "API",
            url: `https://api.moxfield.com/v2/decks/all/${deckId}`,
            format: "json",
          },
          {
            name: "Main",
            url: `https://www.moxfield.com/decks/${deckId}`,
            format: "html",
          },
        ];

        // Define proxies with Cache Busting
        const ts = Date.now();
        const proxies = [
          {
            name: "CorsProxy",
            gen: (t) =>
              `https://corsproxy.io/?${encodeURIComponent(t)}&_t=${ts}`,
          },
          {
            name: "AllOrigins",
            gen: (t) =>
              `https://api.allorigins.win/raw?url=${encodeURIComponent(t)}&timestamp=${ts}`,
          },
        ];

        let responseText = null;
        let successTarget = null;
        let successProxy = null;

        // 3. Attempt Fetch Loop
        outerLoop: for (const target of targets) {
          for (const proxy of proxies) {
            const stepName = `${target.name} via ${proxy.name}`;
            log(`Trying: ${stepName}`);

            try {
              // Timeout Controller (20s max - Main page can be slow)
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 20000);

              const res = await fetch(proxy.gen(target.url), {
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              if (res.status === 404) {
                log(`   -> Failed: Status 404 (Page not found).`);
                continue;
              }

              if (res.ok) {
                const text = await res.text();

                // Validation: Check for Soft 404s or Block pages
                if (
                  text.includes('"status":404') ||
                  text.includes('"title":"Not Found"') ||
                  text.includes("Just a moment...") ||
                  text.includes("Cloudflare")
                ) {
                  log("   -> Failed: Soft 404 or Cloudflare Block");
                  continue;
                }

                // STRICT VALIDATION:
                // We do NOT accept a page just because it downloaded.
                // It MUST contain the data markers.
                let isValid = false;

                if (target.format === "json") {
                  if (text.startsWith("{")) isValid = true;
                } else if (target.name === "Main") {
                  // The Main page MUST contain the Next.js hydration blob
                  if (text.includes("__NEXT_DATA__")) {
                    isValid = true;
                  } else {
                    log(
                      "   -> Failed: Page downloaded but missing __NEXT_DATA__ blob (Empty Shell)",
                    );
                  }
                }

                if (isValid) {
                  responseText = text;
                  successTarget = target;
                  successProxy = proxy.name;
                  log("   -> SUCCESS: Valid Data Found");
                  break outerLoop;
                }
              } else {
                log(`   -> Failed: Status ${res.status}`);
              }
            } catch (err) {
              log(
                `   -> Error: ${err.name === "AbortError" ? "Timeout" : err.message}`,
              );
            }
          }
        }

        if (!responseText) {
          log("All strategies failed.");
          this.importText = `--- IMPORT FAILED ---\nTrace Log:\n${traceLog.join("\n")}`;
          throw new Error("All strategies failed. Please check the Trace Log.");
        }

        // 4. PARSING
        log(`Parsing content from ${successTarget.name}...`);
        let cardsToImport = [];
        let debugParser = "";

        const extractFromZone = (zone) => {
          if (!zone) return;
          Object.values(zone).forEach((slot) => {
            const name = slot.card?.name || slot.name;
            if (slot.quantity && name)
              cardsToImport.push(`${slot.quantity} ${name}`);
          });
        };

        // Strategy A: Next.js Data Blob (Primary for Main Page)
        if (successTarget.name === "Main") {
          const nextDataMatch = responseText.match(
            /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/,
          );
          if (nextDataMatch && nextDataMatch[1]) {
            try {
              const json = JSON.parse(nextDataMatch[1]);
              const deckData = json?.props?.pageProps?.deck;
              if (deckData) {
                extractFromZone(deckData.commanders);
                extractFromZone(deckData.mainboard);
                extractFromZone(deckData.sideboard);
                debugParser = "NextJS-Hydration";
              } else {
                log("   -> JSON parsed but 'deck' prop missing");
              }
            } catch (e) {
              log("Parser A (Hydration) failed: " + e.message);
            }
          }
        }

        // Strategy B: JSON API
        if (cardsToImport.length === 0 && successTarget.format === "json") {
          try {
            const data = JSON.parse(responseText);
            extractFromZone(data.commanders);
            extractFromZone(data.mainboard);
            extractFromZone(data.sideboard);
            debugParser = "API-JSON";
          } catch (e) {
            log("Parser B (API) failed: " + e.message);
          }
        }

        // 5. Final Result
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

        if (cardsToImport.length > 0) {
          this.importText = cardsToImport.join("\n");
          this.importStatus = `Success! (${totalTime}s)\nTarget: ${successTarget.name}\nProxy: ${successProxy}\nParser: ${debugParser}`;
          log("--- FINISHED SUCCESS ---");
        } else {
          this.importText = `--- IMPORT FAILED ---\nTrace Log:\n${traceLog.join("\n")}\n\nContent Preview:\n${responseText.slice(0, 500)}`;
          this.errorMessage = "No cards found. The deck might be Private.";
          log("--- FINISHED FAILED ---");
        }

        this.importUrl = "";
      } catch (error) {
        console.error("Critical Import Error:", error);
        this.errorMessage = error.message;
      } finally {
        this.isFetchingUrl = false;
      }
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

        if (target.type === "specific") {
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
          if (
            existingMatch.set !== "Local" &&
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

                  // Handle Language
                  if (target.lang !== "en") {
                    try {
                      const langRes = await fetch(
                        `https://api.scryfall.com/cards/${scryCard.set}/${scryCard.collector_number}/${target.lang}`,
                      );
                      if (langRes.ok) scryCard = await langRes.json();
                    } catch (e) {
                      /* ignore */
                    }
                  }

                  let src = "",
                    backSrc = null;

                  // Image logic
                  if (
                    scryCard.card_faces &&
                    scryCard.card_faces[0].image_uris
                  ) {
                    src =
                      scryCard.card_faces[0].image_uris.png ||
                      scryCard.card_faces[0].image_uris.large;
                    backSrc =
                      scryCard.card_faces[1].image_uris?.png ||
                      scryCard.card_faces[1].image_uris?.large;
                  } else {
                    src =
                      scryCard.image_uris?.png || scryCard.image_uris?.large;
                  }

                  if (src) {
                    const newCard = {
                      name: scryCard.name,
                      set: scryCard.set.toUpperCase(),
                      cn: scryCard.collector_number,
                      src,
                      backSrc,
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

    /* --- Token & DFC Management --- */
    splitCard(index) {
      const card = this.cards[index];
      if (!card.backSrc) return;
      if (!card.dfcData)
        card.dfcData = { frontSrc: card.src, backSrc: card.backSrc };
      const backCard = {
        name: card.name + " (Back)",
        src: card.backSrc,
        qty: card.qty,
        set: card.set,
        cn: card.cn,
        backSrc: null,
        showBack: false,
        dfcData: { ...card.dfcData },
        selected: false,
        oracle_id: card.oracle_id,
        lang: card.lang,
      };
      card.name = card.name + " (Front)";
      card.backSrc = null;
      this.cards.splice(index + 1, 0, backCard);
    },
    restoreDFC(index) {
      const card = this.cards[index];
      if (!card.dfcData) return;
      const baseName = card.name.replace(" (Front)", "").replace(" (Back)", "");
      // Remove partner if it exists next to it
      if (card.name.includes(" (Front)")) {
        const expectedBackName = baseName + " (Back)";
        if (index + 1 < this.cards.length) {
          const nextCard = this.cards[index + 1];
          if (
            nextCard.name === expectedBackName ||
            nextCard.oracle_id === card.oracle_id
          ) {
            this.cards.splice(index + 1, 1);
          }
        }
      } else if (card.name.includes(" (Back)")) {
        const expectedFrontName = baseName + " (Front)";
        if (index - 1 >= 0) {
          const prevCard = this.cards[index - 1];
          if (
            prevCard.name === expectedFrontName ||
            prevCard.oracle_id === card.oracle_id
          ) {
            this.cards.splice(index - 1, 1);
          }
        }
      }
      card.src = card.dfcData.frontSrc;
      card.backSrc = card.dfcData.backSrc;
      card.name = baseName;
      this.saveSession();
    },
    groupDFCs() {
      this.cards.sort((a, b) => {
        const aIsDFC = !!a.backSrc;
        const bIsDFC = !!b.backSrc;
        if (aIsDFC && !bIsDFC) return -1;
        if (!aIsDFC && bIsDFC) return 1;
        return 0;
      });
      this.saveSession();
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
      const identifier =
        card.set !== "Local" && card.cn
          ? { set: card.set, collector_number: card.cn }
          : { name: card.name };
      try {
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
          const scryCard = data.data[0];
          const tokenIds = new Set();
          if (scryCard.all_parts) {
            scryCard.all_parts.forEach((part) => {
              if (this.isTokenOrHelper(part)) {
                tokenIds.add(part.id);
              }
            });
          }
          if (tokenIds.size > 0) {
            await this.resolveAndAddTokens(Array.from(tokenIds));
          } else {
            this.errorMessage = `No tokens found for ${card.name}`;
          }
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

      // 1. Identify all cards in the deck to check their parts
      const identifiers = this.cards
        .filter((c) => !(c.set === "Local" && !c.cn))
        .map((c) =>
          c.set !== "Local" && c.cn
            ? { set: c.set, collector_number: c.cn }
            : { name: c.name },
        );

      if (identifiers.length === 0) {
        this.isFetchingTokens = false;
        return;
      }

      const BATCH_SIZE = 75;
      const batches = [];
      for (let i = 0; i < identifiers.length; i += BATCH_SIZE)
        batches.push(identifiers.slice(i, i + BATCH_SIZE));

      const tokensToFetchIds = new Set();

      try {
        // 2. Fetch full card objects from Scryfall to inspect 'all_parts'
        for (let batch of batches) {
          const res = await fetch("https://api.scryfall.com/cards/collection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifiers: batch }),
          });
          const data = await res.json();

          if (data.data) {
            data.data.forEach((c) => {
              // Don't fetch tokens for cards that ARE tokens
              if (c.layout === "token" || c.layout === "double_faced_token")
                return;

              if (c.all_parts) {
                c.all_parts.forEach((part) => {
                  if (this.isTokenOrHelper(part)) {
                    tokensToFetchIds.add(part.id);
                  }
                });
              }
            });
          }
          // Be polite to API
          await new Promise((r) => setTimeout(r, 75));
        }

        if (tokensToFetchIds.size > 0) {
          this.statusMessage = `Found ${tokensToFetchIds.size} tokens/markers. downloading...`;
          await this.resolveAndAddTokens(Array.from(tokensToFetchIds));
          this.statusMessage = "Tokens added successfully.";
        } else {
          this.errorMessage = "No tokens or extra parts found for this deck.";
        }
      } catch (e) {
        console.error("Batch token error", e);
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
              backSrc = null;

            // Handle double-faced tokens (e.g. Incubator // Phyrexian)
            if (token.card_faces && token.card_faces[0].image_uris) {
              src =
                token.card_faces[0].image_uris.png ||
                token.card_faces[0].image_uris.large;
              backSrc =
                token.card_faces[1].image_uris?.png ||
                token.card_faces[1].image_uris?.large;
            } else {
              src = token.image_uris?.png || token.image_uris?.large;
            }

            if (src) {
              const newCard = {
                name: token.name,
                set: token.set.toUpperCase(),
                cn: token.collector_number,
                src,
                backSrc,
                showBack: false,
                qty: 1,
                dfcData: null,
                selected: false,
                isDuplex: false,
                oracle_id: token.oracle_id,
                lang: token.lang,
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

    /* --- Version Selection Modal --- */
    async openVersionSelector(index, preserveLang = false) {
      const card = this.cards[index];
      this.activeCardIndex = index;
      this.showVersionModal = true;
      this.versionList = [];
      this.versionSearchQuery = "";

      if (!preserveLang) {
        this.versionLang = card.lang || "en";
      }

      this.isFetchingVersions = true;
      this.versionShowBack = card.name.includes("(Back)");

      if (card.set === "CUST" || card.set === "Local") {
        this.versionList.push({
          id: "custom-current",
          set: card.set,
          setName: "Current Custom Image",
          cn: card.cn || "---",
          year: "Custom",
          previewSrc: card.src,
          fullSrc: card.src,
          backSrc: card.backSrc,
          backPreviewSrc: card.backSrc,
        });
      }

      const cacheKey =
        card.oracle_id ||
        card.name.replace(" (Front)", "").replace(" (Back)", "");
      // Skip cache if looking for specific non-english language
      if (this.versionCache.has(cacheKey) && this.versionLang === "en") {
        const cached = this.versionCache.get(cacheKey);
        this.versionList.push(...cached);
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
            const scryfallVersions = data.data.map((c) => {
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
        if (!hasMore && this.versionLang === "en") {
          this.versionCache.set(cacheKey, accumulatedVersions);
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
    handleCustomVersionUpload(event) {
      const file = event.target.files[0];
      if (!file || this.activeCardIndex === null) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const card = this.cards[this.activeCardIndex];
        card.src = e.target.result;
        card.set = "CUST";
        card.cn = "";
        card.backSrc = null;
        card.dfcData = null;
        this.saveSession();
        this.showVersionModal = false;
        this.activeCardIndex = null;
        event.target.value = "";
      };
      reader.readAsDataURL(file);
    },
    selectVersion(version) {
      if (this.activeCardIndex === null) return;
      const card = this.cards[this.activeCardIndex];

      if (version.id !== "custom-current" && version.set !== "CUST") {
        this.preferredVersions[card.name] = {
          set: version.set,
          cn: version.cn,
          src: version.fullSrc,
          backSrc: version.backSrc,
          oracle_id: card.oracle_id,
        };
      }

      const isSplitBack = card.name.includes("(Back)");
      card.set = version.set;
      card.cn = version.cn;
      card.lang = version.lang;

      if (isSplitBack) card.src = version.backSrc || version.fullSrc;
      else card.src = version.fullSrc;
      if (version.backSrc) {
        card.backSrc =
          isSplitBack || card.name.includes("(Front)") ? null : version.backSrc;
        card.dfcData = {
          frontSrc: version.fullSrc,
          backSrc: version.backSrc,
        };
      } else {
        card.backSrc = null;
        card.dfcData = null;
      }

      // Apply Sorting Metadata
      if (version.cmc !== undefined) {
        card.cmc = version.cmc;
        card.color = version.color;
        card.type_line = version.type_line;
        card.color_identity = version.color_identity;
      }

      this.saveSession();
      this.showVersionModal = false;
      this.activeCardIndex = null;
    },
    onVersionLangChange() {
      if (this.activeCardIndex !== null) {
        this.versionCache.clear();
        this.openVersionSelector(this.activeCardIndex, true);
      }
    },
    handleVersionDrop(e) {
      this.isDraggingOverModal = false;
      const files = e.dataTransfer.files;
      if (files.length > 0 && this.activeCardIndex !== null) {
        const mockEvent = { target: { files: files, value: "" } };
        this.handleCustomVersionUpload(mockEvent);
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
        this.saveSession();
      }
    },

    /* --- PDF Generation & Preview --- */

    loadImage(src) {
      // 1. Check Promise Cache (Deduplication within this print session)
      if (!this._imgPromiseCache) this._imgPromiseCache = new Map();
      if (this._imgPromiseCache.has(src)) return this._imgPromiseCache.get(src);

      const loadPromise = new Promise((resolve, reject) => {
        // 2. Local Data URIs
        if (src.startsWith("data:")) {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("Local image load failed"));
          img.src = src;
          return;
        }

        // 3. Remote URLs - Smart Strategy
        // First, try standard load (Fast, hits browser cache)
        const img = new Image();
        img.crossOrigin = "Anonymous";

        img.onload = () => resolve(img);

        img.onerror = () => {
          // If Fast load fails (usually due to CORS/Cache poisoning),
          // fallback to Timestamp (Slower, but guaranteed to work)
          // This ensures we only "drain servers" when absolutely necessary to fix an error.
          console.warn("Retrying with timestamp for:", src);
          const retryImg = new Image();
          retryImg.crossOrigin = "Anonymous";
          const sep = src.includes("?") ? "&" : "?";
          retryImg.src = src + sep + "t=" + Date.now();

          retryImg.onload = () => resolve(retryImg);
          retryImg.onerror = (e) =>
            reject(new Error("Image load failed after retry"));
        };

        img.src = src;
      });

      this._imgPromiseCache.set(src, loadPromise);
      return loadPromise;
    },

    async openPreview() {
      this.isGenerating = true;
      try {
        const scale = Number(this.settings.cardScale) / 100;
        const cardW = Number(this.settings.cardWidth) * scale;
        const cardH = Number(this.settings.cardHeight) * scale;
        const gap = Number(this.settings.gapSize);
        const pxFactor = 3;

        // Use dimensions from constant
        const pageSize = PAPER_SIZES[this.settings.paperSize];
        const pageWidthMm = pageSize.w;
        const pageHeightMm = pageSize.h;

        const pW = pageWidthMm * pxFactor;
        const pH = pageHeightMm * pxFactor;

        let cols = Math.floor((pageWidthMm - 10) / (cardW + gap));
        let rows = Math.floor((pageHeightMm - 10) / (cardH + gap));
        if (cols < 1) cols = 1;
        if (rows < 1) rows = 1;

        const gridWidth = cols * cardW + (cols - 1) * gap;
        const gridHeight = rows * cardH + (rows - 1) * gap;
        const startX = (pageWidthMm - gridWidth) / 2;
        const startY = (pageHeightMm - gridHeight) / 2;
        const itemsPerPage = cols * rows;

        let printQueue = [];
        this.cards.forEach((card) => {
          for (let i = 0; i < card.qty; i++) {
            printQueue.push({
              src: card.src,
              backSrc: card.backSrc,
              name: card.name,
            });
          }
        });

        const pages = [];
        const totalBatches = Math.ceil(printQueue.length / itemsPerPage);

        for (let b = 0; b < totalBatches; b++) {
          const batch = printQueue.slice(
            b * itemsPerPage,
            (b + 1) * itemsPerPage,
          );
          const pageItems = [];

          batch.forEach((card, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = startX + col * (cardW + gap);
            const y = startY + row * (cardH + gap);
            pageItems.push({
              i: i,
              src: card.src,
              x: x * pxFactor,
              y: y * pxFactor,
              w: cardW * pxFactor,
              h: cardH * pxFactor,
            });
          });
          pages.push({ w: pW, h: pH, items: pageItems });

          if (this.globalDuplex && this.hasDFC) {
            const backItems = [];
            batch.forEach((card, i) => {
              if (card.backSrc) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const mirroredCol = cols - 1 - col;
                const x = startX + mirroredCol * (cardW + gap);
                const y = startY + row * (cardH + gap);
                backItems.push({
                  i: i,
                  src: card.backSrc,
                  x: x * pxFactor,
                  y: y * pxFactor,
                  w: cardW * pxFactor,
                  h: cardH * pxFactor,
                });
              }
            });
            pages.push({ w: pW, h: pH, items: backItems });
          }
        }
        this.previewPages = pages;
        this.showPreviewModal = true;
      } catch (e) {
        console.error(e);
        this.errorMessage = "Preview failed.";
      } finally {
        this.isGenerating = false;
      }
    },

    async generatePDF() {
      this.isGenerating = true;
      this.errorMessage = "";
      try {
        const doc = new jsPDF({
          orientation: "portrait",
          unit: "mm",
          format: this.settings.paperSize,
        });

        const pageSize = PAPER_SIZES[this.settings.paperSize];
        const pageWidth = pageSize.w;
        const pageHeight = pageSize.h;

        const scale = Number(this.settings.cardScale) / 100;
        const cardW = Number(this.settings.cardWidth) * scale;
        const cardH = Number(this.settings.cardHeight) * scale;
        const gap = Number(this.settings.gapSize);
        const bleed = Number(this.settings.bleedMm);

        let cols = Math.floor((pageWidth - 10) / (cardW + gap));
        let rows = Math.floor((pageHeight - 10) / (cardH + gap));
        if (cols < 1) cols = 1;
        if (rows < 1) rows = 1;

        const gridWidth = cols * cardW + (cols - 1) * gap;
        const gridHeight = rows * cardH + (rows - 1) * gap;
        const startX = (pageWidth - gridWidth) / 2;
        const startY = (pageHeight - gridHeight) / 2;
        const itemsPerPage = cols * rows;

        let printQueue = [];
        this.cards.forEach((card) => {
          for (let i = 0; i < card.qty; i++) {
            printQueue.push({
              src: card.src,
              backSrc: card.backSrc,
              name: card.name,
            });
          }
        });

        // Setup hidden canvas for high-res drawing
        const canvas = this.$refs.procCanvas;
        const ctx = canvas.getContext("2d");
        const scaleFactor = 12; // High DPI for print (300dpi approx)
        canvas.width = (cardW + bleed * 2) * scaleFactor;
        canvas.height = (cardH + bleed * 2) * scaleFactor;

        const totalBatches = Math.ceil(printQueue.length / itemsPerPage);

        // 1. Create a Set to track pages that have no actual cards on them
        const emptyPages = new Set();

        for (let b = 0; b < totalBatches; b++) {
          if (b > 0) doc.addPage();

          const batch = printQueue.slice(
            b * itemsPerPage,
            (b + 1) * itemsPerPage,
          );
          let needsBackPage = this.globalDuplex && this.hasDFC;

          // Draw Fronts
          for (let i = 0; i < batch.length; i++) {
            const card = batch[i];
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = startX + col * (cardW + gap);
            const y = startY + row * (cardH + gap);

            await this.drawCardToPDF(
              doc,
              ctx,
              card.src,
              x,
              y,
              cardW,
              cardH,
              canvas,
            );
            this.drawCutGuides(
              doc,
              x,
              y,
              cardW,
              cardH,
              gap,
              col,
              row,
              cols,
              rows,
            );
          }

          // Draw Backs (Duplex)
          if (needsBackPage) {
            doc.addPage();

            // 2. Check if this specific batch has ANY back faces to print
            const hasBacksInBatch = batch.some((card) => card.backSrc);

            // If no cards in this batch have a backSrc, mark this page as empty
            if (!hasBacksInBatch) {
              emptyPages.add(doc.internal.getNumberOfPages());
            }

            for (let i = 0; i < batch.length; i++) {
              const card = batch[i];
              const col = i % cols;
              const row = Math.floor(i / cols);
              // Mirror column index for duplex alignment
              const mirroredCol = cols - 1 - col;
              const x = startX + mirroredCol * (cardW + gap);
              const y = startY + row * (cardH + gap);

              if (card.backSrc) {
                await this.drawCardToPDF(
                  doc,
                  ctx,
                  card.backSrc,
                  x,
                  y,
                  cardW,
                  cardH,
                  canvas,
                );
                this.drawCutGuides(
                  doc,
                  x,
                  y,
                  cardW,
                  cardH,
                  gap,
                  mirroredCol,
                  row,
                  cols,
                  rows,
                );
              }
            }
          }
        }

        // Footer
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          // 3. Skip writing text if this page was marked as empty
          if (emptyPages.has(i)) continue;

          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(this.settings.pageBg === "black" ? 100 : 150);
          doc.text(
            "Images via Scryfall. Proxy tool for personal playtesting only.",
            10,
            pageHeight - 5,
          );
        }

        doc.save("proxies-custom.pdf");
      } catch (e) {
        console.error(e);
        this.errorMessage = "Failed to generate PDF. Check console.";
      } finally {
        this.isGenerating = false;
      }
    },

    drawCutGuides(doc, x, y, w, h, gap, col, row, maxCols, maxRows) {
      if (this.settings.cutMarks === "none") return;

      const isDark = this.settings.pageBg === "black";
      const color = isDark ? 255 : 150;
      doc.setDrawColor(color);
      doc.setLineWidth(0.1);

      if (this.settings.cutMarks === "dotted") doc.setLineDash([1, 1], 0);
      else doc.setLineDash([], 0);

      if (this.settings.cutMarks === "crosshairs") {
        const len = 3;
        // Draw L-shapes at corners
        doc.line(x - gap / 2, y, x - gap / 2 - len, y);
        doc.line(x, y - gap / 2, x, y - gap / 2 - len);
        doc.line(x + w + gap / 2, y, x + w + gap / 2 + len, y);
        doc.line(x + w, y - gap / 2, x + w, y - gap / 2 - len);
        doc.line(x - gap / 2, y + h, x - gap / 2 - len, y + h);
        doc.line(x, y + h + gap / 2, x, y + h + gap / 2 + len);
        doc.line(x + w + gap / 2, y + h, x + w + gap / 2 + len, y + h);
        doc.line(x + w, y + h + gap / 2, x + w, y + h + gap / 2 + len);
      } else {
        // Standard box
        doc.rect(x, y, w, h);
      }
    },

    async drawCardToPDF(doc, ctx, src, x, y, w, h, canvas) {
      try {
        const bleed = this.settings.bleedMm || 0;

        // Initialize processed data cache
        if (!this._processedImgCache) this._processedImgCache = new Map();

        // Create a unique key based on visual settings
        const cacheKey = `${src}_${bleed}_${this.settings.pageBg}_${this.settings.proxyMarker}`;

        // Check if we have already processed this exact card image
        let croppedData = this._processedImgCache.get(cacheKey);

        // If not in cache, draw and process it
        if (!croppedData) {
          const imgObj = await this.loadImage(src);

          const canvasW = canvas.width;
          const canvasH = canvas.height;

          // Clear and Fill
          ctx.clearRect(0, 0, canvasW, canvasH);
          ctx.fillStyle = this.settings.pageBg;
          ctx.fillRect(0, 0, canvasW, canvasH);

          // Calculate scaling
          const targetRatio = w / h;
          const imgRatio = imgObj.width / imgObj.height;
          let sWidth, sHeight, sx, sy;

          if (imgRatio > targetRatio) {
            sHeight = imgObj.height;
            sWidth = sHeight * targetRatio;
            sy = 0;
            sx = (imgObj.width - sWidth) / 2;
          } else {
            sWidth = imgObj.width;
            sHeight = sWidth / targetRatio;
            sx = 0;
            sy = (imgObj.height - sHeight) / 2;
          }
          ctx.drawImage(
            imgObj,
            sx,
            sy,
            sWidth,
            sHeight,
            0,
            0,
            canvasW,
            canvasH,
          );

          // Overlay Proxy Marker
          if (this.settings.proxyMarker) {
            ctx.font = `bold ${canvasH * 0.025}px Arial`;
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.textAlign = "center";
            ctx.fillText("PROXY", canvasW / 2, canvasH - canvasH * 0.035);
          }

          // Compress to JPEG (0.9 is faster and sufficient for print)
          croppedData = canvas.toDataURL("image/jpeg", 0.9);

          // Save to cache
          this._processedImgCache.set(cacheKey, croppedData);
        }

        // Add the (potentially cached) image data to PDF
        doc.addImage(
          croppedData,
          "JPEG",
          x - bleed,
          y - bleed,
          w + bleed * 2,
          h + bleed * 2,
        );
      } catch (err) {
        console.error("Draw Error for:", src, err);
        doc.setDrawColor(255, 0, 0);
        doc.setLineWidth(0.5);
        doc.rect(x, y, w, h);
        doc.setFontSize(8);
        doc.setTextColor(255, 0, 0);
        doc.text("Img Error", x + 2, y + 5);
      }
    },
  },
}).mount("#app");
