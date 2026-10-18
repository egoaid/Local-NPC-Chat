// Character data model (player-created residents). Pure functions only.
export const MAX_CHARACTERS = 12;
export const CLIMITS = Object.freeze({
  name: 20, occupation: 30, firstPerson: 10, personality: 150, speechStyle: 150, interests: 100,
  sampleLines: 180, notes: 300, greeting: 100, summary: 60
});
export const SOFT_TOTAL_CHARS = 700; // advisory: longer settings slow down the first token
export const GENDERS = Object.freeze(['male', 'female', 'other']);
export const GENDER_LABEL = Object.freeze({ male: '男性', female: '女性', other: 'その他' });
const PERIODS = ['morning', 'day', 'evening', 'night', 'late'];
const GENERIC_GREETING = Object.freeze({
  morning: 'おはようございます。', day: 'こんにちは。', evening: 'こんにちは。夕方になりましたね。',
  night: 'こんばんは。', late: 'こんばんは。遅い時間ですね。'
});

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const oneLine = (s, max) => clean(String(s ?? '').replace(/[\r\n]+/g, ' '), max);

export function newCharacterId() { return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }

export function blankCharacter() {
  return {
    id: '', name: '', age: '', gender: 'female', occupation: '', firstPerson: '', personality: '', speechStyle: '',
    interests: '', sampleLines: '', notes: '', greeting: '', voice: { gender: 'female', pitch: 1.0 },
    sampleKey: null, createdAt: 0, updatedAt: 0
  };
}

/** Returns a clean character (unknown keys dropped, strings limited, enums validated). Never throws. */
export function sanitizeCharacter(c = {}) {
  const b = blankCharacter();
  const age = String(c.age ?? '').replace(/[^0-9]/g, '').slice(0, 3);
  const gender = GENDERS.includes(c.gender) ? c.gender : b.gender;
  const vg = c.voice?.gender === 'male' || c.voice?.gender === 'female' ? c.voice.gender : (gender === 'male' ? 'male' : 'female');
  const pitch = Number.isFinite(Number(c.voice?.pitch)) ? Math.min(1.3, Math.max(0.7, Number(c.voice.pitch))) : 1.0;
  const out = {
    id: String(c.id ?? '').slice(0, 40),
    name: oneLine(c.name, CLIMITS.name),
    age, gender,
    occupation: oneLine(c.occupation, CLIMITS.occupation),
    firstPerson: oneLine(c.firstPerson, CLIMITS.firstPerson),
    personality: clean(c.personality, CLIMITS.personality),
    speechStyle: clean(c.speechStyle, CLIMITS.speechStyle),
    interests: clean(c.interests, CLIMITS.interests),
    sampleLines: sanitizeLines(c.sampleLines),
    notes: clean(c.notes, CLIMITS.notes),
    greeting: oneLine(c.greeting, CLIMITS.greeting),
    voice: { gender: vg, pitch: Math.round(pitch * 100) / 100 },
    sampleKey: c.sampleKey ? String(c.sampleKey).slice(0, 40) : null,
    createdAt: Number.isFinite(c.createdAt) ? c.createdAt : 0,
    updatedAt: Number.isFinite(c.updatedAt) ? c.updatedAt : 0
  };
  const sum = oneLine(c.summary, CLIMITS.summary); if (sum) out.summary = sum;
  if (c.greetings && typeof c.greetings === 'object') {
    const g = {};
    for (const k of PERIODS) { const t = oneLine(c.greetings[k], CLIMITS.greeting); if (t) g[k] = t; }
    if (Object.keys(g).length) out.greetings = g;
  }
  return out;
}

/** Up to 3 lines, total length limited. */
function sanitizeLines(s) {
  const lines = String(s ?? '').split(/\r?\n/).map((l) => oneLine(l, 80)).filter(Boolean).slice(0, 3);
  let out = lines.join('\n');
  if (out.length > CLIMITS.sampleLines) out = out.slice(0, CLIMITS.sampleLines);
  return out;
}

/** Human-readable problems (empty array = OK). */
export function validateCharacter(c) {
  const errs = [];
  if (!c.name.trim()) errs.push('名前を入力してください。');
  return errs;
}

/** Approximate size of the text that goes into the prompt (for the advisory counter). */
export function promptChars(c) {
  return [c.occupation, c.firstPerson, c.personality, c.speechStyle, c.interests, c.sampleLines, c.notes].reduce((n, s) => n + String(s || '').length, 0);
}

export const greetingFor = (c, periodKey) => c.greetings?.[periodKey] || c.greeting || GENERIC_GREETING[periodKey] || GENERIC_GREETING.day;

export function cardLine(c) {
  const bits = [c.age ? `${c.age}歳` : '', c.occupation].filter(Boolean).join('・');
  return bits || GENDER_LABEL[c.gender] || '';
}
export function cardSummary(c) { return c.summary || c.personality.slice(0, 40) || ''; }
