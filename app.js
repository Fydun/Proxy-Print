// --- Proxy-Print: Main Application Entry Point ---
// Composed from modular mixins — see mixins/ and utils/ folders.

import AppIcon from "./components/AppIcon.js";
import SettingsModal from "./components/SettingsModal.js";
import HelpModal from "./components/HelpModal.js";
import PreviewModal from "./components/PreviewModal.js";
import ImportModal from "./components/ImportModal.js";
import VersionSelectModal from "./components/VersionSelectModal.js";

// Mixins (each exports { methods: { ... } })
import persistenceMixin from "./mixins/persistence.js";
import deckManagementMixin from "./mixins/deckManagement.js";
import sortingMixin from "./mixins/sorting.js";
import fileHandlingMixin from "./mixins/fileHandling.js";
import scryfallImportMixin from "./mixins/scryfallImport.js";
import tokenDfcMixin from "./mixins/tokenDfc.js";
import versionSelectMixin from "./mixins/versionSelect.js";
import pdfGenerationMixin from "./mixins/pdfGeneration.js";
import imageCacheMixin from "./mixins/imageCache.js";

const { createApp } = Vue;

createApp({
  components: {
    AppIcon,
    SettingsModal,
    PreviewModal,
    HelpModal,
    ImportModal,
    VersionSelectModal,
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
      activeVersion: null,

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
        darkMode: true,
      },

      // Cache & Preferences
      preferredVersions: {},
      sortState: { key: "", order: "asc" },
      previewPages: [],
      backdropInteract: false,
      storageUsage: "",

      // Prefetch State
      prefetchTotal: 0,
      prefetchCurrent: 0,
      langChangeTotal: 0,
      langChangeCurrent: 0,
      prefetchRunId: 0,
      localImagesVersion: 0, // Bumped when thumbnails finish loading (triggers re-render)
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
      handler(newVal, oldVal) {
        // Only clear image cache if visual settings changed (not darkMode)
        const visualChanged =
          oldVal &&
          (newVal.cardWidth !== oldVal.cardWidth ||
            newVal.cardHeight !== oldVal.cardHeight ||
            newVal.cardScale !== oldVal.cardScale ||
            newVal.bleedMm !== oldVal.bleedMm ||
            newVal.pageBg !== oldVal.pageBg ||
            newVal.proxyMarker !== oldVal.proxyMarker ||
            newVal.cardPreset !== oldVal.cardPreset);

        if (visualChanged) {
          if (this._processedImgCache) {
            this._processedImgCache.clear();
          }
          this.clearProcessedImages();
        }

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
        // Trigger prefetch only if visual settings changed
        if (visualChanged) {
          this.runPrefetch();
        }
      },
      deep: true,
    },
    showHelpModal(val) {
      if (val) this.checkStorageUsage();
    },
  },
  created() {
    // Non-reactive caches — these don't drive template rendering
    // and avoid Vue's Proxy overhead for large data structures.
    this.localImages = {};      // url → dataUrl (thumbnails, write-once)
    this.versionCache = new Map(); // fullCacheKey → version list
  },
  async mounted() {
    //Wait for saved settings to load from IndexedDB
    await this.loadSession();

    // Initialize parallel image processing workers
    this.initWorkerPool();

    // Enforce cache size budget (500MB) — evicts oldest processed images if over
    this.evictCacheIfNeeded();

    // Load locally cached thumbnails, then download any missing ones
    await this.loadLocalImages();

    // Kick off prefetch on load
    this.runPrefetch();

    //Attach Event Listeners
    window.addEventListener("keydown", this.handleKeydown);
    window.addEventListener("dragenter", this.onDragEnter);
    window.addEventListener("dragover", this.onDragOver);
    window.addEventListener("dragleave", this.onDragLeave);
    window.addEventListener("drop", this.onGlobalDrop);
    window.addEventListener("paste", this.handlePaste);
  },
  unmounted() {
    this.destroyWorkerPool();
    window.removeEventListener("keydown", this.handleKeydown);
    window.removeEventListener("dragenter", this.onDragEnter);
    window.removeEventListener("dragover", this.onDragOver);
    window.removeEventListener("dragleave", this.onDragLeave);
    window.removeEventListener("drop", this.onGlobalDrop);
    window.removeEventListener("paste", this.handlePaste);
  },
  methods: {
    /* --- Inline UI Helpers (too small for their own file) --- */
    handleBackdropMouseDown(e) {
      this.backdropInteract = e.target === e.currentTarget;
    },
    handleBackdropClick(closeAction) {
      if (this.backdropInteract) {
        closeAction();
      }
      this.backdropInteract = false;
    },
    toggleDarkMode() {
      this.settings.darkMode = !this.settings.darkMode;
    },
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

    /* --- Spread in all mixin methods --- */
    ...persistenceMixin.methods,
    ...deckManagementMixin.methods,
    ...sortingMixin.methods,
    ...fileHandlingMixin.methods,
    ...scryfallImportMixin.methods,
    ...tokenDfcMixin.methods,
    ...versionSelectMixin.methods,
    ...pdfGenerationMixin.methods,
    ...imageCacheMixin.methods,
  },
}).mount("#app");

