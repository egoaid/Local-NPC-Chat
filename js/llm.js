import { CONFIG } from './config.js';

let T = null, tokenizer = null, model = null, stopper = null;

export const isLoaded = () => !!model;

export async function checkWebGPU() {
  if (!('gpu' in navigator)) return { ok: false, reason: 'no-api' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'no-adapter' };
    const i = adapter.info || {};
    return { ok: true, info: [i.vendor, i.architecture].filter(Boolean).join(' ') };
  } catch (e) { return { ok: false, reason: 'error', detail: String(e?.message || e) }; }
}

/** onProgress({phase:'downloading'|'loading', loaded, total, pct}) */
export async function loadModel(onProgress) {
  if (model) return;
  T = await import('../vendor/transformers.web.min.js');
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
  const id = CONFIG.model.id;
  tokenizer = await T.AutoTokenizer.from_pretrained(id, { revision: CONFIG.model.revision, progress_callback: cb });
  model = await T.AutoModelForCausalLM.from_pretrained(id, {
    revision: CONFIG.model.revision, dtype: CONFIG.model.dtype, device: CONFIG.model.device,
    use_external_data_format: true, progress_callback: cb
  });
  onProgress?.({ phase: 'loading', loaded: 0, total: 0, pct: 100 });
}

function toPromptString(messages) {
  // LFM2 chat format, used only if the tokenizer's own template fails.
  return '<|startoftext|>' + messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('') + '<|im_start|>assistant\n';
}

function buildInputs(messages) {
  try {
    return tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true });
  } catch {
    return tokenizer(toPromptString(messages), { add_special_tokens: false });
  }
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
  const g = CONFIG.generation;
  await model.generate({
    ...inputs, max_new_tokens: g.maxNewTokens, do_sample: true, temperature: g.temperature,
    top_k: g.topK, repetition_penalty: g.repetitionPenalty, streamer, stopping_criteria: stopper
  });
  stopper = null;
  return text;
}

export function stop() { stopper?.interrupt(); }
