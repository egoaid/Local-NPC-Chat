// Dedicated module worker: keeps heavy WebGPU inference off the page's main thread,
// and lets the page free ALL GPU resources by terminating this worker.
import { createEngine } from './llm-core.js';

const engine = createEngine();
const post = (m) => self.postMessage(m);
const errInfo = (e) => ({ name: e?.name || 'Error', message: String(e?.message || e), stack: String(e?.stack || '').slice(0, 1500), code: e?.code });

self.onmessage = async (ev) => {
  const { type, id } = ev.data || {};
  try {
    if (type === 'stop') { engine.stop(); return; }
    if (type === 'load') {
      if (!('gpu' in self.navigator)) { const e = new Error('WebGPU is not available in this worker'); e.code = 'no-webgpu-in-worker'; throw e; }
      await engine.load(ev.data.def, (p) => post({ type: 'progress', id, p }));
      post({ type: 'done', id });
    } else if (type === 'generate') {
      const result = await engine.generate(ev.data.messages, (text) => post({ type: 'text', id, text }), ev.data.opts || {});
      post({ type: 'done', id, result });
    } else if (type === 'unload') {
      await engine.unload();
      post({ type: 'done', id });
    }
  } catch (e) { post({ type: 'error', id, error: errInfo(e) }); }
};
post({ type: 'ready' });
