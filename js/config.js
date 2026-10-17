export const CONFIG = Object.freeze({
  model: Object.freeze({
    id: 'LiquidAI/LFM2.5-350M-ONNX',
    revision: 'main',
    dtype: 'q4',
    device: 'webgpu',
    approxDownloadMB: 290,
    license: 'LFM Open License v1.0',
    sourceUrl: 'https://huggingface.co/LiquidAI/LFM2.5-350M-ONNX',
    cacheName: 'transformers-cache' // Cache Storage name used by Transformers.js
  }),
  generation: Object.freeze({ maxNewTokens: 160, temperature: 0.6, topK: 50, repetitionPenalty: 1.1 }),
  context: Object.freeze({ maxTurns: 6, maxStoredMessages: 40, maxInputChars: 400 }),
  update: Object.freeze({ intervalMs: 30 * 60 * 1000, versionUrl: 'version.json' }),
  speech: Object.freeze({ minRate: 0.6, maxRate: 1.6, defaultRate: 1.0 }),
  storagePrefix: 'lnpc:'
});
// Changes when the model identity changes -> user is told a new download may be needed.
export const MODEL_KEY = `${CONFIG.model.id}@${CONFIG.model.revision}#${CONFIG.model.dtype}`;
export const APP = globalThis.APP_VERSION || { version: 'unknown', appName: 'Local NPC Chat RPG', copyright: '© 2026 egoaid', rights: 'All rights reserved.' };
