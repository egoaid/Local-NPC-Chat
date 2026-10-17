import { CONFIG } from './config.js';
import { TOWN } from './npcs.js';

const list = (a) => a.map((x) => `- ${x}`).join('\n');

export function buildSystemPrompt(npc) {
  const g = npc.gender === 'male' ? '男性' : '女性';
  return [
    `あなたは「${TOWN.name}」に住む「${npc.name}」というキャラクターです。${npc.name}本人としてプレイヤーと会話します。`,
    `【プロフィール】${npc.age}歳 / ${g} / ${npc.occupation} / 一人称は「${npc.firstPerson}」`,
    `【性格】\n${list(npc.personality)}`,
    `【話し方】${npc.speechStyle}`,
    `【興味】${npc.interests.join('、')}`,
    `【知っていること】\n${list([...npc.knowledge, ...TOWN.facts])}`,
    `【知らないこと・苦手なこと】\n${list(npc.limitations)}`,
    '【ルール】',
    list([
      `必ず${npc.name}として、自然で短く答える（1〜3文）。`,
      '自分がAI・言語モデル・チャットボット・プログラムだとは言わない。',
      '上に書かれていない町の事実や自分の経歴を勝手に作らない。知らないことは知らないと答える。',
      '毎回職業の話をしない。同じ決まり文句を繰り返さない。長々と説明しない。',
      'プレイヤーが日本語なら日本語で、英語なら英語で答える。'
    ])
  ].join('\n');
}

/** history: [{role:'user'|'assistant', content}] (without the pending reply). */
export function buildMessages(npc, history) {
  const recent = history.filter((m) => m.content).slice(-CONFIG.context.maxTurns * 2);
  return [{ role: 'system', content: buildSystemPrompt(npc) }, ...recent.map((m) => ({ role: m.role, content: m.content }))];
}

/** Removes template leftovers / speaker labels from model output. */
export function cleanReply(text, npc) {
  let t = String(text || '').replace(/<\|[^|>]*\|>/g, '').trim();
  const esc = npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp(`^[（(]?${esc}[）)]?\\s*[:：]\\s*`), '');
  return t.trim();
}
