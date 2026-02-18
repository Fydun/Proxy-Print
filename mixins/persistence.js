// --- Persistence Mixin ---
// Session save/load, project export/import

import { saveToDB, loadFromDB, debounce } from "../utils/db.js";

export default {
  methods: {
    _saveSessionImmediate() {
      try {
        const rawData = {
          cards: this.cards,
          globalDuplex: this.globalDuplex,
          settings: this.settings,
          preferredVersions: this.preferredVersions,
        };

        const data = JSON.parse(JSON.stringify(rawData));
        saveToDB(data).catch((e) => console.warn("Storage issue", e));
      } catch (e) {
        console.warn("Storage issue", e);
      }
    },

    // Debounced version — used by watchers and most callers.
    // Batches rapid mutations (checkbox toggles, qty edits) into one write.
    saveSession: debounce(function () {
      this._saveSessionImmediate();
    }, 500),

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
          // Note: runPrefetch() is called by mounted() after loadSession() completes
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
          this.runPrefetch();
        } catch (err) {
          this.errorMessage = "Error parsing JSON.";
        }
      };

      reader.readAsText(file);
      event.target.value = "";
    },
  },
};
