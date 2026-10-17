import { CONFIG } from './config.js';

let T = null, tokenizer = null, model = null, stopper = null, current = null;

export const isLoaded = () => !!model;
export const currentKey = () => current?.key || null;

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

/** Frees the model's GPU/ORT resources. Safe to call when nothing is loaded. */
export async function unloadModel() {
  stop();
  const m = model;
  model = null; tokenizer = null; current = null; stopper = null;
  try { await m?.dispose?.(); } catch (e) { console.warn('dispose failed', e); }
}

/** Loads `def`; any previously loaded model is released FIRST so two models never share GPU memory.
 *  onProgress({phase:'downloading'|'loading', loaded, total, pct}) */
export async function loadModel(def, onProgress) {
  if (model && current?.key === def.key) return;
  await unloadModel();
  T = T || (await import('../vendor/transformers.web.min.js'));
  T.env.allowLocalModels = false;
  T.env.useBrowserCache = true;
  const files = new Map();
  const cb = (p) => {
    if (p.status === 'progress' && p.total) {
      files.set(p.file, { loaded: p.loaded, total: p.total });
      let loaded = 0, total = 0;
      files.forEach((f) => { loaded += f.loaded; total += f.total; });
      const pct = total ? Math.min(100, (loaded / total) * 100) : 0;
      onProgress?.({ phase: pct >= 99.9 ? 'loading' : 'downloading', loaded, total, pct });
    }
  };
  onProgress?.({ phase: 'downloading', loaded: 0, total: 0, pct: 0 });
  try {
    tokenizer = await T.AutoTokenizer.from_pretrained(def.id, { revision: def.revision, progress_callback: cb });
    model = await T.AutoModelForCausalLM.from_pretrained(def.id, {
      revision: def.revision, dtype: def.dtype, device: 'webgpu', use_external_data_format: true, progress_callback: cb
    });
    current = def;
    onProgress?.({ phase: 'loading', loaded: 0, total: 0, pct: 100 });
  } catch (e) {
    await unloadModel(); // never leave a half-loaded model holding memory
    throw e;
  }
}

function toPromptString(messages) {
  return '<|startoftext|>' + messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('') + '<|im_start|>assistant\n';
}
function buildInputs(messages) {
  try { return tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true }); }
  catch { return tokenizer(toPromptString(messages), { add_special_tokens: false }); }
}

export async function generate(messages, onText) {
  if (!model) throw new Error('model-not-loaded');
  const inputs = buildInputs(messages);
  stopper = new T.InterruptableStoppingCriteria();
  let text = '';
  const streamer = new T.TextStreamer(tokenizer, {
    skip_prompt: true, skip_special_tokens: true,
    callback_function: (t) => { text += t; onText?.(text); }
  });
  const g = current.gen;
  try {
    await model.generate({
      ...inputs, max_new_tokens: g.maxNewTokens, do_sample: true, temperature: g.temperature,
      top_k: g.topK, repetition_penalty: g.repetitionPenalty, streamer, stopping_criteria: stopper
    });
  } finally { stopper = null; }
  return text;
}

export function stop() { stopper?.interrupt(); }
