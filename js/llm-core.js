// Inference engine. Runs either inside llm-worker.js (default) or on the main thread (fallback).
// Must not touch the DOM / localStorage.
export function createEngine() {
  let T = null, tokenizer = null, model = null, stopper = null, current = null;

  function toPromptString(messages) {
    return '<|startoftext|>' + messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('') + '<|im_start|>assistant\n';
  }
  function buildInputs(messages) {
    try { return tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true }); }
    catch { return tokenizer(toPromptString(messages), { add_special_tokens: false }); }
  }

  const engine = {
    isLoaded: () => !!model,
    currentKey: () => current?.key || null,

    async unload() {
      engine.stop();
      const m = model;
      model = null; tokenizer = null; current = null; stopper = null;
      try { await m?.dispose?.(); } catch (e) { console.warn('dispose failed', e); }
    },

    /** onProgress({phase:'downloading'|'loading', loaded, total, pct}) */
    async load(def, onProgress) {
      if (model && current?.key === def.key) return;
      await engine.unload();
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
        await engine.unload(); // never leave a half-loaded model holding memory
        throw e;
      }
    },

    /** Returns {text, truncated}: truncated=true if the token limit was hit, false if not, null if unknown. */
    async generate(messages, onText, { maxNewTokens, temperature } = {}) {
      if (!model) throw new Error('model-not-loaded');
      const inputs = buildInputs(messages);
      stopper = new T.InterruptableStoppingCriteria();
      let text = '';
      const streamer = new T.TextStreamer(tokenizer, {
        skip_prompt: true, skip_special_tokens: true,
        callback_function: (t) => { text += t; onText?.(text); }
      });
      const g = current.gen;
      const limit = maxNewTokens || g.maxNewTokens;
      let truncated = null;
      try {
        const out = await model.generate({
          ...inputs, max_new_tokens: limit, do_sample: true, temperature: temperature ?? g.temperature,
          top_k: g.topK, repetition_penalty: g.repetitionPenalty, streamer, stopping_criteria: stopper
        });
        try {
          const total = out?.dims?.[1] ?? out?.sequences?.dims?.[1] ?? out?.[0]?.dims?.[1];
          const plen = inputs.input_ids.dims[1];
          if (typeof total === 'number') truncated = total - plen >= limit;
        } catch { /* unknown */ }
      } finally { stopper = null; }
      return { text, truncated };
    },

    stop() { stopper?.interrupt(); }
  };
  return engine;
}
