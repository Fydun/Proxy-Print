// --- Scryfall Import Mixin ---
// Moxfield URL import, deck text import/sync

export default {
  methods: {
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
        const customMatch = this.cards.find(
          (c) =>
            (c.set === "CUST" || c.set === "Local") &&
            (c.name.toLowerCase() === target.name.toLowerCase() ||
              c.name.toLowerCase().startsWith(target.name.toLowerCase())),
        );

        if (customMatch) {
          existingMatch = customMatch;
        } else if (target.type === "specific") {
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
          // FIX: Don't re-fetch if it's Local OR Custom
          if (
            existingMatch.set !== "Local" &&
            existingMatch.set !== "CUST" &&
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
                      if (langRes.ok) {
                        const langData = await langRes.json();
                        // Only use if Scryfall has a real scan, not a placeholder
                        if (langData.image_status !== 'placeholder') {
                          scryCard = langData;
                        }
                      }
                    } catch (e) {
                      /* ignore */
                    }
                  }

                  let src = "",
                    backSrc = null,
                    smallSrc = "",
                    smallBackSrc = null;

                  // Image logic
                  if (
                    scryCard.card_faces &&
                    scryCard.card_faces[0].image_uris
                  ) {
                    src =
                      scryCard.card_faces[0].image_uris.png ||
                      scryCard.card_faces[0].image_uris.large;
                    smallSrc =
                      scryCard.card_faces[0].image_uris.small ||
                      scryCard.card_faces[0].image_uris.normal ||
                      src;
                    backSrc =
                      scryCard.card_faces[1].image_uris?.png ||
                      scryCard.card_faces[1].image_uris?.large;
                    smallBackSrc =
                      scryCard.card_faces[1].image_uris?.small ||
                      scryCard.card_faces[1].image_uris?.normal ||
                      backSrc;
                  } else {
                    src =
                      scryCard.image_uris?.png || scryCard.image_uris?.large;
                    smallSrc =
                      scryCard.image_uris?.small ||
                      scryCard.image_uris?.normal ||
                      src;
                  }

                  if (src) {
                    const newCard = {
                      name: scryCard.name,
                      set: scryCard.set.toUpperCase(),
                      setName: scryCard.set_name,
                      cn: scryCard.collector_number,
                      src,
                      smallSrc,
                      backSrc,
                      smallBackSrc,
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

      // Cache thumbnails locally, then start high-res prefetch
      this.loadLocalImages();
      this.runPrefetch();

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
  },
};
