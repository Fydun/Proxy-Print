/**
 * imageWorker.js — Web Worker for parallel card image processing.
 *
 * Each worker owns its own OffscreenCanvas and can independently:
 *   1. Receive an ImageBitmap + card settings from the main thread
 *   2. Crop / scale / draw proxy marker on an OffscreenCanvas
 *   3. Encode to JPEG via convertToBlob()
 *   4. Store the result directly in IndexedDB (workers have full access)
 *   5. Optionally return the data URL to the main thread (for PDF generation)
 */

// --- IndexedDB Cache (mirrors main-thread MTGProxyImageCache) ---

const DB_NAME = "MTGProxyImageCache";
const STORE_NAME = "images";

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function saveToCache(key, data) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getFromCache(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Blob → data URL conversion (no FileReader in workers) ---

async function blobToDataURL(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  // Process in chunks to avoid call-stack limits with String.fromCharCode
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < len; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + CHUNK, len)),
    );
  }
  return "data:image/jpeg;base64," + btoa(binary);
}

// --- Per-worker OffscreenCanvas (reused across tasks, no cross-worker conflicts) ---

let canvas = null;
let ctx = null;

function getCanvas(w, h) {
  if (!canvas) {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  } else if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { canvas, ctx };
}

// --- Message handler ---

self.onmessage = async (e) => {
  const { taskId, imageBitmap, settings } = e.data;

  try {
    const {
      cardW,
      cardH,
      bleed,
      pageBg,
      proxyMarker,
      scaleFactor,
      cacheKey,
      checkCache,
      returnData,
    } = settings;

    // Optional: check cache before processing (avoids redundant work)
    if (checkCache) {
      const existing = await getFromCache(cacheKey);
      if (existing) {
        if (imageBitmap) imageBitmap.close();
        let imageBuffer;
        if (returnData) {
          // Convert cached Blob (or legacy string) back to ArrayBuffer
          if (existing instanceof Blob) {
            imageBuffer = await existing.arrayBuffer();
          } else if (typeof existing === "string") {
            // Legacy base64 data URL — pass as-is via dataUrl field
            self.postMessage({ taskId, status: "done", cached: true, dataUrl: existing });
            return;
          }
        }
        const msg = { taskId, status: "done", cached: true, imageBuffer };
        self.postMessage(msg, imageBuffer ? [imageBuffer] : []);
        return;
      }
    }

    // Calculate target pixel dimensions (300 DPI = 12× scale)
    const targetW = Math.round((cardW + bleed * 2) * scaleFactor);
    const targetH = Math.round((cardH + bleed * 2) * scaleFactor);

    const { canvas: c, ctx: context } = getCanvas(targetW, targetH);

    // Clear and fill background
    context.clearRect(0, 0, targetW, targetH);
    context.fillStyle = pageBg;
    context.fillRect(0, 0, targetW, targetH);

    // Crop / scale to fit card aspect ratio (identical to main-thread logic)
    const targetRatio = cardW / cardH;
    const imgRatio = imageBitmap.width / imageBitmap.height;

    let sWidth, sHeight, sx, sy;
    if (imgRatio > targetRatio) {
      sHeight = imageBitmap.height;
      sWidth = sHeight * targetRatio;
      sy = 0;
      sx = (imageBitmap.width - sWidth) / 2;
    } else {
      sWidth = imageBitmap.width;
      sHeight = sWidth / targetRatio;
      sx = 0;
      sy = (imageBitmap.height - sHeight) / 2;
    }

    context.drawImage(
      imageBitmap,
      sx,
      sy,
      sWidth,
      sHeight,
      0,
      0,
      targetW,
      targetH,
    );

    // Free the transferred bitmap to release memory
    imageBitmap.close();

    // Proxy marker overlay
    if (proxyMarker) {
      context.font = `bold ${targetH * 0.025}px Arial`;
      context.fillStyle = "rgba(255,255,255,0.8)";
      context.textAlign = "center";
      context.fillText("PROXY", targetW / 2, targetH - targetH * 0.035);
    }

    // Encode to JPEG (quality 0.85 matches main-thread settings)
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.85 });

    // Store Blob directly in IDB (~33% smaller than base64 data URL)
    try {
      await saveToCache(cacheKey, blob);
    } catch (cacheErr) {
      console.warn("Worker cache write failed:", cacheErr);
    }

    // Only convert for caller if returnData is requested (PDF generation)
    // Transfer raw ArrayBuffer (zero-copy) instead of base64 string
    let imageBuffer;
    if (returnData) {
      imageBuffer = await blob.arrayBuffer();
    }

    const msg = {
      taskId,
      status: "done",
      cached: false,
      imageBuffer,
    };
    // Transfer the ArrayBuffer for zero-copy (buffer becomes detached in worker)
    self.postMessage(msg, imageBuffer ? [imageBuffer] : []);
  } catch (err) {
    // Clean up bitmap on error
    if (e.data.imageBitmap) {
      try {
        e.data.imageBitmap.close();
      } catch (_) {}
    }
    self.postMessage({ taskId, status: "error", error: err.message });
  }
};
