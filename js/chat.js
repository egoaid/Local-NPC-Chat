import { CONFIG, PROACTIVE } from './config.js';
import { detectCalendarQuestion } from './world.js';
import { greetingFor } from './characters.js';
import { buildMessages, buildSummaryMessages, cleanReply, cleanSummary, finishCutoff } from './llm-prompts.js';
import * as LLMReal from './llm.js';
import * as Store from './storage.js';
import { selectRecent, pendingToFold } from './memory.js';
import { mentionsName, nameCooldownOk } from './player.js';

export class Chat {
  /** handlers: getCharacter(id) onStream(npcId,text) onDone(npcId) onError(err) onSummarizing(bool) onKnowsChange(id) onStats(stats) getContext(npcId); llm (optional, for tests) */
  constructor(handlers = {}) {
    this.h = handlers;
    this.llm = handlers.llm || LLMReal;
    this.convs = Store.loadConversations();
    this.mem = Store.loadMemory(); // { [npcId]: { summary, through } }
    this.rel = Store.loadRelations(); // { [npcId]: { knows: true } } -> has this NPC been introduced to the player?
    this.generating = false; this.proactiveRunning = false; this.proactiveAborted = false; this.proactivePromise = null; this.summarizing = false; this.summaryAborted = false; this.summaryPromise = null;
    this.stopRequested = false;
    this.lastId = 0;
    for (const list of Object.values(this.convs)) for (const m of list) { if (!m.id) m.id = ++this.lastId; else this.lastId = Math.max(this.lastId, m.id); }
  }
  get busy() { return this.generating || this.summarizing || this.proactiveRunning; }
  newId() { this.lastId = Math.max(this.lastId + 1, Date.now()); return this.lastId; }
  messages(npcId) { return this.convs[npcId] || (this.convs[npcId] = []); }
  knows(npcId) { return !!this.rel[npcId]?.knows; }
  setKnows(npcId, on) { if (on) this.rel[npcId] = { knows: true }; else delete this.rel[npcId]; Store.saveRelations(this.rel); }
  memoryOf(npcId) { return this.mem[npcId]?.summary || ''; }
  save() { Store.saveConversations(this.convs); }
  saveMem() { Store.saveMemory(this.mem); }

  ensureGreeting(npcId, periodKey = 'day') {
    const npc = this.h.getCharacter?.(npcId); if (!npc) return;
    const list = this.messages(npcId);
    if (!list.length) { list.push({ id: this.newId(), role: 'assistant', content: greetingFor(npc, periodKey), greeting: true }); this.save(); }
  }
  abortProactive() { if (this.proactiveRunning) { this.proactiveAborted = true; this.llm.stop(); } }
  hasUnansweredProactive(npcId) { const l = this.messages(npcId); const last = l[l.length - 1]; return !!(last && last.role === 'assistant' && last.proactive); }
  abortSummary() { if (this.summarizing) { this.summaryAborted = true; this.llm.stop(); } }
  clearMemory(npcId) { this.abortSummary(); delete this.mem[npcId]; this.saveMem(); this.setKnows(npcId, false); }
  clear(npcId) { this.abortSummary(); this.abortProactive(); this.convs[npcId] = []; delete this.mem[npcId]; this.save(); this.saveMem(); this.setKnows(npcId, false); }
  newConversation(npcId, periodKey) { this.clear(npcId); this.ensureGreeting(npcId, periodKey); }
  /** Removes every trace of a deleted character. */
  deleteData(npcId) { this.abortSummary(); this.abortProactive(); delete this.convs[npcId]; delete this.mem[npcId]; delete this.rel[npcId]; this.save(); this.saveMem(); Store.saveRelations(this.rel); }
  /** Replaces all state (backup restore). */
  replaceState({ conversations, memory, relations }) { this.abortSummary(); if (conversations) this.convs = conversations; if (memory) this.mem = memory; if (relations) this.rel = relations; for (const l of Object.values(this.convs)) for (const m of l) if (!m.id) m.id = this.newId(); this.save(); this.saveMem(); Store.saveRelations(this.rel); }
  clearAll() { this.abortSummary(); this.abortProactive(); this.convs = {}; this.mem = {}; this.rel = {}; Store.clearConversationData(); this.saveMem(); Store.saveRelations(this.rel); }

  /** What this NPC knows about the player: null = stranger, object = acquainted (see llm-prompts.js). */
  playerViewFor(npcId, ctx, list, text = '') {
    // Introduction: the NPC learns who the player is only when the player says their name (or the user toggles it manually).
    const pl = ctx.player || {};
    const name = String(pl.name || '').trim();
    if (text && !this.knows(npcId) && name && mentionsName(text, name)) { this.setKnows(npcId, true); this.h.onKnowsChange?.(npcId); }
    const known = this.knows(npcId) && !!(name || pl.profile || pl.personality);
    const recentNpc = list.filter((m) => m.role === 'assistant' && !m.greeting && m.content).slice(-2).map((m) => m.content);
    return known ? { name, profile: pl.profile || '', personality: pl.personality || '', mayCallName: !!name && nameCooldownOk(recentNpc, name) } : null;
  }

  /** The NPC speaks first (short). Returns the new message, or null (busy / no model / interrupted / failed). */
  speakFirst(npcId) {
    if (this.busy || !this.llm.isLoaded()) return Promise.resolve(null);
    const npc = this.h.getCharacter?.(npcId); if (!npc) return Promise.resolve(null);
    this.proactiveRunning = true; this.proactiveAborted = false;
    this.proactivePromise = (async () => {
      try {
        const list = this.messages(npcId);
        const ctx = { ...(this.h.getContext?.(npcId) || {}) };
        ctx.memory = ctx.memoryOn === false ? '' : this.memoryOf(npcId);
        ctx.length = PROACTIVE.length; ctx.proactive = true; ctx.calendarAsk = undefined;
        ctx.playerView = this.playerViewFor(npcId, ctx, list);
        const msgs = buildMessages(npc, list, ctx);
        msgs.push({ role: 'user', content: '（あなたのほうから、プレイヤーに話しかけてください）' });
        const { text: raw, truncated } = await this.llm.generate(msgs, null, { maxNewTokens: PROACTIVE.length.maxNewTokens });
        if (this.proactiveAborted || !this.h.getCharacter?.(npcId)) return null;
        let text = cleanReply(raw, npc);
        if (truncated !== false) text = finishCutoff(text, { markIfNoBreak: truncated === true });
        if (text.length < 2) return null;
        const msg = { id: this.newId(), role: 'assistant', content: text, proactive: true };
        this.messages(npcId).push(msg); this.save();
        return msg;
      } catch (e) { console.warn('spontaneous message failed', e); return null; }
      finally { this.proactiveRunning = false; this.proactiveAborted = false; }
    })();
    return this.proactivePromise;
  }

  async send(npcId, rawText) {
    const text = rawText.trim().slice(0, CONFIG.context.maxInputChars);
    if (!text || this.generating) return null;
    if (this.proactiveRunning) { this.abortProactive(); await this.proactivePromise; } // the player always comes first
    if (this.summarizing) { this.abortSummary(); await this.summaryPromise; } // user comes first
    const npc = this.h.getCharacter?.(npcId); if (!npc) return null;
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
      ctx.playerView = this.playerViewFor(npcId, ctx, list, text);
      ctx.calendarAsk = detectCalendarQuestion(text);
      const { text: raw, truncated, promptTokens, newTokens } = await this.llm.generate(buildMessages(npc, history, ctx), (t) => {
        reply.content = cleanReply(t, npc);
        this.h.onStream?.(npcId, reply.content);
      }, { maxNewTokens: ctx.length?.maxNewTokens });
      this.h.onStats?.({ promptTokens, newTokens, truncated });
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
        const npc = this.h.getCharacter?.(npcId); if (!npc) return false;
        for (let pass = 0; pass < 3 && !this.summaryAborted; pass++) {
          const mem = this.mem[npcId] || { summary: '', through: 0 };
          const pending = pendingToFold(this.messages(npcId), mem.through, this.h.getContext?.(npcId)?.budget);
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
