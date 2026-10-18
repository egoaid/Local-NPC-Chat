// Group modes: characters talk to each other (improvised story / shiritori).
// Designed to be light: one speaker at a time, tiny prompts, tiny outputs, rules checked by code.
import { cleanReply, finishCutoff } from './llm-prompts.js';
import { validateWord, parseWordAnswer, lastSound, toHiragana, isKanaOnly, REASON_JA, STARTERS } from './kana.js';

export const GROUP = Object.freeze({
  maxParticipants: 4, titleMax: 40, directiveMax: 80,
  story: Object.freeze({ maxNewTokens: 80, temperature: 0.85, window: 6, turnChoices: [8, 12, 20], defaultTurns: 12 }),
  shiritori: Object.freeze({ maxNewTokens: 20, temperature: 0.7, usedShown: 15, maxWords: 30 }),
  paceMs: 1200
});

const STAGES = Object.freeze([
  '導入：舞台や雰囲気、登場人物を描く', '発端：事件や問題が起きる', '展開：手がかりや謎が増えていく',
  '転換：意外な事実や裏切りが分かる', 'クライマックス：核心に迫り、緊張が高まる', '結末：物語をここで締めくくる'
]);
export const stageFor = (turn, maxTurns) => (turn >= maxTurns - 1 ? 5 : Math.min(4, Math.floor((turn / Math.max(1, maxTurns - 1)) * 5)));

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
/** A very short persona (about 150-250 chars) instead of the full chat prompt: less prefill work. */
export function slimPersona(c) {
  const bits = [`${c.name}${c.age ? `（${c.age}歳` : '（'}${c.occupation ? `、${c.occupation}` : ''}${c.firstPerson ? `、一人称「${c.firstPerson}」` : ''}）`];
  if (c.personality) bits.push(`性格: ${clip(c.personality, 60)}`);
  if (c.speechStyle) bits.push(`話し方: ${clip(c.speechStyle, 60)}`);
  const line = String(c.sampleLines || '').split('\n').map((s) => s.trim()).find(Boolean);
  if (line) bits.push(`セリフ例: ${clip(line, 40)}`);
  if (c.notes) bits.push(`設定: ${clip(c.notes, 80)}`);
  return bits.join('。');
}

const similar = (a, b) => { // cheap near-duplicate check (character bigrams)
  const g = (s) => { const set = new Set(); const t = s.replace(/\s/g, ''); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
  const A = g(a), B = g(b); if (!A.size || !B.size) return false;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size) >= 0.7;
};

export class GroupSession {
  /** generate(messages, {maxNewTokens, temperature}) -> {text, truncated, aborted?} | null (null = engine busy, try again) */
  constructor({ mode, characters, title = '', maxTurns = GROUP.story.defaultTurns, includePlayer = false, playerName = 'あなた', generate, rand = Math.random }) {
    this.mode = mode; this.title = clip(title, GROUP.titleMax); this.maxTurns = maxTurns; this.generate = generate; this.rand = rand;
    this.lines = []; this.turn = 0; this.ended = false; this.started = false; this.directive = '';
    const order = [...characters].sort(() => rand() - 0.5);
    this.order = includePlayer && mode === 'shiritori' ? [...order, { id: '__player__', name: playerName || 'あなた', isPlayer: true }].sort(() => rand() - 0.5) : order;
    this.used = new Set(); this.required = null; this.lastWord = null; this.words = 0;
  }
  current() { return this.order[this.turn % this.order.length]; }
  push(line) { const l = { turn: this.turn, ...line }; this.lines.push(l); return l; }

  // ---------- story ----------
  storyMessages(speaker) {
    const stage = stageFor(this.turn, this.maxTurns);
    const last = this.turn >= this.maxTurns - 1;
    const sys = [
      `あなたは${slimPersona(speaker)}`,
      `複数人で、物語『${this.title}』を1人ずつ即興で語り継いでいます。`,
      `【いまの場面】${STAGES[stage]}`,
      '【ルール】',
      `- あなたの番では、${speaker.name}として1〜2文（60字以内）だけ語る。セリフでも地の文でもよい。`,
      '- 直前までの流れを受けて、新しい出来事・手がかり・セリフのどれか1つを足す。',
      '- 同じ内容を繰り返さない。これまでの登場人物や設定と矛盾させない。',
      last ? '- これが最後の番。物語をここで締めくくる。' : '- 物語を勝手に終わらせない。',
      '- 名前の見出しは書かず、語る文だけを出力する。',
      '- 「指示」があれば自然に取り入れる。'
    ].join('\n');
    const log = this.lines.filter((l) => l.kind !== 'system').slice(-GROUP.story.window)
      .map((l) => (l.kind === 'directive' ? `【指示】${l.text}` : `${l.name}：${l.text}`)).join('\n');
    return [{ role: 'system', content: sys }, { role: 'user', content: `【これまでの流れ】\n${log || '（まだ何も語られていません）'}\n\n${speaker.name}の番です。続きを語ってください。` }];
  }

  insertDirective(text) {
    const t = clip(text, GROUP.directiveMax);
    if (!t || this.ended || this.mode !== 'story') return null;
    return this.push({ kind: 'directive', name: 'あなた', text: t });
  }

  async stepStory() {
    const speaker = this.current();
    let text = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const msgs = this.storyMessages(speaker);
      if (attempt) msgs[1].content += '\n（直前と違う展開にしてください。）';
      const r = await this.generate(msgs, { maxNewTokens: GROUP.story.maxNewTokens, temperature: GROUP.story.temperature });
      if (!r) return { type: 'busy' };
      if (this.ended) return { type: 'stopped' };
      if (r.aborted) return { type: 'aborted' };
      text = cleanReply(r.text, speaker).replace(new RegExp(`^${speaker.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[：:]\\s*`), '');
      if (r.truncated !== false) text = finishCutoff(text, { markIfNoBreak: r.truncated === true });
      const prev = this.lines.filter((l) => l.kind === 'npc').at(-1);
      if (text.length >= 4 && !(prev && similar(text, prev.text))) break;
      if (attempt) { if (text.length < 4) text = '……'; }
    }
    const line = this.push({ kind: 'npc', speakerId: speaker.id, name: speaker.name, text });
    this.turn++;
    if (this.turn >= this.maxTurns) { this.ended = true; return { type: 'end', line, result: { reason: 'finished' } }; }
    return { type: 'line', line };
  }

  // ---------- shiritori ----------
  shiritoriMessages(speaker, feedback = '') {
    const used = [...this.used].slice(-GROUP.shiritori.usedShown);
    return [
      { role: 'system', content: 'しりとりのゲームです。指定された音で始まる名詞（物や生き物や場所の普通の名前）を1つだけ答えます。「ん」で終わる言葉と、すでに使われた言葉は禁止です。出力は「ことば|ひらがなのよみ」の形式だけ。例: りんご|りんご / 空|そら' },
      { role: 'user', content: `「${this.required}」から始まる言葉。使用済み: ${used.join('、') || 'なし'}${feedback}` }
    ];
  }
  accept(speaker, word, v) {
    this.used.add(v.reading); this.required = v.last; this.lastWord = v.reading; this.words++;
    const line = this.push({ kind: speaker.isPlayer ? 'player' : 'npc', speakerId: speaker.id, name: speaker.name, text: `「${word}」`, reading: v.reading });
    this.turn++;
    if (v.loses) {
      this.ended = true;
      const sys = this.push({ kind: 'system', name: '', text: `「${word}」は「ん」で終わってしまいました。${speaker.name}の負けです！` });
      return { type: 'end', line, system: sys, result: { reason: 'lost', loser: speaker.id, how: 'n' } };
    }
    if (this.words >= GROUP.shiritori.maxWords) {
      this.ended = true;
      const sys = this.push({ kind: 'system', name: '', text: `${this.words}語つながりました！ ここまでにしましょう。` });
      return { type: 'end', line, system: sys, result: { reason: 'limit' } };
    }
    return { type: 'line', line };
  }
  lose(speaker, why) {
    this.ended = true;
    const sys = this.push({ kind: 'system', name: '', text: `${speaker.name}は${why}。${speaker.name}の負けです！` });
    return { type: 'end', line: sys, result: { reason: 'lost', loser: speaker.id, how: 'fail' } };
  }
  async stepShiritori() {
    if (!this.started) {
      this.started = true;
      const pool = STARTERS.filter(([, rd]) => { const l = lastSound(rd); return l && l !== 'ん'; }); // never start the game on a losing sound
      const [w, r] = pool[Math.floor(this.rand() * pool.length)];
      this.used.add(r); this.required = lastSound(r); this.lastWord = r;
      const line = this.push({ kind: 'system', name: '', text: `しりとり、はじめ！ 最初の言葉は「${w}」。次は「${this.required}」から。` });
      return { type: 'line', line };
    }
    const speaker = this.current();
    if (speaker.isPlayer) return { type: 'wait-player', required: this.required };
    let feedback = '', last = null, nWord = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.generate(this.shiritoriMessages(speaker, feedback), { maxNewTokens: GROUP.shiritori.maxNewTokens, temperature: GROUP.shiritori.temperature });
      if (!r) return { type: 'busy' };
      if (this.ended) return { type: 'stopped' };
      if (r.aborted) return { type: 'aborted' };
      const a = parseWordAnswer(r.text);
      const v = a.reading ? validateWord(a.reading, { required: this.required, used: this.used }) : { ok: false, reason: 'not-kana' };
      if (v.ok && !v.loses) return this.accept(speaker, a.word || v.reading, v);
      if (v.ok && v.loses && !nWord) nWord = { a, v }; // an "ん" ending gets one chance to be fixed
      last = { a, v };
      feedback = `\n（前の答え「${a.word}」は${v.ok ? '「ん」で終わっています' : REASON_JA[v.reason] || '使えません'}。別の言葉を答えてください。）`;
    }
    if (nWord) return this.accept(speaker, nWord.a.word || nWord.v.reading, nWord.v); // could not fix it: the "ん" word stands
    return this.lose(speaker, '言葉が思いつきませんでした');
  }

  /** The player's word (hiragana/katakana). Returns {ok:false, error} or {ok:true, result}. */
  playerWord(text) {
    const speaker = this.current();
    if (this.ended || this.mode !== 'shiritori' || !speaker?.isPlayer) return { ok: false, error: 'いまはあなたの番ではありません。' };
    const r = toHiragana(clip(text, 30)).replace(/[「」『』\s]/g, '');
    if (!r) return { ok: false, error: '言葉を入力してください。' };
    if (!isKanaOnly(r)) return { ok: false, error: 'ひらがな（またはカタカナ）で入力してください。' };
    const v = validateWord(r, { required: this.required, used: this.used });
    if (!v.ok) return { ok: false, error: `${REASON_JA[v.reason]}。「${this.required}」から始まる別の言葉を。` };
    return { ok: true, result: this.accept(speaker, r, v) };
  }
  forfeit() {
    const speaker = this.current();
    if (this.ended || !speaker?.isPlayer) return null;
    return this.lose(speaker, '降参しました');
  }

  async step() {
    if (this.ended) return { type: 'end', result: { reason: 'finished' } };
    return this.mode === 'story' ? this.stepStory() : this.stepShiritori();
  }
  stop() { this.ended = true; }
  exportText() {
    const head = this.mode === 'story' ? `物語『${this.title}』` : 'しりとり';
    const body = this.lines.map((l) => (l.kind === 'system' ? `（${l.text}）` : l.kind === 'directive' ? `【あなたの指示】${l.text}` : `${l.name}：${l.text}${l.reading && l.reading !== l.text.replace(/[「」]/g, '') ? `（${l.reading}）` : ''}`)).join('\n');
    return `${head}\n\n${body}\n`;
  }
}
