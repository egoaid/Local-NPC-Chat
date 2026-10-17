import { CONFIG } from './config.js';

const P = CONFIG.storagePrefix;
const DEFAULT_SETTINGS = {
  selectedNpc: 'ai_student', speechOn: false, rate: 1.0,
  voices: {}, // { [npcId]: { ja: voiceName|'auto', en: voiceName|'auto' } }
  model: 'lfm25-350m',   // selected model key (see config.js MODELS)
  timeMode: 'auto',      // 'auto' (device clock) | morning|day|evening|night|late
  replyLength: 'normal', // short|normal|long
  autoLoad: false,       // load the selected model at startup (only if already downloaded)
  modelVersions: {}      // { [modelKey]: version string last loaded }
};

function read(key, fallback) {
  try { const v = localStorage.getItem(P + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(P + key, JSON.stringify(value)); return true; } catch { return false; }
}

export function loadSettings() {
  const raw = read('settings', {});
  const s = { ...DEFAULT_SETTINGS, ...raw };
  if (raw.modelLoaded === true && raw.autoLoad === undefined) s.autoLoad = true; // migrate from build 0.1.x
  delete s.modelLoaded; delete s.modelKey;
  return s;
}
export const saveSettings = (s) => write('settings', s);
export const loadCustom = () => read('custom', { world: '', npcs: {} });
export const saveCustom = (c) => write('custom', c);
export const loadConversations = () => read('conversations', {});
export function saveConversations(c) {
  const trimmed = {};
  for (const [id, msgs] of Object.entries(c)) trimmed[id] = msgs.slice(-CONFIG.context.maxStoredMessages);
  return write('conversations', trimmed);
}
export function clearConversationData() { try { localStorage.removeItem(P + 'conversations'); } catch { /* ignore */ } }

/** Deletes settings + conversations; optionally the model cache and app-shell caches. */
export async function resetAppData({ includeModel = false } = {}) {
  try { Object.keys(localStorage).filter((k) => k.startsWith(P)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  if ('caches' in globalThis) {
    try {
      for (const k of await caches.keys()) {
        if (k.startsWith('lnpc-shell-') || (includeModel && k === CONFIG.cacheName)) await caches.delete(k);
      }
    } catch { /* ignore */ }
  }
}
