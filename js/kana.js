// Kana helpers and shiritori rules. Pure functions: the game rules are checked by code, never by the language model.

const SMALL = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ' };
const ROWS = {
  あ: 'あかさたなはまやらわがざだばぱぁゃゎ', い: 'いきしちにひみりぎじぢびぴぃ', う: 'うくすつぬふむゆるぐずづぶぷぅゅゔ',
  え: 'えけせてねへめれげぜでべぺぇ', お: 'おこそとのほもよろをごぞどぼぽぉょ'
};
const VOWEL = {}; for (const [v, cs] of Object.entries(ROWS)) for (const c of cs) VOWEL[c] = v;

export const toHiragana = (s) => String(s ?? '').normalize('NFKC').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const isKanaOnly = (s) => /^[ぁ-ゖゔー]+$/.test(toHiragana(s));
/** Removes (han)dakuten so that ご/こ/ぱ/は compare equal (lenient shiritori). */
export const baseKana = (c) => String(c).normalize('NFD').replace(/[\u3099\u309A]/g, '').normalize('NFC');

/** The sound the next word must start with, or null if the word cannot be continued (ends with っ, bare ー, ...). */
export function lastSound(reading) {
  let r = toHiragana(reading).replace(/[\s・]/g, '');
  while (r.endsWith('ー')) {
    r = r.slice(0, -1);
    if (!r) return null;
    const v = VOWEL[r.at(-1)];
    if (!v) return null;
    r += v; // long vowel mark -> repeat the vowel of the previous kana
  }
  let c = r.at(-1);
  if (!c) return null;
  if (SMALL[c]) c = SMALL[c];
  if (c === 'っ') return null;
  return c;
}
export function firstSound(reading) {
  const c = toHiragana(reading).replace(/[\s・]/g, '').at(0);
  return !c || c === 'ー' || SMALL[c] || c === 'っ' ? null : c;
}

export const REASON_JA = Object.freeze({
  'not-kana': 'よみがひらがなではありません', 'too-short': '1文字の言葉はなしです', 'wrong-start': '指定された音で始まっていません',
  used: 'すでに使われた言葉です', 'bad-ending': '次につなげられない終わり方です', empty: '言葉が空です'
});

/** reading: string, required: sound the word must start with (null for the very first word), used: Set of readings.
 *  Returns {ok:true, reading, last, loses} (loses = ends with ん) or {ok:false, reason}. */
export function validateWord(reading, { required = null, used = new Set(), lenient = true } = {}) {
  const r = toHiragana(reading).replace(/[\s・]/g, '');
  if (!r) return { ok: false, reason: 'empty' };
  if (!isKanaOnly(r)) return { ok: false, reason: 'not-kana' };
  if ([...r].length < 2) return { ok: false, reason: 'too-short' };
  const first = firstSound(r);
  if (!first) return { ok: false, reason: 'wrong-start' };
  if (required && (lenient ? baseKana(first) !== baseKana(required) : first !== required)) return { ok: false, reason: 'wrong-start' };
  if (used.has(r)) return { ok: false, reason: 'used' };
  const last = lastSound(r);
  if (!last) return { ok: false, reason: 'bad-ending' };
  return { ok: true, reading: r, last, loses: last === 'ん' };
}

/** Hiragana-only answer format: the first line is the word. Format drift ("ことば|よみ", extra lines, long text) is parsed but flagged `noisy`.
 *  reading = null when the word is not kana (kanji etc.), which is then a rule violation ('not-kana'). */
export function parseKanaAnswer(text) {
  const raw = String(text ?? '').replace(/<\|[^|>]*\|>/g, '').trim();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let w = (lines[0] || '').replace(/^[「『"'“\s]+|[」』"'”。、．.\s]+$/g, '');
  let noisy = lines.length > 1;
  const m = w.match(/^(.+?)\s*(?:[|｜:：]|[（(])/);
  if (m) { w = m[1]; noisy = true; }
  w = w.replace(/[「」『』\s]/g, '');
  if ([...w].length > 12) noisy = true;
  return { raw, word: w, reading: w && isKanaOnly(w) ? toHiragana(w) : null, noisy };
}

/** Parses the model's answer ("ことば|よみ", "ことば（よみ）", or a bare kana word) -> {word, reading|null}. */
export function parseWordAnswer(text) {
  const line = String(text ?? '').replace(/<\|[^|>]*\|>/g, '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const t = line.replace(/^[「『"'“\s]+|[」』"'”。、．.\s]+$/g, '');
  let m = t.match(/^(.+?)\s*[|｜:：]\s*(.+)$/) || t.match(/^(.+?)\s*[（(]\s*(.+?)\s*[）)]$/);
  if (m) return { word: m[1].replace(/[「」『』]/g, '').trim(), reading: m[2].replace(/[「」『』]/g, '').trim() };
  const w = t.replace(/[「」『』]/g, '').trim();
  return { word: w, reading: isKanaOnly(w) ? w : null };
}

/** Starter words for the first turn (word, reading). Chosen so that the next sound is easy. */
export const STARTERS = Object.freeze([
  ['さくら', 'さくら'], ['たいよう', 'たいよう'], ['ひこうき', 'ひこうき'], ['ぼうし', 'ぼうし'], ['くるま', 'くるま'], ['えんぴつ', 'えんぴつ'],
  ['すいか', 'すいか'], ['かぼちゃ', 'かぼちゃ'], ['とけい', 'とけい'], ['はなび', 'はなび'], ['ゆうやけ', 'ゆうやけ'], ['まくら', 'まくら'],
  ['ひまわり', 'ひまわり'], ['ふくろ', 'ふくろ'], ['てぶくろ', 'てぶくろ'], ['おにぎり', 'おにぎり'], ['ねこ', 'ねこ'], ['いるか', 'いるか'],
  ['あさがお', 'あさがお'], ['こたつ', 'こたつ'], ['しおかぜ', 'しおかぜ'], ['もみじ', 'もみじ'], ['かさ', 'かさ'], ['ほたる', 'ほたる']
]);
