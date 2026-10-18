// One-time migration from builds <= 0.6 (four fixed residents keyed by sample ids) to the character list.
import { SAMPLES, characterFromSample } from './samples.js';
import { CLIMITS } from './characters.js';

/** legacy: { conversations, memory, relations, custom }. Returns {characters, custom}. Idempotent for already-migrated data. */
export function migrateLegacy(legacy, now = Date.now()) {
  const conv = legacy.conversations || {}, mem = legacy.memory || {}, rel = legacy.relations || {};
  const notes = legacy.custom?.npcs || {};
  const characters = [];
  for (const s of SAMPLES) {
    const k = s.key;
    const has = (Array.isArray(conv[k]) && conv[k].length) || mem[k] || rel[k] || notes[k];
    if (!has) continue;
    const c = characterFromSample(s, k, now);
    if (notes[k]) c.notes = String(notes[k]).trim().slice(0, CLIMITS.notes);
    characters.push(c);
  }
  const custom = { ...(legacy.custom || {}) }; delete custom.npcs;
  return { characters, custom };
}
