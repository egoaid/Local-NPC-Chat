// Persistent state. All data lives in an in-memory cache with a SYNCHRONOUS API (loadX/saveX),
// persisted asynchronously to IndexedDB (fallback: localStorage, then memory only).
import { CONFIG } from './config.js';

const P = CONFIG.storagePrefix;
const DB_NAME = 'lnpc-db', STORE = 'kv', SCHEMA_VERSION = 2;
const DEFAULT_SETTINGS = {
  selectedNpc: null,     // selected character id
  speechOn: false, rate: 1.0,
  voices: {},            // { [characterId]: { ja: voiceName|'auto', en: voiceName|'auto' } }
  model: 'lfm25-350m',   // selected model key (see config.js MODELS)
  timeMode: 'auto',      // 'auto' (device clock) | morning|day|evening|night|late
  replyLength: 'normal', // short|normal|long
  dateMode: 'auto',      // 'auto' (device date) | 'fixed'
  fixedDate: '',         // 'YYYY-MM-DD' when dateMode === 'fixed'
  proactiveOn: true,     // NPCs sometimes speak first (short messages)
  proactiveInterval: 'normal', // short|normal|long
  useWorker: true,       // run inference in a Web Worker (falls back to the main thread automatically)
  lightMode: false,      // short history to reduce GPU load
  memoryOn: true,        // fold old conversation into a short summary ("memory")
  autoLoad: false,       // load the selected model at startup (only if already downloaded)
  modelVersions: {}      // { [modelKey]: version string last loaded }
};
const DEFAULTS = () => ({
  settings: {}, custom: { world: '', player: { name: '', profile: '', personality: '' } },
  conversations: {}, memory: {}, relations: {}, characters: [], meta: {}
});
const KEYS = Object.keys(DEFAULTS());

let cache = DEFAULTS(), backend = 'memory', db = null, errHandler = null, inited = false;
const timers = new Map(), dirty = new Set();

export const onStorageError = (fn) => { errHandler = fn; };
export const storageBackend = () => backend;

// ---- IndexedDB helpers ----
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => d.close(); resolve(d); }; // lets another tab's reset/upgrade proceed
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}
const idbTx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
const done = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function idbReadAll() {
  const store = idbTx('readonly');
  const [keys, vals] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
  const out = {}; keys.forEach((k, i) => { out[k] = vals[i]; });
  return out;
}
const idbPut = (key, value) => new Promise((res, rej) => {
  const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, key);
  tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted'));
});

// ---- localStorage helpers (legacy data + fallback backend) ----
const lsOk = () => { try { return typeof localStorage !== 'undefined' && !!localStorage; } catch { return false; } };
const lsRead = (key) => { try { const v = localStorage.getItem(P + key); return v ? JSON.parse(v) : undefined; } catch { return undefined; } };

/** Opens storage and loads everything into the cache. Call once, before using any loadX(). */
export async function initStorage() {
  cache = DEFAULTS(); let migrated = false;
  try {
    db = await openDb();
    backend = 'indexedDB';
    const rec = await idbReadAll();
    if (rec.meta?.schemaVersion >= SCHEMA_VERSION) {
      for (const k of KEYS) if (rec[k] !== undefined) cache[k] = rec[k];
    } else {
      // first run of the IndexedDB build: import what older builds kept in localStorage (left untouched as a backup)
      if (lsOk()) for (const k of KEYS) { const v = lsRead(k); if (v !== undefined) { cache[k] = v; migrated = true; } }
      cache.meta = { schemaVersion: SCHEMA_VERSION, createdAt: Date.now(), importedFromLocalStorage: migrated };
      await Promise.all(KEYS.map((k) => idbPut(k, cache[k])));
    }
  } catch (e) {
    db = null;
    if (lsOk()) { backend = 'localStorage'; for (const k of KEYS) { const v = lsRead(k); if (v !== undefined) cache[k] = v; } }
    else backend = 'memory';
    cache.meta = cache.meta?.schemaVersion ? cache.meta : { schemaVersion: SCHEMA_VERSION };
    errHandler?.(e);
  }
  if (!inited && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    addEventListener('pagehide', () => { flush(); });
  }
  inited = true;
  return { backend, migrated };
}

async function flushKey(key) {
  dirty.delete(key);
  const value = cache[key];
  try {
    if (backend === 'indexedDB') await idbPut(key, value);
    else if (backend === 'localStorage') localStorage.setItem(P + key, JSON.stringify(value));
  } catch (e) { errHandler?.(e); }
}
function persist(key) {
  dirty.add(key); clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); flushKey(key); }, 150));
  return true;
}
/** Writes everything that is still pending. */
export async function flush() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  await Promise.all([...dirty].map(flushKey));
}

// ---- synchronous API ----
export function loadSettings() {
  const raw = cache.settings || {};
  const s = { ...DEFAULT_SETTINGS, ...raw };
  if (raw.modelLoaded === true && raw.autoLoad === undefined) s.autoLoad = true; // from 0.1.x
  delete s.modelLoaded; delete s.modelKey;
  return s;
}
export const saveSettings = (s) => { cache.settings = s; return persist('settings'); };
export const loadCustom = () => cache.custom;
export const saveCustom = (c) => { cache.custom = c; return persist('custom'); };
export const loadCharacters = () => cache.characters;
export const saveCharacters = (list) => { cache.characters = list; return persist('characters'); };
export const loadConversations = () => cache.conversations;
export function saveConversations(c) {
  const trimmed = {};
  for (const [id, msgs] of Object.entries(c)) trimmed[id] = msgs.slice(-CONFIG.context.maxStoredMessages);
  cache.conversations = trimmed; return persist('conversations');
}
export function clearConversationData() { cache.conversations = {}; return persist('conversations'); }
export const loadMemory = () => cache.memory;
export const saveMemory = (m) => { cache.memory = m; return persist('memory'); };
export const loadRelations = () => cache.relations;
export const saveRelations = (r) => { cache.relations = r; return persist('relations'); };
export const loadMeta = () => cache.meta;
export const saveMeta = (m) => { cache.meta = { ...m, schemaVersion: SCHEMA_VERSION }; return persist('meta'); };

/** Snapshot for backups (deep copy). */
export const snapshot = () => JSON.parse(JSON.stringify({
  characters: cache.characters, custom: cache.custom, settings: loadSettings(),
  conversations: cache.conversations, memory: cache.memory, relations: cache.relations
}));
/** Replaces data (used by backup restore). Only the given keys are touched. */
export async function replaceData(part) {
  for (const k of ['characters', 'custom', 'settings', 'conversations', 'memory', 'relations']) if (part[k] !== undefined) { cache[k] = part[k]; persist(k); }
  await flush();
}

export async function requestPersistence() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
export async function storageStatus() {
  let persisted = null, usage = null, quota = null;
  try { persisted = (await navigator.storage?.persisted?.()) ?? null; } catch { /* ignore */ }
  try { const e = await navigator.storage?.estimate?.(); usage = e?.usage ?? null; quota = e?.quota ?? null; } catch { /* ignore */ }
  return { backend, persisted, usage, quota };
}

/** Deletes settings, characters, conversations (IndexedDB + localStorage) and caches; optionally the model files. */
export async function resetAppData({ includeModel = false } = {}) {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear(); dirty.clear(); cache = DEFAULTS();
  try { db?.close(); db = null; } catch { /* ignore */ }
  try { if (typeof indexedDB !== 'undefined') await new Promise((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); }); } catch { /* ignore */ }
  try { Object.keys(localStorage).filter((k) => k.startsWith(P)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  if ('caches' in globalThis) {
    try {
      for (const k of await caches.keys()) {
        if (k.startsWith('lnpc-shell-') || (includeModel && k === CONFIG.cacheName)) await caches.delete(k);
      }
    } catch { /* ignore */ }
  }
}
