import { CONFIG, LENGTHS } from './config.js';
import { TOWN } from './samples.js';
import { GENDER_LABEL } from './characters.js';
import { LIMITS } from './customize.js';
import { selectRecent } from './memory.js';

const list = (a) => a.map((x) => `- ${x}`).join('\n');

/** ctx: { world?, memory?, playerView?, time?, calendar?, calendarAsk?, proactive?, length? }
 *  playerView: undefined (no info) | null (stranger: NPC knows nothing) | {name, profile, personality, mayCallName} (acquainted)
 *  npc: a character object (see characters.js). */
export function buildSystemPrompt(npc, ctx = {}) {
  const len = ctx.length || LENGTHS.normal;
  const world = String(ctx.world || '').trim().slice(0, LIMITS.world);
  const memory = String(ctx.memory || '').trim().slice(0, CONFIG.memory.maxChars);
  const t = ctx.time;
  const parts = [world
    ? `あなたは「${npc.name}」というキャラクターです。${npc.name}本人としてプレイヤーと会話します。`
    : `あなたは「${TOWN.name}」に住む「${npc.name}」というキャラクターです。${npc.name}本人としてプレイヤーと会話します。`];
  const prof = [npc.age ? `${npc.age}歳` : '', npc.gender === 'other' ? '' : GENDER_LABEL[npc.gender] || '', npc.occupation,
    npc.firstPerson ? `一人称は「${npc.firstPerson}」` : ''].filter(Boolean).join(' / ');
  if (prof) parts.push(`【プロフィール】${prof}`);
  if (npc.personality) parts.push(`【性格】${npc.personality}`);
  if (npc.speechStyle) parts.push(`【話し方】${npc.speechStyle}`);
  const lines = String(npc.sampleLines || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length) parts.push(`【セリフ例（口調の見本。そのまま繰り返さず、同じ雰囲気で話す）】\n${list(lines)}`);
  if (npc.interests) parts.push(`【興味】${npc.interests}`);
  if (npc.notes) parts.push(`【${npc.name}の追加設定（プレイヤーが決めた事実）】\n${npc.notes}`);
  if (world) parts.push(`【この世界の設定（プレイヤーが決めた事実）】\n${world}`);
  else parts.push(`【町について】\n${list(TOWN.facts)}`);
  const pv = ctx.playerView;
  if (pv) {
    const ls = [];
    if (pv.name) ls.push(`名前: ${pv.name}`);
    if (pv.profile) ls.push(`プロフィール: ${pv.profile}`);
    if (pv.personality) ls.push(`性格: ${pv.personality}`);
    if (ls.length) parts.push(`【話し相手（プレイヤー）について】\n${list(ls)}`);
  }
  if (memory) parts.push(`【これまでの会話の記憶（要約）】\n${memory}`);
  if (t) parts.push(`【現在の時間帯】${t.label}${t.auto && t.hour !== null ? `（${t.hour}時${String(t.minute).padStart(2, '0')}分）` : ''}。${t.guide}`);
  const cal = ctx.calendar;
  if (cal) parts.push(`【現在の日付】${cal.text}。季節は${cal.seasonLabel}。${cal.special ? `今日は${cal.special}。` : ''}${cal.guide}`);
  const rules = [
    `必ず${npc.name}として、自然に答える。返答は${len.sentences}、${len.chars}字以内を目安にし、文を最後まで言い切る。`,
    '自分がAI・言語モデル・チャットボット・プログラムだとは言わない。'
  ];
  if (npc.notes || world) rules.push('プレイヤーが決めた設定は事実として扱い、会話に自然に反映する。基本の設定と食い違う場合は、プレイヤーの設定を優先する。');
  if (pv === null) rules.push('相手の名前や素性はまだ知らない。名前で呼ばず、相手について勝手に決めつけない。');
  if (pv) {
    if (pv.profile || pv.personality) rules.push('話し相手のプロフィールや性格は、すでに知っていることとして自然に会話へ反映する。毎回は触れない。');
    if (pv.name) rules.push(pv.mayCallName
      ? `相手の名前は「${pv.name}」。この返事では名前で呼んでもよいが、必ず呼ぶ必要はない（呼び方は${npc.name}の話し方に合わせる）。`
      : '今回の返事では相手の名前を呼ばない。');
  }
  if (memory) rules.push('記憶の内容は覚えているものとして自然に話す。記憶にないことは覚えていないと答えてよい。');
  rules.push('上に書かれていない事実（町・他の人・自分の経歴）を勝手に作らない。知らないことは知らないと答える。');
  if (t) rules.push('時間帯に合った挨拶・話題・雰囲気で話す。ただし毎回時間の話をしない。');
  if (cal) rules.push('日付・曜日・時刻・季節を聞かれたら、上の「現在の日付」「現在の時間帯」の通りに正確に答える（キャラらしい口調で）。季節に合った話題・雰囲気で話すが、毎回、日付や季節の話をしない。');
  const ask = ctx.calendarAsk;
  if (cal && ask?.any) {
    const facts = [];
    if (ask.date || ask.weekday) facts.push(`今日は${cal.text}`);
    if (ask.time && t) facts.push(t.auto && t.hour !== null ? `現在は${t.hour}時${String(t.minute).padStart(2, '0')}分` : `今は${t.label}ごろ`);
    if (ask.season) facts.push(`季節は${cal.seasonLabel}`);
    if (facts.length) rules.push(`プレイヤーは日付や時刻のことを聞いている。必ず「${facts.join('。')}」という事実の通りに答える。`);
  }
  if (ctx.proactive) rules.push('今は、プレイヤーはまだ何も話していない。あなたのほうから、いまの時間帯や季節、会話の続きに合わせて、自然に1〜2文（50字以内）で話しかける。質問を1つ添えてもよい。定型のあいさつを繰り返さない。');
  rules.push('毎回職業の話をしない。同じ決まり文句を繰り返さない。長々と説明しない。', 'プレイヤーが日本語なら日本語で、英語なら英語で答える。');
  parts.push('【ルール】', list(rules));
  return parts.join('\n');
}

/** history: [{role:'user'|'assistant', content}] (without the pending reply). */
/** ctx.budget: {budgetChars, maxMessages} (see app.js: per-model / light mode). */
export function buildMessages(npc, history, ctx) {
  const recent = selectRecent(history, ctx?.budget);
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
