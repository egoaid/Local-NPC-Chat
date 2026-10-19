// Scenario experiment: characters talk freely, grounded in an author-written scenario (background, characters,
// relationships, timeline). Every generated line is checked MECHANICALLY against the scenario (no dictionary, no model-as-judge).
import { cleanReply, finishCutoff } from './llm-prompts.js';

export const SCENARIO_SCHEMA = 'local-npc-chat-rpg/scenario';
export const SLIM = Object.freeze({ chars: [2, 6], timeline: 12, relationships: 24, fileBytes: 40 * 1024 });
export const STRATEGIES = Object.freeze({
  focused: '絞り込み（話す人に必要な情報だけ）', full: '全部入り（シナリオ全体をそのまま渡す）', minimal: '最小（人物と場面だけ）'
});
export const SCENARIO_LIMITS = Object.freeze({
  title: 40, genre: 40, background: 800, tone: 120, name: 20, occupation: 30, firstPerson: 10, alias: 12, personality: 200, speechStyle: 150,
  ending: 8, sampleLine: 60, wants: 150, secret: 150, keyword: 14, feeling: 160, when: 30, scene: 200, summary: 160, goal: 120
});
const L = SCENARIO_LIMITS;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const list = (a, n, m) => (Array.isArray(a) ? a.map((x) => clean(x, n)).filter(Boolean).slice(0, m) : []);
const KEY_OK = /^[A-Za-z0-9_-]{1,20}$/;
const GENDER = ['male', 'female', 'other'];

/** Validates/cleans a scenario object. Returns {ok, scenario?, errors[], warnings[]}. Never throws. */
export function sanitizeScenario(raw, byteSize = 0) {
  const errors = [], warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== SCENARIO_SCHEMA) return { ok: false, errors: ['このアプリのシナリオファイルではありません（schema が違います）。'], warnings };
  if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion > 1) return { ok: false, errors: ['新しい形式のファイルです。アプリを更新してください。'], warnings };
  if (byteSize > SLIM.fileBytes) return { ok: false, errors: [`ファイルが大きすぎます（${Math.round(SLIM.fileBytes / 1024)}KBまで）。`], warnings };
  const sc = { schema: SCENARIO_SCHEMA, schemaVersion: 1, title: clean(raw.title, L.title), genre: clean(raw.genre, L.genre), background: clean(raw.background, L.background), tone: clean(raw.tone, L.tone), characters: [], relationships: [], timeline: [] };
  if (!sc.title) errors.push('title（題名）が必要です。');
  if (!sc.background) warnings.push('background（背景）が空です。');
  const keys = new Set();
  (Array.isArray(raw.characters) ? raw.characters : []).slice(0, SLIM.chars[1]).forEach((c, i) => {
    let key = KEY_OK.test(String(c?.key ?? '')) && !keys.has(c.key) ? c.key : `c${i + 1}`;
    while (keys.has(key)) key += 'x';
    keys.add(key);
    const ch = {
      key, name: clean(c?.name, L.name), age: String(c?.age ?? '').replace(/[^0-9]/g, '').slice(0, 3), gender: GENDER.includes(c?.gender) ? c.gender : 'other',
      occupation: clean(c?.occupation, L.occupation), firstPerson: clean(c?.firstPerson, L.firstPerson), aliases: list(c?.aliases, L.alias, 5),
      personality: clean(c?.personality, L.personality), speechStyle: clean(c?.speechStyle, L.speechStyle), endings: list(c?.endings, L.ending, 8),
      sampleLines: list(c?.sampleLines, L.sampleLine, 3), wants: clean(c?.wants, L.wants), secret: clean(c?.secret, L.secret),
      secretKeywords: list(c?.secretKeywords, L.keyword, 5), revealAt: clean(c?.revealAt, 20) || null
    };
    if (!ch.name) { errors.push(`登場人物${i + 1}に name（名前）がありません。`); return; }
    if (!ch.firstPerson) warnings.push(`${ch.name}: firstPerson（一人称）が未設定のため、一人称のチェックはできません。`);
    if (!ch.endings.length) warnings.push(`${ch.name}: endings（語尾の例）が未設定のため、口調一致のチェックはできません。`);
    if (!ch.sampleLines.length) warnings.push(`${ch.name}: sampleLines（セリフ例）が未設定です（口調が安定しにくくなります）。`);
    if (ch.secret && !ch.secretKeywords.length) warnings.push(`${ch.name}: secret はありますが secretKeywords が未設定のため、秘密の漏れをチェックできません。`);
    sc.characters.push(ch);
  });
  if (sc.characters.length < SLIM.chars[0]) errors.push(`登場人物は${SLIM.chars[0]}人以上必要です。`);
  const ck = new Set(sc.characters.map((c) => c.key));
  (Array.isArray(raw.relationships) ? raw.relationships : []).slice(0, SLIM.relationships).forEach((r) => {
    if (!ck.has(r?.from) || !ck.has(r?.to) || r.from === r.to) { warnings.push('登場人物にない（または同一の）関係を1件スキップしました。'); return; }
    const feeling = clean(r.feeling, L.feeling); if (feeling) sc.relationships.push({ from: r.from, to: r.to, feeling });
  });
  const ids = new Set();
  (Array.isArray(raw.timeline) ? raw.timeline : []).slice(0, SLIM.timeline).forEach((e, i) => {
    let id = KEY_OK.test(String(e?.id ?? '')) && !ids.has(e.id) ? e.id : `s${i + 1}`;
    while (ids.has(id)) id += 'x';
    ids.add(id);
    const ev = {
      id, when: clean(e?.when, L.when), scene: clean(e?.scene, L.scene), summary: clean(e?.summary, L.summary), goal: clean(e?.goal, L.goal),
      participants: list(e?.participants, 20, 6).filter((k) => ck.has(k)), knownBy: list(e?.knownBy, 20, 6).filter((k) => ck.has(k)), keywords: list(e?.keywords, L.keyword, 6)
    };
    if (!ev.when && !ev.scene) { warnings.push(`時系列${i + 1}に when/scene がないためスキップしました。`); return; }
    if (!ev.goal) warnings.push(`場面「${ev.when || ev.id}」: goal（この場面で起こること）が未設定です。`);
    if (!ev.keywords.length) warnings.push(`場面「${ev.when || ev.id}」: keywords が未設定のため、時系列の矛盾（未来の出来事の漏れ）をチェックできません。`);
    sc.timeline.push(ev);
  });
  if (!sc.timeline.length) errors.push('timeline（時系列）が1つ以上必要です。');
  const sid = new Set(sc.timeline.map((e) => e.id));
  for (const c of sc.characters) if (c.revealAt && !sid.has(c.revealAt)) { warnings.push(`${c.name}: revealAt「${c.revealAt}」に対応する場面がないため無視しました。`); c.revealAt = null; }
  return errors.length ? { ok: false, errors, warnings } : { ok: true, scenario: sc, errors, warnings };
}

// ---------------- prompt construction ----------------
const nameOf = (sc, key) => sc.characters.find((c) => c.key === key)?.name || key;
export const namesOf = (c) => [...new Set([c.name, ...c.aliases, ...c.name.split(/\s+/).filter((p) => p.length >= 2)])];
const J = (a) => a.filter(Boolean).join('\n');

function profile(c, withSecret) {
  return J([`${c.name}（${[c.age ? `${c.age}歳` : '', c.occupation].filter(Boolean).join('・')}）${c.firstPerson ? ` 一人称「${c.firstPerson}」` : ''}`,
    c.personality && `性格: ${c.personality}`, c.speechStyle && `話し方: ${c.speechStyle}`, c.sampleLines.length && `セリフ例: ${c.sampleLines.map((s) => `「${s}」`).join(' ')}`,
    c.wants && `望み: ${c.wants}`, withSecret && c.secret && `秘密（本人だけが知っている。自分から明かさない）: ${c.secret}`]);
}
const visibleEvents = (sc, idx, c) => sc.timeline.slice(0, idx + 1).filter((e) => !e.knownBy.length || e.knownBy.includes(c.key));

/** strategy: focused | full | minimal. Returns [{role:'system'},{role:'user'}]. */
export function buildTurnMessages(sc, speaker, { sceneIdx, history, strategy = 'focused', note = '' }) {
  const scene = sc.timeline[sceneIdx];
  const head = `あなたは「${speaker.name}」。恋愛ドラマ『${sc.title}』の登場人物として、他の人物と会話している。${sc.tone ? `トーン: ${sc.tone}` : ''}`;
  const sceneBlock = `【いまの場面】${scene.when}${scene.scene ? `｜${scene.scene}` : ''}${scene.goal ? `\nこの場面で起こること: ${scene.goal}` : ''}`;
  const rules = ['【ルール】', `- ${speaker.name}として、1〜2文（60字以内）だけ話す。セリフだけを書く。`, '- 他の人の発言やナレーションは書かない。名前の見出し（「〇〇：」）も書かない。',
    '- 自分が知らないこと・自分の秘密を、自分から明かさない。', speaker.firstPerson ? `- 一人称は「${speaker.firstPerson}」。口調を保つ。` : '- 口調を保つ。'].join('\n');
  let body;
  if (strategy === 'minimal') body = J([profile(speaker, false), sceneBlock]);
  else if (strategy === 'full') {
    body = J([`【物語の背景】\n${sc.background}`, '【登場人物（全員）】', ...sc.characters.map((c) => profile(c, true)),
      '【人間関係】', ...sc.relationships.map((r) => `${nameOf(sc, r.from)}→${nameOf(sc, r.to)}: ${r.feeling}`),
      '【時系列（全体）】', ...sc.timeline.map((e) => `${e.when}: ${e.summary || e.scene}`), sceneBlock]);
  } else {
    const mine = sc.relationships.filter((r) => r.from === speaker.key).map((r) => `${nameOf(sc, r.to)}への気持ち: ${r.feeling}`);
    const others = sc.characters.filter((c) => c.key !== speaker.key && (!scene.participants.length || scene.participants.includes(c.key)))
      .map((c) => `${c.name}（${c.occupation || '—'}）${c.personality ? `: ${c.personality.slice(0, 50)}` : ''}`);
    const past = visibleEvents(sc, sceneIdx - 1, speaker).slice(-4).map((e) => `${e.when}: ${e.summary || e.scene}`);
    body = J([`【物語の背景】\n${sc.background.slice(0, 400)}`, `【あなた】\n${profile(speaker, true)}`, mine.length && `【あなたの気持ち・関係】\n${mine.join('\n')}`,
      others.length && `【この場にいる人】\n${others.join('\n')}`, past.length && `【ここまでの出来事（あなたが知っていること）】\n${past.join('\n')}`, sceneBlock]);
  }
  const log = history.slice(-6).map((l) => `${l.name}：${l.text}`).join('\n') || '（まだ誰も話していません）';
  return [{ role: 'system', content: `${head}\n${body}\n${rules}` },
    { role: 'user', content: `【ここまでの会話】\n${log}\n\n${speaker.name}の番です。${note}` }];
}

// ---------------- mechanical checks ----------------
// first-person pronoun groups (ambiguous everyday words such as 自分 / うち are not used for detection)
const PRON_RE = [/私|わたし|ワタシ/, /僕|ボク|ぼく(?=[はがのもをにへ、。！？\s]|$)/, /俺|オレ|おれ(?=[はがのもをにへ、。！？\s]|$)/, /あたし|アタシ/];
const groupOf = (w) => PRON_RE.findIndex((re) => new RegExp(`^(?:${re.source})$`).test(String(w || '')));
const JAC = /[぀-ヿ一-鿿ー、。！？「」]/;
const bg = (s) => { const t = String(s).replace(/\s/g, ''); const set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
const overlap = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.min(a.size, b.size); };
export const VIOL = Object.freeze({
  empty: '空', 'multi-line': '複数行', 'too-long': '長すぎる', 'label-self': '自分の名前見出し', 'label-other': '他人の発言を代筆', 'prompt-leak': '指示文の漏れ',
  'self-ref': 'AI・モデルへの言及', 'secret-leak': '秘密の漏れ', 'future-leak': '未来の出来事の漏れ', 'unknown-knowledge': '知らないはずの出来事', 'wrong-first-person': '一人称の誤り',
  'unknown-name': '未知の呼び名', 'non-japanese': '日本語でない', repeat: '直前までの繰り返し'
});
export const SOFT = Object.freeze({ 'ending-miss': '語尾の例に合わない' });

/** Returns {hard:[codes], soft:[codes]} for one generated text. ctx: {sc, speaker, sceneIdx, history} */
export function checkLine(raw, { sc, speaker, sceneIdx, history = [] }) {
  const text = String(raw ?? '').trim(), hard = [], soft = [];
  if (!text) return { hard: ['empty'], soft };
  if (text.split(/\r?\n/).filter((l) => l.trim()).length > 1) hard.push('multi-line');
  if ([...text].length > 100) hard.push('too-long');
  const others = sc.characters.filter((c) => c.key !== speaker.key);
  if (others.some((c) => namesOf(c).some((n) => text.includes(`${n}：`) || text.includes(`${n}:`)))) hard.push('label-other');
  if (namesOf(speaker).some((n) => new RegExp(`(^|\\n)\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[：:]`).test(text))) hard.push('label-self');
  if (/【|ルール[:：]|の番です|これまでの会話|いまの場面/.test(text)) hard.push('prompt-leak');
  if (/\bAI\b|ＡＩ|言語モデル|チャットボット|アシスタント/.test(text)) hard.push('self-ref');
  const sceneOrder = (id) => sc.timeline.findIndex((e) => e.id === id);
  const leaked = (c) => c.secretKeywords.some((k) => text.includes(k)) && (c.revealAt ? sceneIdx < sceneOrder(c.revealAt) : true);
  if (sc.characters.some(leaked)) hard.push('secret-leak');
  const hit = (e) => e.keywords.some((k) => text.includes(k));
  if (sc.timeline.some((e, i) => i > sceneIdx && hit(e))) hard.push('future-leak');
  if (sc.timeline.some((e, i) => i <= sceneIdx && e.knownBy.length && !e.knownBy.includes(speaker.key) && hit(e))) hard.push('unknown-knowledge');
  const myGroup = groupOf(speaker.firstPerson);
  if (myGroup >= 0 && PRON_RE.some((re, gi) => gi !== myGroup && re.test(text))) hard.push('wrong-first-person');
  const known = new Set(sc.characters.flatMap(namesOf));
  const m = [...text.matchAll(/([ァ-ヶ一-鿿]{2,4})(さん|くん|ちゃん|先輩|様|君)/g)].map((x) => x[1]);
  if (m.some((t) => ![...known].some((k) => k.includes(t) || t.includes(k)))) hard.push('unknown-name');
  const chars = [...text.replace(/\s/g, '')];
  if (chars.length && chars.filter((c) => JAC.test(c)).length / chars.length < 0.6) hard.push('non-japanese');
  const b = bg(text); if (history.slice(-6).some((h) => overlap(b, bg(h.text)) >= 0.7)) hard.push('repeat');
  if (speaker.endings.length && !speaker.endings.some((e) => text.includes(e))) soft.push('ending-miss');
  return { hard: [...new Set(hard)], soft };
}

/** Guard: forces the output into shape (first line, no labels, <= 2 sentences / 80 chars). */
export function enforce(raw, speaker, sc) {
  let t = cleanReply(raw, speaker).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || '';
  for (const c of sc.characters) if (c.key !== speaker.key) for (const n of namesOf(c)) { const i = Math.max(t.indexOf(`${n}：`), t.indexOf(`${n}:`)); if (i > 0) t = t.slice(0, i).trim(); }
  const sents = t.match(/[^。！？!?]+[。！？!?]*/g) || [t];
  t = sents.slice(0, 2).join('');
  if ([...t].length > 80) t = finishCutoff([...t].slice(0, 80).join(''), { markIfNoBreak: false });
  return t.trim();
}
const RETRY_ON = ['empty', 'secret-leak', 'future-leak', 'unknown-knowledge', 'wrong-first-person', 'self-ref', 'repeat', 'non-japanese', 'prompt-leak'];

export class ScenarioSession {
  /** opts: strategy, turnsPerScene, sceneFrom, sceneTo, temperature, guard, generate(messages,{maxNewTokens,temperature})->{text,truncated,aborted,newTokens,promptTokens}|null */
  constructor({ scenario, strategy = 'focused', turnsPerScene = 8, sceneFrom = 0, sceneTo = null, temperature = 0.3, guard = false, generate, maxNewTokens = 70 }) {
    this.sc = scenario; this.strategy = strategy; this.turnsPerScene = turnsPerScene; this.temperature = temperature; this.guard = guard; this.generate = generate; this.maxNewTokens = maxNewTokens;
    this.sceneIdx = Math.max(0, sceneFrom); this.sceneTo = Math.min(sceneTo ?? scenario.timeline.length - 1, scenario.timeline.length - 1);
    this.turnInScene = 0; this.entered = false; this.lastSpeaker = null; this.rot = 0; this.lines = []; this.attempts = []; this.ended = false; this.turn = 0;
  }
  scene() { return this.sc.timeline[this.sceneIdx]; }
  cast() { const s = this.scene(); return this.sc.characters.filter((c) => !s.participants.length || s.participants.includes(c.key)); }
  nextSpeaker() {
    const cast = this.cast(), last = this.lines.filter((l) => l.kind === 'npc').at(-1);
    if (last) { // the person just addressed answers next
      const addressed = cast.find((c) => c.key !== last.speakerId && c.key !== this.lastSpeaker && namesOf(c).some((n) => last.text.includes(n)));
      if (addressed) return addressed;
    }
    for (let i = 0; i < cast.length; i++) { const c = cast[(this.rot + i) % cast.length]; if (c.key !== this.lastSpeaker || cast.length === 1) { this.rot = (this.rot + i + 1) % cast.length; return c; } }
    return cast[0];
  }
  async step() {
    if (this.ended) return { type: 'end' };
    if (!this.entered) {
      this.entered = true; const s = this.scene();
      const line = { kind: 'scene', name: '', text: `${s.when}${s.scene ? `｜${s.scene}` : ''}`, sceneIdx: this.sceneIdx };
      this.lines.push(line); return { type: 'scene', line };
    }
    const speaker = this.nextSpeaker();
    const history = this.lines.filter((l) => l.kind === 'npc' && l.sceneIdx === this.sceneIdx);
    const ctx = { sc: this.sc, speaker, sceneIdx: this.sceneIdx, history };
    let note = '', final = '', first = null;
    const tries = this.guard ? 2 : 1;
    for (let attempt = 0; attempt < tries; attempt++) {
      const t0 = Date.now();
      const r = await this.generate(buildTurnMessages(this.sc, speaker, { sceneIdx: this.sceneIdx, history, strategy: this.strategy, note }), { maxNewTokens: this.maxNewTokens, temperature: this.temperature });
      const ms = Date.now() - t0;
      if (!r) return { type: 'busy' };
      if (this.ended) return { type: 'stopped' };
      if (r.aborted) return { type: 'aborted' };
      const raw = String(r.text ?? '');
      const rawCheck = checkLine(raw, ctx);
      const out = this.guard ? enforce(raw, speaker, this.sc) : cleanReply(raw, speaker);
      const finalCheck = checkLine(out, ctx);
      this.attempts.push({ turn: this.turn, scene: this.sceneIdx, speaker: speaker.name, attempt, ms, newTokens: r.newTokens ?? null, promptTokens: r.promptTokens ?? null,
        hitLimit: (r.newTokens ?? 0) >= this.maxNewTokens, raw: raw.slice(0, 200), rawHard: rawCheck.hard, rawSoft: rawCheck.soft, finalHard: finalCheck.hard, finalSoft: finalCheck.soft });
      if (!first) first = { rawCheck, finalCheck };
      final = out;
      const bad = finalCheck.hard.filter((v) => RETRY_ON.includes(v));
      if (!this.guard || !bad.length) break;
      note = `\n（注意：${bad.map((v) => VIOL[v]).join('・')}を避けて、${speaker.name}として短く言い直してください。）`;
    }
    const line = { kind: 'npc', speakerId: speaker.key, name: speaker.name, text: final || '……', sceneIdx: this.sceneIdx, rawHard: first.rawCheck.hard, finalHard: this.attempts.at(-1).finalHard, soft: this.attempts.at(-1).finalSoft };
    this.lines.push(line); this.lastSpeaker = speaker.key; this.turn++; this.turnInScene++;
    if (this.turnInScene >= this.turnsPerScene) {
      if (this.sceneIdx >= this.sceneTo) { this.ended = true; return { type: 'end', line }; }
      this.sceneIdx++; this.turnInScene = 0; this.entered = false; this.lastSpeaker = null;
    }
    return { type: 'line', line };
  }
  stop() { this.ended = true; }
  exportText() {
    return `『${this.sc.title}』（${STRATEGIES[this.strategy]}／温度${this.temperature}／ガード${this.guard ? 'あり' : 'なし'}）\n\n` + this.lines.map((l) => (l.kind === 'scene' ? `\n── ${l.text} ──` : `${l.name}：${l.text}${l.rawHard?.length ? `  ⚠${l.rawHard.map((v) => VIOL[v]).join('/')}` : ''}`)).join('\n') + '\n';
  }
}

/** Metrics for one finished scenario run (raw = model's own output, final = after the optional guard). */
export function analyzeScenario(session) {
  const npc = session.lines.filter((l) => l.kind === 'npc'), n = npc.length || 1;
  const first = session.attempts.filter((a) => a.attempt === 0);
  const lastOf = new Map(); for (const a of session.attempts) lastOf.set(a.turn, a);
  const fin = [...lastOf.values()];
  const rate = (arr, key) => { const out = {}; for (const a of arr) for (const v of a[key]) out[v] = (out[v] || 0) + 1; for (const k of Object.keys(out)) out[k] /= Math.max(1, arr.length); return out; };
  const avg = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const endingChars = npc.filter((l) => session.sc.characters.find((c) => c.key === l.speakerId)?.endings.length);
  return {
    type: 'scenario', strategy: session.strategy, guard: session.guard, temperature: session.temperature, title: session.sc.title,
    lines: npc.length, scenes: new Set(npc.map((l) => l.sceneIdx)).size,
    cleanRaw: first.length ? first.filter((a) => !a.rawHard.length).length / first.length : null,
    cleanFinal: fin.length ? fin.filter((a) => !a.finalHard.length).length / fin.length : null,
    rawViolations: rate(first, 'rawHard'), finalViolations: rate(fin, 'finalHard'),
    endingMatch: endingChars.length ? endingChars.filter((l) => !l.soft.includes('ending-miss')).length / endingChars.length : null,
    hitLimitRate: first.length ? first.filter((a) => a.hitLimit).length / first.length : null, avgLen: avg(npc.map((l) => [...l.text].length)),
    retried: session.attempts.filter((a) => a.attempt > 0).length,
    avgMs: avg(session.attempts.map((a) => a.ms)), avgTokens: avg(session.attempts.map((a) => a.newTokens)), avgPromptTokens: avg(session.attempts.map((a) => a.promptTokens)), _n: n
  };
}
