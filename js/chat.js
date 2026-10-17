import { CONFIG } from './config.js';
import { getNpc, greetingFor } from './npcs.js';
import { buildMessages, buildSummaryMessages, cleanReply, cleanSummary, finishCutoff } from './llm-prompts.js';
import * as LLMReal from './llm.js';
import * as Store from './storage.js';
import { selectRecent, pendingToFold } from './memory.js';

export class Chat {
  /** handlers: onStream(npcId,text) onDone(npcId) onError(err) onSummarizing(bool) getContext(npcId); llm (optional, for tests) */
  constructor(handlers = {}) {
    this.h = handlers;
    this.llm = handlers.llm || LLMReal;
    this.convs = Store.loadConversations();
    this.mem = Store.loadMemory(); // { [npcId]: { summary, through } }
    this.generating = false; this.summarizing = false; this.summaryAborted = false; this.summaryPromise = null;
    this.stopRequested = false;
    this.lastId = 0;
    for (const list of Object.values(this.convs)) for (const m of list) { if (!m.id) m.id = ++this.lastId; else this.lastId = Math.max(this.lastId, m.id); }
  }
  get busy() { return this.generating || this.summarizing; }
  newId() { this.lastId = Math.max(this.lastId + 1, Date.now()); return this.lastId; }
  messages(npcId) { return this.convs[npcId] || (this.convs[npcId] = []); }
  memoryOf(npcId) { return this.mem[npcId]?.summary || ''; }
  save() { Store.saveConversations(this.convs); }
  saveMem() { Store.saveMemory(this.mem); }

  ensureGreeting(npcId, periodKey = 'day') {
    const list = this.messages(npcId);
    if (!list.length) { list.push({ id: this.newId(), role: 'assistant', content: greetingFor(getNpc(npcId), periodKey), greeting: true }); this.save(); }
  }
  abortSummary() { if (this.summarizing) { this.summaryAborted = true; this.llm.stop(); } }
  clearMemory(npcId) { this.abortSummary(); delete this.mem[npcId]; this.saveMem(); }
  clear(npcId) { this.abortSummary(); this.convs[npcId] = []; delete this.mem[npcId]; this.save(); this.saveMem(); }
  newConversation(npcId, periodKey) { this.clear(npcId); this.ensureGreeting(npcId, periodKey); }
  clearAll() { this.abortSummary(); this.convs = {}; this.mem = {}; Store.clearConversationData(); this.saveMem(); }

  async send(npcId, rawText) {
    const text = rawText.trim().slice(0, CONFIG.context.maxInputChars);
    if (!text || this.generating) return null;
    if (this.summarizing) { this.abortSummary(); await this.summaryPromise; } // user comes first
    const npc = getNpc(npcId);
    const list = this.messages(npcId);
    const userMsg = { id: this.newId(), role: 'user', content: text };
    const history = [...list, userMsg];
    list.push(userMsg);
    const reply = { id: this.newId(), role: 'assistant', content: '' };
    list.push(reply);
    this.generating = true; this.stopRequested = false;
    try {
      const ctx = { ...(this.h.getContext?.(npcId) || {}) };
      ctx.memory = ctx.memoryOn === false ? '' : this.memoryOf(npcId);
      const { text: raw, truncated } = await this.llm.generate(buildMessages(npc, history, ctx), (t) => {
        reply.content = cleanReply(t, npc);
        this.h.onStream?.(npcId, reply.content);
      }, { maxNewTokens: ctx.length?.maxNewTokens });
      reply.content = cleanReply(raw, npc);
      // Cut off by the token limit (and not by the user's Stop): drop the unfinished tail.
      if (!this.stopRequested && truncated !== false) reply.content = finishCutoff(reply.content, { markIfNoBreak: truncated === true });
      if (!reply.content) reply.content = this.stopRequested ? '（……）' : '……';
      return reply.content;
    } catch (e) {
      if (!reply.content) list.pop(); // drop empty reply on failure
      this.h.onError?.(e);
      return null;
    } finally {
      this.generating = false;
      this.save();
      this.h.onDone?.(npcId);
    }
  }

  /** Folds messages that fell out of the recent window into the NPC's running summary (background, one pass at a time). */
  maybeSummarize(npcId) {
    if (this.busy || !this.llm.isLoaded()) return Promise.resolve(false);
    this.summarizing = true; this.summaryAborted = false; this.h.onSummarizing?.(true);
    this.summaryPromise = (async () => {
      let did = false;
      try {
        const npc = getNpc(npcId);
        for (let pass = 0; pass < 3 && !this.summaryAborted; pass++) {
          const mem = this.mem[npcId] || { summary: '', through: 0 };
          const pending = pendingToFold(this.messages(npcId), mem.through);
          if (pending.length < CONFIG.memory.minPending) break;
          const chunk = pending.slice(0, CONFIG.memory.maxChunk);
          const { text, truncated } = await this.llm.generate(buildSummaryMessages(npc, mem.summary, chunk), null,
            { maxNewTokens: CONFIG.memory.maxNewTokens, temperature: CONFIG.memory.temperature });
          if (this.summaryAborted) break;
          let s = cleanSummary(text).slice(0, CONFIG.memory.maxChars);
          if (truncated !== false || s.length >= CONFIG.memory.maxChars) s = finishCutoff(s, { markIfNoBreak: false });
          if (!s) break;
          this.mem[npcId] = { summary: s, through: chunk[chunk.length - 1].id };
          this.saveMem(); did = true;
        }
      } catch (e) { console.warn('summarize failed', e); }
      finally { this.summarizing = false; this.summaryAborted = false; this.h.onSummarizing?.(false); }
      return did;
    })();
    return this.summaryPromise;
  }

  stop() { this.stopRequested = true; this.llm.stop(); }
}
