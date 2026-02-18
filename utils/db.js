// --- Database & Utility Helpers ---
// IndexedDB persistence (cached connection) and debounce utility

const DB_NAME = "MTGProxyPrinterDB";
const STORE_NAME = "appState";

// --- CONSTANTS ---
export const PAPER_SIZES = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
};

// --- HELPER: IndexedDB Persistence (cached connection) ---
let _sessionDB = null;
const getSessionDB = () => {
  if (_sessionDB) {
    try { _sessionDB.objectStoreNames; return Promise.resolve(_sessionDB); } catch { _sessionDB = null; }
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (e) => { _sessionDB = e.target.result; resolve(_sessionDB); };
    request.onerror = () => reject(request.error);
  });
};

export const saveToDB = async (data) => {
  const db = await getSessionDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, "currentSession");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const loadFromDB = async () => {
  const db = await getSessionDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get("currentSession");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

// --- HELPER: Debounce ---
export const debounce = (fn, ms) => {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
};
