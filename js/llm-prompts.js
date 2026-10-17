import { CONFIG, LENGTHS } from './config.js';
import { TOWN } from './npcs.js';
import { LIMITS } from './customize.js';

const list = (a) => a.map((x) => `- ${x}`).join('\n');

/** ctx: { world?: string, custom?: string, time?: {label, guide, auto, hour}, length?: {sentences, chars} } */
export function buildSystemPrompt(npc, ctx = {}) {
  const g = npc.gender === 'male' ? '男性' : '女性';
  const len = ctx.length || LENGTHS.normal;
  const world = String(ctx.world || '').trim().slice(0, LIMITS.world);
  const custom = String(ctx.custom || '').trim().slice(0, LIMITS.npc);
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
  if (t) parts.push(`【現在の時間帯】${t.label}${t.auto && t.hour !== null ? `（${t.hour}時ごろ）` : ''}。${t.guide}`);
  const rules = [
    `必ず${npc.name}として、自然に答える。返答は${len.sentences}、${len.chars}字以内を目安にし、文を最後まで言い切る。`,
    '自分がAI・言語モデル・チャットボット・プログラムだとは言わない。'
  ];
  if (world || custom) rules.push('プレイヤーが決めた設定は事実として扱い、会話に自然に反映する。基本の設定と食い違う場合は、プレイヤーの設定を優先する。');
  rules.push('上に書かれていない町の事実や自分の経歴を勝手に作らない。知らないことは知らないと答える。');
  if (t) rules.push('時間帯に合った挨拶・話題・雰囲気で話す。ただし毎回時間の話をしない。');
  rules.push('毎回職業の話をしない。同じ決まり文句を繰り返さない。長々と説明しない。', 'プレイヤーが日本語なら日本語で、英語なら英語で答える。');
  parts.push('【ルール】', list(rules));
  return parts.join('\n');
}

/** history: [{role:'user'|'assistant', content}] (without the pending reply). */
export function buildMessages(npc, history, ctx) {
  const recent = history.filter((m) => m.content).slice(-CONFIG.context.maxTurns * 2);
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
