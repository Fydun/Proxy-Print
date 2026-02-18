// --- PDF Generation & Preview Mixin ---
// PDF creation, preview, image loading, cut guides, card rendering

import { PAPER_SIZES } from "../utils/db.js";

export default {
  methods: {
    handleImageError(e, item) {
      const img = e.target;
      const srcToCheck = img.getAttribute("src"); // Get raw src

      // Stop if we already fixed this URL to prevent loops
      if (srcToCheck && srcToCheck.includes("fix=cors")) return;

      console.warn("Fixing image source (CORS/Cache):", srcToCheck);

      const fixUrl = (url) => {
        if (!url) return url;
        // Clean any existing timestamps
        let clean = url.split("?")[0];
        // Append static fix that allows browser caching
        return clean + "?fix=cors";
      };

      // 1. If we passed a Card object, update it persistently
      if (item && typeof item === "object") {
        if (item.smallSrc && srcToCheck.includes(item.smallSrc.split("?")[0])) {
          item.smallSrc = fixUrl(item.smallSrc);
        } else if (item.smallBackSrc && srcToCheck.includes(item.smallBackSrc.split("?")[0])) {
          item.smallBackSrc = fixUrl(item.smallBackSrc);
        } else if (item.src && srcToCheck.includes(item.src.split("?")[0])) {
          item.src = fixUrl(item.src);
        } else if (item.backSrc && srcToCheck.includes(item.backSrc.split("?")[0])) {
          item.backSrc = fixUrl(item.backSrc);
        }
        // Force save so the fix remembers next reload
        this.saveSession();
      }
      // 2. If it's the Preview string
      else if (item === "preview") {
        this.previewImage = fixUrl(this.previewImage);
      }
      // 3. Fallback for direct DOM (though Vue update above should handle it)
      else {
        img.src = fixUrl(srcToCheck);
      }
    },

    loadImage(src) {
      // 1. Check Promise Cache (Deduplication within this print session)
      if (!this._imgPromiseCache) this._imgPromiseCache = new Map();
      const cached = this._imgPromiseCache.get(src);
      // Return cached promise only if it hasn't been rejected
      if (cached) {
        // If the promise was rejected, remove it so we can retry
        return cached.catch((err) => {
          this._imgPromiseCache.delete(src);
          throw err;
        });
      }

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
              src: this.resolveImage(card.smallSrc || card.src),
              backSrc: this.resolveImage(card.smallBackSrc || card.backSrc),
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
              i,
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
                  i,
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
      if (this.cards.length === 0) return;

      this.isGenerating = true;
      this.errorMessage = "";
      this.statusMessage = "Initializing PDF generation..."; // Notify user start

      // SNAPSHOT SETTINGS for stability during async generation
      const currentSettings = JSON.parse(JSON.stringify(this.settings));
      const useDuplex = this.globalDuplex && this.hasDFC;

      // Allow UI to update before heavy lifting starts
      await new Promise((r) => setTimeout(r, 50));

      try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
          orientation: "portrait",
          unit: "mm",
          format: currentSettings.paperSize,
        });

        const pageSize = PAPER_SIZES[currentSettings.paperSize];
        const pageWidth = pageSize.w;
        const pageHeight = pageSize.h;

        const scale = Number(currentSettings.cardScale) / 100;
        const cardW = Number(currentSettings.cardWidth) * scale;
        const cardH = Number(currentSettings.cardHeight) * scale;
        const gap = Number(currentSettings.gapSize);
        const bleed = Number(currentSettings.bleedMm);

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

        const canvas = this.$refs.procCanvas;
        const ctx = canvas.getContext("2d", { willReadFrequently: true }); // Optimization hint
        const scaleFactor = 12; // 300 DPI
        canvas.width = (cardW + bleed * 2) * scaleFactor;
        canvas.height = (cardH + bleed * 2) * scaleFactor;

        const totalBatches = Math.ceil(printQueue.length / itemsPerPage);
        const emptyPages = new Set();
        let totalProcessed = 0; // Track progress
        const failedCards = []; // Track specific failures

        // Process batches
        for (let b = 0; b < totalBatches; b++) {
          if (b > 0) doc.addPage();

          const batch = printQueue.slice(
            b * itemsPerPage,
            (b + 1) * itemsPerPage,
          );
          let needsBackPage = useDuplex;

          // Yield every batch to let the UI update and GC run
          await new Promise((r) => setTimeout(r, 0));

          // Pre-resolve all front images in parallel (utilizes full worker pool)
          const frontImageData = await this.resolveCardImages(
            batch.map((c) => c.src),
            cardW,
            cardH,
            canvas,
            ctx,
            currentSettings,
          );

          // Draw Fronts (sequential write to PDF using pre-resolved data)
          for (let i = 0; i < batch.length; i++) {
            const card = batch[i];

            try {
              const col = i % cols;
              const row = Math.floor(i / cols);
              const x = startX + col * (cardW + gap);
              const y = startY + row * (cardH + gap);
              const bleed = currentSettings.bleedMm || 0;

              if (frontImageData[i]) {
                doc.addImage(
                  frontImageData[i],
                  "JPEG",
                  x - bleed,
                  y - bleed,
                  cardW + bleed * 2,
                  cardH + bleed * 2,
                );
              } else {
                throw new Error("Image pre-resolve returned null");
              }

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
                currentSettings,
              );
            } catch (cardErr) {
              console.error("Failed to draw card:", card.name, cardErr);
              failedCards.push(card.name);

              // Draw a fallback "ERROR" box so the user sees it on the PDF
              try {
                doc.setDrawColor(255, 0, 0);
                doc.setLineWidth(0.5);
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = startX + col * (cardW + gap);
                const y = startY + row * (cardH + gap);
                doc.rect(x, y, cardW, cardH);
                doc.setFontSize(10);
                doc.setTextColor(255, 0, 0);
                doc.text("RENDER FAIL", x + 5, y + 10);
                doc.text(card.name.substring(0, 15), x + 5, y + 15);
              } catch (drawErr) {
                console.error("Could not even draw error box", drawErr);
              }
            }

            // Update Progress Bar
            totalProcessed++;
            const pct = Math.round(
              (totalProcessed / (printQueue.length * (needsBackPage ? 2 : 1))) *
                100,
            );
            this.statusMessage = `Generating Page ${b + 1}/${totalBatches} (${pct}%)...`;
          }

          // Breathe after each front page
          await new Promise((r) => setTimeout(r, 0));

          // Draw Backs (Duplex)
          if (needsBackPage) {
            doc.addPage();
            const hasBacksInBatch = batch.some((card) => card.backSrc);
            if (!hasBacksInBatch) {
              emptyPages.add(doc.internal.getNumberOfPages());
            }

            // Pre-resolve all back images in parallel
            const backSrcs = batch.map((c) => c.backSrc || null);
            const backImageData = await this.resolveCardImages(
              backSrcs,
              cardW,
              cardH,
              canvas,
              ctx,
              currentSettings,
            );

            for (let i = 0; i < batch.length; i++) {
              const card = batch[i];
              try {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const mirroredCol = cols - 1 - col;
                const x = startX + mirroredCol * (cardW + gap);
                const y = startY + row * (cardH + gap);
                const bleed = currentSettings.bleedMm || 0;

                if (backImageData[i]) {
                  doc.addImage(
                    backImageData[i],
                    "JPEG",
                    x - bleed,
                    y - bleed,
                    cardW + bleed * 2,
                    cardH + bleed * 2,
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
                    currentSettings,
                  );
                }
              } catch (backErr) {
                console.error(
                  "Failed to draw back for card:",
                  card.name,
                  backErr,
                );
              }
            }

            // Breathe after each back page
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        // Footer Text
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          if (emptyPages.has(i)) continue;
          doc.setPage(i);
          doc.setFontSize(8);
          doc.setTextColor(currentSettings.pageBg === "black" ? 100 : 150);
          doc.text(
            "Images via Scryfall. Proxy tool for personal playtesting only.",
            10,
            pageHeight - 5,
          );
        }

        this.statusMessage = "Finalizing PDF file...";
        await new Promise((r) => setTimeout(r, 10)); // One last breath
        doc.save(`proxies-${printQueue.length}-cards.pdf`);

        if (failedCards.length > 0) {
          this.errorMessage = `Generated with ${failedCards.length} errors: ${failedCards.slice(0, 3).join(", ")}${failedCards.length > 3 ? "..." : ""}`;
          this.statusMessage = "";
        } else {
          this.statusMessage = "PDF Downloaded Successfully!";
          setTimeout(() => (this.statusMessage = ""), 5000);
        }
      } catch (e) {
        console.error(e);
        this.errorMessage = `Failed to generate PDF. Error: ${e.message || e}`;
        this.statusMessage = "";
      } finally {
        this.isGenerating = false;
        // Resume prefetch if it was interrupted by PDF generation
        this.runPrefetch();
      }
    },

    drawCutGuides(
      doc,
      x,
      y,
      w,
      h,
      gap,
      col,
      row,
      maxCols,
      maxRows,
      settings = this.settings,
    ) {
      if (settings.cutMarks === "none") return;

      const isDark = settings.pageBg === "black";
      const color = isDark ? 255 : 150;
      doc.setDrawColor(color);
      doc.setLineWidth(0.1);

      if (settings.cutMarks === "dotted") doc.setLineDash([1, 1], 0);
      else doc.setLineDash([], 0);

      if (settings.cutMarks === "crosshairs") {
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

    // Pre-resolve an array of image sources into processed data URLs in parallel.
    // Uses the full worker pool for uncached images, then returns an array
    // aligned with the input (null for sources that were null/failed).
    async resolveCardImages(sources, cardW, cardH, canvas, ctx, settings) {
      const bleed = settings.bleedMm || 0;
      const scaleFactor = 12;

      // 1. Batch-check IDB cache for all sources in one transaction
      const cacheKeys = sources.map((src) =>
        src ? `${src}_${bleed}_${settings.pageBg}_${settings.proxyMarker}` : null,
      );
      const validKeys = cacheKeys.filter((k) => k !== null);
      let cachedResults;
      try {
        cachedResults = await this.getBatchFromCache(validKeys);
      } catch {
        cachedResults = new Map();
      }

      // 2. Process all sources concurrently
      const results = await Promise.all(
        sources.map(async (src, i) => {
          if (!src) return null;
          try {
            // Check cache first
            const cached = cachedResults.get(cacheKeys[i]);
            if (cached) return cached;

            // Not cached — process the image
            const imgObj = await this.loadImage(src);

            if (this._useWorkers) {
              const bitmap = await createImageBitmap(imgObj);
              const result = await this.processCardWithWorker(bitmap, {
                cardW,
                cardH,
                bleed,
                pageBg: settings.pageBg,
                proxyMarker: settings.proxyMarker,
                scaleFactor,
                cacheKey: cacheKeys[i],
                checkCache: false,
                returnData: true,
              });
              return result.dataUrl;
            } else {
              // Fallback: create a dedicated canvas per image (safe for concurrent calls)
              const fallbackCanvas = document.createElement("canvas");
              const fallbackCtx = fallbackCanvas.getContext("2d", { willReadFrequently: true });
              const targetW = (cardW + bleed * 2) * scaleFactor;
              const targetH = (cardH + bleed * 2) * scaleFactor;
              fallbackCanvas.width = targetW;
              fallbackCanvas.height = targetH;

              fallbackCtx.clearRect(0, 0, targetW, targetH);
              fallbackCtx.fillStyle = settings.pageBg;
              fallbackCtx.fillRect(0, 0, targetW, targetH);

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

              fallbackCtx.drawImage(imgObj, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);

              if (settings.proxyMarker) {
                fallbackCtx.font = `bold ${targetH * 0.025}px Arial`;
                fallbackCtx.fillStyle = "rgba(255,255,255,0.8)";
                fallbackCtx.textAlign = "center";
                fallbackCtx.fillText("PROXY", targetW / 2, targetH - targetH * 0.035);
              }

              const croppedData = fallbackCanvas.toDataURL("image/jpeg", 0.85);
              this.saveToCache(cacheKeys[i], croppedData).catch(() => {});
              return croppedData;
            }
          } catch (err) {
            console.warn("resolveCardImages failed for:", src, err);
            return null;
          }
        }),
      );

      return results;
    },

    async drawCardToPDF(
      doc,
      ctx,
      src,
      x,
      y,
      w,
      h,
      canvas,
      settings = this.settings,
    ) {
      try {
        const bleed = settings.bleedMm || 0;

        // Create a unique key based on visual settings
        const cacheKey = `${src}_${bleed}_${settings.pageBg}_${settings.proxyMarker}`;

        // Check IDB Cache
        let croppedData = await this.getFromCache(cacheKey);

        // If not in cache, process the image (offload to worker if available)
        if (!croppedData) {
          const imgObj = await this.loadImage(src);

          if (this._useWorkers) {
            // Worker path: offload canvas processing off the main thread
            const bitmap = await createImageBitmap(imgObj);
            const result = await this.processCardWithWorker(bitmap, {
              cardW: w,
              cardH: h,
              bleed,
              pageBg: settings.pageBg,
              proxyMarker: settings.proxyMarker,
              scaleFactor: 12,
              cacheKey,
              checkCache: false,
              returnData: true,
            });
            croppedData = result.dataUrl;
          } else {
            // Fallback: use the provided canvas (sequential, safe during PDF gen)
            const canvasW = canvas.width;
            const canvasH = canvas.height;

            ctx.clearRect(0, 0, canvasW, canvasH);
            ctx.fillStyle = settings.pageBg;
            ctx.fillRect(0, 0, canvasW, canvasH);

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

            if (settings.proxyMarker) {
              ctx.font = `bold ${canvasH * 0.025}px Arial`;
              ctx.fillStyle = "rgba(255,255,255,0.8)";
              ctx.textAlign = "center";
              ctx.fillText("PROXY", canvasW / 2, canvasH - canvasH * 0.035);
            }

            croppedData = canvas.toDataURL("image/jpeg", 0.85);
            await this.saveToCache(cacheKey, croppedData);
          }
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
};
