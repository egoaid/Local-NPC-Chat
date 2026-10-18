const M = (o) => Object.freeze({ ...o, gen: Object.freeze(o.gen), context: Object.freeze(o.context) });
/** "Light mode": minimal history to cut GPU load (applies to any model). */
export const LIGHT_CONTEXT = Object.freeze({ historyChars: 500, maxMessages: 8 });

/** Selectable models. Only ONE is ever resident in GPU memory (see llm.js). */
export const MODELS = Object.freeze([
  M({
    key: 'lfm25-350m', short: '350M', label: 'LFM2.5 350M（軽量・高速）',
    id: 'LiquidAI/LFM2.5-350M-ONNX', revision: 'main', dtype: 'q4', approxMB: 290, needsF16: false,
    context: { historyChars: 1500, maxMessages: 24 },
    note: '軽くて速いモデル。日本語はやや不自然になることがあります。',
    license: 'LFM Open License v1.0', sourceUrl: 'https://huggingface.co/LiquidAI/LFM2.5-350M-ONNX',
    gen: { maxNewTokens: 160, temperature: 0.6, topK: 50, repetitionPenalty: 1.1 }
  }),
  M({
    key: 'lfm25-1.2b-jp', short: '1.2B-JP', label: 'LFM2.5 1.2B JP（日本語向け・大きめ）',
    id: 'LiquidAI/LFM2.5-1.2B-JP-202606-ONNX', revision: 'main', dtype: 'q4f16', approxMB: 744, needsF16: true,
    context: { historyChars: 800, maxMessages: 12 }, // heavier model: shorter prompt = shorter GPU prefill
    note: '日本語向けの大きめのモデル。メモリに余裕のある端末向け（WebGPUのshader-f16が必要）。',
    license: 'LFM Open License v1.0', sourceUrl: 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-202606-ONNX',
    gen: { maxNewTokens: 160, temperature: 0.3, topK: 50, repetitionPenalty: 1.05 }
  })
]);
export const DEFAULT_MODEL_KEY = 'lfm25-350m';
export const getModel = (key) => MODELS.find((m) => m.key === key) || MODELS[0];
export const modelVersion = (m) => `${m.id}@${m.revision}#${m.dtype}`;

/** Reply length presets: token budget + the length asked of the model (see llm-prompts.js). */
export const LENGTHS = Object.freeze({
  short: Object.freeze({ label: '短め', maxNewTokens: 110, sentences: '1〜2文', chars: 60 }),
  normal: Object.freeze({ label: 'ふつう', maxNewTokens: 170, sentences: '2〜3文', chars: 110 }),
  long: Object.freeze({ label: '長め', maxNewTokens: 280, sentences: '3〜5文', chars: 200 })
});

/** Spontaneous "NPC speaks first" messages: very short on purpose (less GPU work). */
export const PROACTIVE = Object.freeze({
  length: Object.freeze({ label: '話しかけ', maxNewTokens: 70, sentences: '1〜2文', chars: 50 }),
  intervals: Object.freeze({
    short: Object.freeze({ label: '短め（約3分おき）', ms: 3 * 60 * 1000 }),
    normal: Object.freeze({ label: 'ふつう（約8分おき）', ms: 8 * 60 * 1000 }),
    long: Object.freeze({ label: '長め（約20分おき）', ms: 20 * 60 * 1000 })
  }),
  startupDelayMs: 4000, retryMs: 20000, jitter: 0.25,
  maxStreak: 3 // stop after this many unanswered spontaneous messages (until the player writes something)
});

export const CONFIG = Object.freeze({
  cacheName: 'transformers-cache', // Cache Storage name used by Transformers.js (holds downloaded models)
  idleReleaseMs: 5 * 60 * 1000,    // release GPU memory after the tab has been hidden this long
  context: Object.freeze({ historyChars: 1500, maxMessages: 24, maxStoredMessages: 60, maxInputChars: 400 }),
  memory: Object.freeze({ minPending: 4, maxChunk: 10, maxNewTokens: 130, maxChars: 300, temperature: 0.2 }),
  update: Object.freeze({ intervalMs: 30 * 60 * 1000, versionUrl: 'version.json' }),
  speech: Object.freeze({ minRate: 0.6, maxRate: 1.6, defaultRate: 1.0 }),
  storagePrefix: 'lnpc:',
  publicUrl: 'https://egoaid.github.io/Local-NPC-Chat/'
});
export const APP = globalThis.APP_VERSION || { version: 'unknown', appName: 'Local NPC Chat RPG', copyright: '© 2026 egoaid', rights: 'All rights reserved.' };
