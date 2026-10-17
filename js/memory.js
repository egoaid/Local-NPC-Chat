// Conversation-memory helpers (pure functions).
import { CONFIG } from './config.js';

/** Newest-first selection of recent messages within a character budget (always at least the last message). */
export function selectRecent(messages, { budgetChars = CONFIG.context.historyChars, maxMessages = CONFIG.context.maxMessages } = {}) {
  const usable = messages.filter((m) => m && m.content);
  const out = [];
  let used = 0;
  for (let i = usable.length - 1; i >= 0 && out.length < maxMessages; i--) {
    const len = usable[i].content.length;
    if (out.length && used + len > budgetChars) break;
    out.unshift(usable[i]); used += len;
  }
  return out;
}

/** Messages that have left the recent window and are not yet folded into the summary. */
export function pendingToFold(messages, through = 0, opts) {
  const real = messages.filter((m) => m && m.content && !m.greeting);
  const recentIds = new Set(selectRecent(messages, opts).map((m) => m.id));
  return real.filter((m) => !recentIds.has(m.id) && (m.id ?? 0) > through);
}
