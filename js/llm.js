import { CONFIG } from './config.js';
import { createEngine } from './llm-core.js';


export async function checkWebGPU() {
  if (!('gpu' in navigator)) return { ok: false, reason: 'no-api' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'no-adapter' };
    const i = adapter.info || {};
    return { ok: true, f16: !!adapter.features?.has('shader-f16'), info: [i.vendor, i.architecture].filter(Boolean).join(' ') };
  } catch (e) { return { ok: false, reason: 'error', detail: String(e?.message || e) }; }
}

const urlOf = (r) => r.url.split('?')[0];

/** Is this model fully present in the browser cache? (Transformers.js only stores completed files.) */
export async function getCacheStatus(def) {
  if (!('caches' in globalThis)) return { supported: false, cached: false };
  try {
    if (!(await caches.has(CONFIG.cacheName))) return { supported: true, cached: false };
    const urls = (await (await caches.open(CONFIG.cacheName)).keys()).map(urlOf).filter((u) => u.includes(`/${def.id}/resolve/`));
    const has = (suffix) => urls.some((u) => u.endsWith(suffix));
    const cached = has(`/onnx/model_${def.dtype}.onnx`) && has(`/onnx/model_${def.dtype}.onnx_data`) && has('/tokenizer.json');
    return { supported: true, cached };
  } catch { return { supported: false, cached: false }; }
}

/** Removes only this model's files from the cache. Returns number of entries deleted. */
export async function deleteCache(def) {
  if (!('caches' in globalThis) || !(await caches.has(CONFIG.cacheName))) return 0;
  const c = await caches.open(CONFIG.cacheName);
  let n = 0;
  for (const r of await c.keys()) if (urlOf(r).includes(`/${def.id}/resolve/`) && (await c.delete(r))) n++;
  return n;
}

export async function storageEstimate() {
  try { const e = await navigator.storage?.estimate(); return e ? { usage: e.usage, quota: e.quota } : null; } catch { return null; }
}

// ---- engine backend: dedicated worker (default) or main thread (fallback) ----
let engine = null;               // main-thread engine (created lazily, only if needed)
let worker = null;               // active Worker
let mode = 'none';               // 'worker' | 'main' | 'none'
let useWorker = true;
let loadedKey = null;
let fallbackReason = '';
const pending = new Map();       // id -> {resolve, reject, onProgress, onText}
let nextId = 1;

export const setUseWorker = (v) => { useWorker = !!v; };
export const backendInfo = () => ({ mode, fallbackReason, workerSupported: typeof Worker !== 'undefined' });
export const isLoaded = () => loadedKey !== null;
export const currentKey = () => loadedKey;
export const __setEngineForTest = (e) => { engine = e; };

const mainEngine = () => engine || (engine = createEngine());
const mkErr = (o) => Object.assign(new Error(o?.message || 'worker error'), { name: o?.name || 'Error', code: o?.code, stack: o?.stack });

function rejectAll(err) { for (const p of pending.values()) p.reject(err); pending.clear(); }
function killWorker(reason = 'terminated') {
  if (!worker) return;
  const w = worker; worker = null;
  try { w.terminate(); } catch { /* ignore */ }
  rejectAll(Object.assign(new Error(reason), { code: 'worker-terminated' }));
}

function startWorker() {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') return reject(Object.assign(new Error('Worker is not supported'), { code: 'worker-unavailable' }));
    let w;
    try { w = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' }); }
    catch (e) { return reject(Object.assign(new Error(String(e?.message || e)), { code: 'worker-unavailable' })); }
    const timer = setTimeout(() => { try { w.terminate(); } catch { /* ignore */ } reject(Object.assign(new Error('Worker start timed out'), { code: 'worker-unavailable' })); }, 8000);
    let ready = false;
    w.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'ready') { ready = true; clearTimeout(timer); worker = w; resolve(w); return; }
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') p.onProgress?.(m.p);
      else if (m.type === 'text') p.onText?.(m.text);
      else if (m.type === 'done') { pending.delete(m.id); p.resolve(m.result); }
      else if (m.type === 'error') { pending.delete(m.id); p.reject(mkErr(m.error)); }
    };
    w.onerror = (ev) => {
      const err = Object.assign(new Error(ev?.message || 'Worker error'), { code: ready ? 'worker-crashed' : 'worker-unavailable' });
      clearTimeout(timer);
      if (!ready) { try { w.terminate(); } catch { /* ignore */ } reject(err); }
      else { worker = null; loadedKey = null; mode = 'none'; rejectAll(err); }
    };
  });
}

function rpc(type, payload = {}, handlers = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, ...handlers });
    worker.postMessage({ type, id, ...payload });
  });
}

/** Frees the model's GPU resources. In worker mode the whole worker is terminated (the most reliable release). */
export async function unloadModel() {
  loadedKey = null;
  if (worker) { killWorker('unloaded'); }
  if (engine) await engine.unload();
  mode = 'none';
}

/** Loads `def` (any previous model is released FIRST). onProgress({phase, loaded, total, pct}) */
export async function loadModel(def, onProgress) {
  if (loadedKey === def.key) return;
  await unloadModel();
  fallbackReason = '';
  if (useWorker) {
    try {
      await startWorker();
      await rpc('load', { def }, { onProgress });
      mode = 'worker'; loadedKey = def.key;
      return;
    } catch (e) {
      killWorker('load failed');
      if (e.code !== 'worker-unavailable' && e.code !== 'no-webgpu-in-worker') throw e; // real model errors are reported as-is
      fallbackReason = e.message; // fall through to the main thread
    }
  }
  try {
    await mainEngine().load(def, onProgress);
    mode = 'main'; loadedKey = def.key;
  } catch (e) { loadedKey = null; mode = 'none'; throw e; }
}

/** Returns {text, truncated}. */
export async function generate(messages, onText, opts = {}) {
  if (loadedKey === null) throw new Error('model-not-loaded');
  if (mode === 'worker') return rpc('generate', { messages, opts }, { onText });
  return mainEngine().generate(messages, onText, opts);
}

export function stop() {
  if (mode === 'worker') worker?.postMessage({ type: 'stop' });
  else engine?.stop();
}
