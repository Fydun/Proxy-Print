// --- Image Cache Mixin ---
// IndexedDB image cache, worker pool, prefetching, thumbnail management

export default {
  methods: {
    // --- IndexedDB Cache Helpers ---
    async initCacheDB() {
      // Reuse cached connection if available and not closed
      if (this._cacheDB) {
        try {
          // Test if connection is still alive by checking objectStoreNames
          this._cacheDB.objectStoreNames;
          return this._cacheDB;
        } catch {
          this._cacheDB = null;
        }
      }
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("MTGProxyImageCache", 1);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("images")) {
            db.createObjectStore("images");
          }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e);
      });
      this._cacheDB = db;
      return db;
    },

    async saveToCache(key, data) {
      const db = await this.initCacheDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readwrite");
        const store = tx.objectStore("images");
        store.put(data, key);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
      });
    },

    async getFromCache(key) {
      const db = await this.initCacheDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readonly");
        const store = tx.objectStore("images");
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e);
      });
    },

    // Batch read: fetch many keys in a single IDB transaction
    async getBatchFromCache(keys) {
      const db = await this.initCacheDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readonly");
        const store = tx.objectStore("images");
        const results = new Map();
        let pending = keys.length;
        if (pending === 0) return resolve(results);
        for (const key of keys) {
          const req = store.get(key);
          req.onsuccess = () => {
            if (req.result) results.set(key, req.result);
            if (--pending === 0) resolve(results);
          };
          req.onerror = () => {
            if (--pending === 0) resolve(results);
          };
        }
        tx.onerror = () => reject(tx.error);
      });
    },

    async clearCacheDB() {
      const db = await this.initCacheDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readwrite");
        const store = tx.objectStore("images");
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
      });
    },

    // --- Persistent Scryfall Language Lookup ---
    // Checks IDB first, only calls Scryfall if not cached.
    // Caches both hits and misses so the same lookup is never repeated.
    async fetchScryfallLang(set, cn, lang) {
      const cacheKey = `lang_${set}_${cn}_${lang}`;
      try {
        const cached = await this.getFromCache(cacheKey);
        if (cached !== undefined) {
          // { _miss: true } = previously checked, not available in this language
          return cached && cached._miss ? null : cached;
        }
      } catch { /* IDB read error, proceed to fetch */ }

      try {
        const res = await fetch(
          `https://api.scryfall.com/cards/${set}/${cn}/${lang}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.image_status !== "placeholder") {
            await this.saveToCache(cacheKey, data);
            return data;
          }
        }
        // Not available — cache the miss so we never ask again
        await this.saveToCache(cacheKey, { _miss: true });
        return null;
      } catch {
        // Network error — don't cache, let them retry later
        return null;
      }
    },

    // --- Persistent Version Search Cache ---
    // Stores version lists in IDB so re-opening the version picker is instant.
    async getCachedVersions(key) {
      try {
        return await this.getFromCache(`versions_${key}`);
      } catch {
        return undefined;
      }
    },

    async cacheVersions(key, versions) {
      try {
        await this.saveToCache(`versions_${key}`, versions);
      } catch { /* non-critical */ }
    },

    /* --- Worker Pool for Parallel Image Processing --- */

    initWorkerPool() {
      // Feature detection: OffscreenCanvas + createImageBitmap required
      if (
        typeof OffscreenCanvas === "undefined" ||
        typeof createImageBitmap === "undefined"
      ) {
        console.info(
          "OffscreenCanvas not supported — using single-thread fallback.",
        );
        this._useWorkers = false;
        return;
      }

      try {
        const poolSize = Math.min(navigator.hardwareConcurrency || 4, 8);
        this._workerPool = [];
        this._workerTaskId = 0;
        this._workerCallbacks = new Map();

        for (let i = 0; i < poolSize; i++) {
          const worker = new Worker("./imageWorker.js");

          worker.onmessage = (e) => {
            const { taskId } = e.data;
            const cb = this._workerCallbacks.get(taskId);
            if (cb) {
              this._workerCallbacks.delete(taskId);
              if (e.data.status === "error") {
                cb.reject(new Error(e.data.error));
              } else {
                cb.resolve(e.data);
              }
            }
          };

          worker.onerror = (err) => {
            console.warn("Worker error:", err);
          };

          this._workerPool.push(worker);
        }

        this._useWorkers = true;
        this._workerRR = 0;
        console.info(`Image worker pool initialized: ${poolSize} workers`);
      } catch (err) {
        console.warn("Failed to init worker pool, using fallback:", err);
        this._useWorkers = false;
      }
    },

    destroyWorkerPool() {
      if (this._workerPool) {
        this._workerPool.forEach((w) => w.terminate());
        this._workerPool = null;
      }
      if (this._workerCallbacks) {
        this._workerCallbacks.forEach((cb) =>
          cb.reject(new Error("Worker pool destroyed")),
        );
        this._workerCallbacks.clear();
      }
      this._useWorkers = false;
    },

    processCardWithWorker(imageBitmap, settings) {
      const taskId = ++this._workerTaskId;
      const worker =
        this._workerPool[this._workerRR++ % this._workerPool.length];

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this._workerCallbacks.delete(taskId);
          reject(new Error("Worker timeout"));
        }, 30000);

        this._workerCallbacks.set(taskId, {
          resolve: (data) => {
            clearTimeout(timeout);
            // Convert transferred ArrayBuffer to Uint8Array for jsPDF
            if (data.imageBuffer) {
              data.imageData = new Uint8Array(data.imageBuffer);
            }
            resolve(data);
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
        });

        worker.postMessage({ taskId, imageBitmap, settings }, [imageBitmap]);
      });
    },

    getPrefetchCanvas() {
      if (!this._prefetchCanvas) {
        this._prefetchCanvas = document.createElement("canvas");
      }
      return this._prefetchCanvas;
    },

    async processCardToCache(src, { skipCacheCheck = false } = {}) {
      if (!src) return;

      const scale = Number(this.settings.cardScale) / 100;
      const cardW = Number(this.settings.cardWidth) * scale;
      const cardH = Number(this.settings.cardHeight) * scale;
      const bleed = this.settings.bleedMm || 0;
      const scaleFactor = 12; // 300 DPI

      const cacheKey = `${src}_${bleed}_${this.settings.pageBg}_${this.settings.proxyMarker}`;

      // Skip IDB check when caller (runPrefetch) already verified it's uncached
      if (!skipCacheCheck) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) return;
      }

      try {
        const imgObj = await this.loadImage(src);

        if (this._useWorkers) {
          // Worker path: create transferable ImageBitmap and offload processing
          const bitmap = await createImageBitmap(imgObj);
          await this.processCardWithWorker(bitmap, {
            cardW,
            cardH,
            bleed,
            pageBg: this.settings.pageBg,
            proxyMarker: this.settings.proxyMarker,
            scaleFactor,
            cacheKey,
            checkCache: false,
            returnData: false,
          });
        } else {
          // Fallback: create a dedicated canvas per call (avoids shared-canvas corruption)
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { willReadFrequently: true });

          const targetW = (cardW + bleed * 2) * scaleFactor;
          const targetH = (cardH + bleed * 2) * scaleFactor;
          canvas.width = targetW;
          canvas.height = targetH;

          ctx.clearRect(0, 0, targetW, targetH);
          ctx.fillStyle = this.settings.pageBg;
          ctx.fillRect(0, 0, targetW, targetH);

          const targetRatio = cardW / cardH;
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

          ctx.drawImage(imgObj, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);

          if (this.settings.proxyMarker) {
            ctx.font = `bold ${targetH * 0.025}px Arial`;
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.textAlign = "center";
            ctx.fillText("PROXY", targetW / 2, targetH - targetH * 0.035);
          }

          // Store as Blob (~33% smaller than base64 data URL)
          const blob = await new Promise((res) =>
            canvas.toBlob(res, "image/jpeg", 0.85),
          );
          await this.saveToCache(cacheKey, blob);
        }
      } catch (e) {
        console.warn("Prefetch failed for", src, e);
      }
    },

    async runPrefetch() {
      // 1. Invalidate previous runs
      this.prefetchRunId++;
      const currentRunId = this.prefetchRunId;

      // 2. Clear state immediately
      if (this.cards.length === 0) {
        this.prefetchTotal = 0;
        this.prefetchCurrent = 0;
        return;
      }

      if (this.isGenerating) return;

      // Deduplicate sources (Target High-Res SRC)
      const queue = new Set();
      this.cards.forEach((c) => {
        if (c.src) queue.add(c.src);
        if (c.backSrc) queue.add(c.backSrc);
      });

      const allSources = Array.from(queue);
      const bleed = this.settings.bleedMm || 0;

      // 3. Pre-check which images are already cached (fast IDB lookups)
      const uncached = [];
      let alreadyCached = 0;
      for (const src of allSources) {
        if (this.prefetchRunId !== currentRunId) return;
        const cacheKey = `${src}_${bleed}_${this.settings.pageBg}_${this.settings.proxyMarker}`;
        try {
          const exists = await this.getFromCache(cacheKey);
          if (exists) {
            alreadyCached++;
          } else {
            uncached.push(src);
          }
        } catch {
          uncached.push(src);
        }
      }

      // If everything is already cached, no work to do — don't show the indicator
      if (uncached.length === 0) {
        this.prefetchTotal = 0;
        this.prefetchCurrent = 0;
        return;
      }

      // Only show progress for images that actually need processing
      this.prefetchTotal = uncached.length;
      this.prefetchCurrent = 0;

      const tasks = uncached.slice(); // Copy so splice doesn't affect original
      const BATCH_SIZE = this._useWorkers
        ? this._workerPool
          ? this._workerPool.length
          : 4
        : 4;

      const processBatch = async () => {
        // Stop if a new run has started
        if (this.prefetchRunId !== currentRunId) return;

        if (this.isGenerating || tasks.length === 0) {
          if (tasks.length === 0) {
            // Done
            setTimeout(() => {
              // Only reset if we are still the active run
              if (this.prefetchRunId === currentRunId) {
                this.prefetchTotal = 0;
                this.prefetchCurrent = 0;
              }
            }, 2000);
          }
          return;
        }

        const batch = tasks.splice(0, BATCH_SIZE);
        await Promise.all(
          batch.map(async (src) => {
            // Check again inside loop
            if (this.prefetchRunId !== currentRunId) return;
            try {
              // Race against a 30s timeout to prevent hanging
              await Promise.race([
                this.processCardToCache(src, { skipCacheCheck: true }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("Timeout")), 30000),
                ),
              ]);
            } catch (e) {
              console.warn("Prefetch skip:", src, e.message);
            } finally {
              this.prefetchCurrent++;
            }
          }),
        );

        // Breathe
        setTimeout(processBatch, 20);
      };

      processBatch();
    },

    /* --- Local Image Cache (Thumbnails + Display Images) --- */

    resolveImage(url) {
      if (!url || url.startsWith("data:")) return url;
      return this.localImages[url] || url;
    },

    async downloadThumbnail(url) {
      if (!url || url.startsWith("data:")) return url;

      const cacheKey = `thumb_${url}`;
      const cached = await this.getFromCache(cacheKey);
      if (cached) return cached;

      // Download via loadImage (handles CORS retries) then encode to data URL
      const img = await this.loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

      await this.saveToCache(cacheKey, dataUrl);
      return dataUrl;
    },

    async loadLocalImages() {
      // Collect all remote image URLs from cards
      const urls = new Set();
      this.cards.forEach((c) => {
        // Only cache display-size images (smallSrc/smallBackSrc).
        // High-res src/backSrc are only used for PDF and have their own IDB cache.
        [c.smallSrc, c.smallBackSrc].forEach((u) => {
          if (u && !u.startsWith("data:") && !this.localImages[u]) urls.add(u);
        });
      });

      if (urls.size === 0) return;

      // Phase 1: Load from IndexedDB in a single batch transaction
      const urlList = Array.from(urls);
      const cacheKeys = urlList.map((u) => `thumb_${u}`);
      let cachedResults;
      try {
        cachedResults = await this.getBatchFromCache(cacheKeys);
      } catch {
        cachedResults = new Map();
      }

      const uncached = [];
      for (let i = 0; i < urlList.length; i++) {
        const url = urlList[i];
        const data = cachedResults.get(cacheKeys[i]);
        if (data) {
          this.localImages[url] = data;
        } else {
          uncached.push(url);
        }
      }

      // Phase 2: Download missing in background (non-blocking)
      if (uncached.length > 0) {
        this.downloadMissingThumbnails(uncached);
      }
    },

    async downloadMissingThumbnails(urls) {
      const BATCH = 6;
      for (let i = 0; i < urls.length; i += BATCH) {
        const batch = urls.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (url) => {
            try {
              const dataUrl = await this.downloadThumbnail(url);
              this.localImages[url] = dataUrl;
            } catch (e) {
              console.warn("Thumb cache fail:", url, e.message);
            }
          }),
        );
        // Breathe between batches
        if (i + BATCH < urls.length) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    },

    async checkStorageUsage() {
      try {
        const db = await this.initCacheDB();
        const tx = db.transaction('images', 'readonly');
        const store = tx.objectStore('images');
        let totalBytes = 0;

        await new Promise((resolve, reject) => {
          const cursor = store.openCursor();
          cursor.onsuccess = (e) => {
            const c = e.target.result;
            if (c) {
              const val = c.value;
              if (val instanceof Blob) {
                totalBytes += val.size;
              } else if (typeof val === 'string') {
                totalBytes += val.length;
              } else if (val instanceof ArrayBuffer) {
                totalBytes += val.byteLength;
              } else if (val && typeof val === 'object') {
                // Rough estimate for other objects
                totalBytes += JSON.stringify(val).length;
              }
              c.continue();
            } else {
              resolve();
            }
          };
          cursor.onerror = (e) => reject(e);
        });

        if (totalBytes > 1024 * 1024 * 1024) {
          this.storageUsage = (totalBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        } else if (totalBytes > 1024 * 1024) {
          this.storageUsage = (totalBytes / (1024 * 1024)).toFixed(1) + ' MB';
        } else if (totalBytes > 1024) {
          this.storageUsage = (totalBytes / 1024).toFixed(0) + ' KB';
        } else {
          this.storageUsage = totalBytes + ' B';
        }
      } catch {
        this.storageUsage = 'Unknown';
      }
    },
    async clearStorage() {
      if (
        !confirm(
          "Are you sure you want to clear the image cache? This will not delete your deck list, but images will need to be re-downloaded.",
        )
      )
        return;

      await this.clearCacheDB();
      if (this._processedImgCache) this._processedImgCache.clear();
      this.localImages = {};

      await this.checkStorageUsage();
      this.statusMessage = "Image cache cleared.";
      setTimeout(() => (this.statusMessage = ""), 3000);
    },
  },
};
