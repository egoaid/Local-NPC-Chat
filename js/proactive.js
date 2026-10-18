// Scheduling rules for spontaneous NPC messages (pure functions; the app wires them to timers and the chat).
import { PROACTIVE } from './config.js';

export const INTERVAL_KEYS = Object.freeze(Object.keys(PROACTIVE.intervals));

/** Delay until the next spontaneous message: base interval +/- jitter. */
export function nextDelay(intervalKey, rand = Math.random) {
  const base = (PROACTIVE.intervals[intervalKey] || PROACTIVE.intervals.normal).ms;
  return Math.round(base * (1 - PROACTIVE.jitter + 2 * PROACTIVE.jitter * rand()));
}

/** Exactly ONE speaker. Skips characters with an unanswered spontaneous message; avoids repeating the last speaker. */
export function pickSpeaker({ characters, lastSpeakerId = null, blockedIds = [] }, rand = Math.random) {
  const blocked = new Set(blockedIds);
  let pool = characters.filter((c) => !blocked.has(c.id));
  if (pool.length > 1 && lastSpeakerId) pool = pool.filter((c) => c.id !== lastSpeakerId);
  return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}

/** Everything that must be true right now for a spontaneous message to start. Returns null if OK, else the reason. */
export function blockReason({ enabled, modelReady, hidden, busy, typing, streak, characters }) {
  if (!enabled) return 'disabled';
  if (!characters) return 'no-characters';
  if (!modelReady) return 'model-not-ready';
  if (hidden) return 'hidden';
  if (busy) return 'busy';
  if (typing) return 'typing';
  if (streak >= PROACTIVE.maxStreak) return 'streak-limit';
  return null;
}
