import { CONFIG, LENGTHS } from './config.js';
import { TOWN } from './npcs.js';
import { LIMITS } from './customize.js';
import { selectRecent } from './memory.js';

const list = (a) => a.map((x) => `- ${x}`).join('\n');

/** ctx: { world?: string, custom?: string, memory?: string, time?: {label, guide, auto, hour}, length?: {sentences, chars} } */
export function buildSystemPrompt(npc, ctx = {}) {
  const g = npc.gender === 'male' ? '男性' : '女性';
  const len = ctx.length || LENGTHS.normal;
  const world = String(ctx.world || '').trim().slice(0, LIMITS.world);
  const custom = String(ctx.custom || '').trim().slice(0, LIMITS.npc);
  const memory = String(ctx.memory || '').trim().slice(0, CONFIG.memory.maxChars);
  const t = ctx.time;
  const parts = [
    `あなたは「${TOWN.name}」に住む「${npc.name}」というキャラクターです。${npc.name}本人としてプレイヤーと会話します。`,
    `【プロフィール】${npc.age}歳 / ${g} / ${npc.occupation} / 一人称は「${npc.firstPerson}」`,
    `【性格】\n${list(npc.personality)}`,
    `【話し方】${npc.speechStyle}`,
    `【興味】${npc.interests.join('、')}`,
    `【知っていること】\n${list([...npc.knowledge, ...TOWN.facts])}`,
    `【知らないこと・苦手なこと】\n${list(npc.limitations)}`
  ];
  if (world) parts.push(`【この世界の設定（プレイヤーが決めた事実）】\n${world}`);
  if (custom) parts.push(`【${npc.name}の追加設定（プレイヤーが決めた事実）】\n${custom}`);
  if (memory) parts.push(`【これまでの会話の記憶（要約）】\n${memory}`);
  if (t) parts.push(`【現在の時間帯】${t.label}${t.auto && t.hour !== null ? `（${t.hour}時ごろ）` : ''}。${t.guide}`);
  const rules = [
    `必ず${npc.name}として、自然に答える。返答は${len.sentences}、${len.chars}字以内を目安にし、文を最後まで言い切る。`,
    '自分がAI・言語モデル・チャットボット・プログラムだとは言わない。'
  ];
  if (world || custom) rules.push('プレイヤーが決めた設定は事実として扱い、会話に自然に反映する。基本の設定と食い違う場合は、プレイヤーの設定を優先する。');
  if (memory) rules.push('記憶の内容は覚えているものとして自然に話す。記憶にないことは覚えていないと答えてよい。');
  rules.push('上に書かれていない町の事実や自分の経歴を勝手に作らない。知らないことは知らないと答える。');
  if (t) rules.push('時間帯に合った挨拶・話題・雰囲気で話す。ただし毎回時間の話をしない。');
  rules.push('毎回職業の話をしない。同じ決まり文句を繰り返さない。長々と説明しない。', 'プレイヤーが日本語なら日本語で、英語なら英語で答える。');
  parts.push('【ルール】', list(rules));
  return parts.join('\n');
}

/** history: [{role:'user'|'assistant', content}] (without the pending reply). */
export function buildMessages(npc, history, ctx) {
  const recent = selectRecent(history);
  return [{ role: 'system', content: buildSystemPrompt(npc, ctx) }, ...recent.map((m) => ({ role: m.role, content: m.content }))];
}

/** Removes template leftovers / speaker labels from model output. */
export function cleanReply(text, npc) {
  let t = String(text || '').replace(/<\|[^|>]*\|>/g, '').trim();
  const esc = npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp(`^[（(]?${esc}[）)]?\\s*[:：]\\s*`), '');
  return t.trim();
}

/** For replies cut off by the token limit: drop the trailing unfinished sentence.
 *  If there is no earlier sentence end, keep the text and mark it with '……'. */
export function finishCutoff(text, { markIfNoBreak = true } = {}) {
  const t = String(text || '').trim();
  if (!t || /[。！？!?.…～~♪」』）)]$/.test(t)) return t;
  const m = t.match(/^[\s\S]*[。！？!?][」』）)]*/);
  if (m && m[0].length >= 5) return m[0].trim();
  return markIfNoBreak ? `${t}……` : t;
}

/** Prompt that folds `chunk` (older messages) into the running summary. */
export function buildSummaryMessages(npc, prevSummary, chunk) {
  const log = chunk.map((m) => `${m.role === 'user' ? 'プレイヤー' : npc.name}：${m.content}`).join('\n');
  return [
    { role: 'system', content: `あなたは会話の記録係です。プレイヤーと${npc.name}の会話を、後で思い出すための短いメモにまとめます。プレイヤーが話した事柄（名前・好み・出来事・約束など）と、${npc.name}が答えた大事なことを、事実だけ${CONFIG.memory.maxChars}字以内の短い文章で書きます。推測・創作・感想は書かず、メモの本文だけを出力します。` },
    { role: 'user', content: `【これまでのメモ】\n${prevSummary || '（なし）'}\n\n【新しい会話】\n${log}\n\n上の内容を統合した、新しいメモだけを出力してください。` }
  ];
}
export function cleanSummary(text) {
  return String(text || '').replace(/<\|[^|>]*\|>/g, '').replace(/^\s*(?:新しい)?(?:メモ|要約)\s*[:：]\s*/, '').trim();
}
