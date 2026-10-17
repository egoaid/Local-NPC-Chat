import { CONFIG } from './config.js';
import { getNpc, greetingFor } from './npcs.js';
import { buildMessages, cleanReply, finishCutoff } from './llm-prompts.js';
import * as LLM from './llm.js';
import * as Store from './storage.js';

export class Chat {
  constructor(handlers = {}) {
    this.h = handlers; // onStream(npcId, text) onDone(npcId) onError(err) getContext(npcId)->{world,custom,time,length}
    this.convs = Store.loadConversations();
    this.generating = false;
    this.stopRequested = false;
  }
  messages(npcId) { return this.convs[npcId] || (this.convs[npcId] = []); }
  save() { Store.saveConversations(this.convs); }

  ensureGreeting(npcId, periodKey = 'day') {
    const list = this.messages(npcId);
    if (!list.length) { list.push({ role: 'assistant', content: greetingFor(getNpc(npcId), periodKey), greeting: true }); this.save(); }
  }
  clear(npcId) { this.convs[npcId] = []; this.save(); }
  newConversation(npcId, periodKey) { this.clear(npcId); this.ensureGreeting(npcId, periodKey); }
  clearAll() { this.convs = {}; Store.clearConversationData(); }

  async send(npcId, rawText) {
    const text = rawText.trim().slice(0, CONFIG.context.maxInputChars);
    if (!text || this.generating) return null;
    const npc = getNpc(npcId);
    const list = this.messages(npcId);
    const history = [...list, { role: 'user', content: text }];
    list.push({ role: 'user', content: text });
    const reply = { role: 'assistant', content: '' };
    list.push(reply);
    this.generating = true; this.stopRequested = false;
    try {
      const ctx = this.h.getContext?.(npcId) || {};
      const { text: raw, truncated } = await LLM.generate(buildMessages(npc, history, ctx), (t) => {
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
  stop() { this.stopRequested = true; LLM.stop(); }
}
