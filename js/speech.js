import { CONFIG } from './config.js';

const FEMALE = /\b(female|aria|jenny|michelle|ana|sonia|libby|maisie|nanami|aoi|mayu|shiori|haruka|ayumi|zira|hazel|susan|kyoko|samantha|karen|moira|tessa|victoria|fiona|emma|ava|sara)\b/i;
const MALE = /\b(male|guy|davis|tony|jason|ryan|eric|roger|steffan|christopher|brian|andrew|keita|daichi|naoki|ichiro|otoya|david|mark|daniel|alex|george|james|thomas|oliver)\b/i;

export const isOnlineNatural = (v) => /microsoft/i.test(v.name) && /online/i.test(v.name) && /natural/i.test(v.name);
export function guessGender(v) {
  const n = v.name || '';
  if (/\bfemale\b/i.test(n)) return 'female';
  if (/\bmale\b/i.test(n)) return 'male';
  if (FEMALE.test(n)) return 'female';
  if (MALE.test(n)) return 'male';
  return null;
}
export const detectLang = (text) => (/[\u3040-\u30ff\u3400-\u9fff]/.test(text) ? 'ja' : 'en');

/** Pure selection logic (testable). Returns {voice, onlineNatural, genderMatch} or null. */
export function pickVoice(voices, lang, gender, preferredName) {
  const pool = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(lang));
  if (!pool.length) return null;
  if (preferredName && preferredName !== 'auto') {
    const p = pool.find((v) => v.name === preferredName);
    if (p) return { voice: p, onlineNatural: isOnlineNatural(p), genderMatch: guessGender(p) === gender };
  }
  const score = (v) => (isOnlineNatural(v) ? 100 : 0) + (guessGender(v) === gender ? 50 : 0) +
    (guessGender(v) && guessGender(v) !== gender ? -60 : 0) + (v.localService ? 5 : 0) +
    (lang === 'en' && /en[-_]US/i.test(v.lang) ? 3 : 0);
  const best = [...pool].sort((a, b) => score(b) - score(a))[0];
  return { voice: best, onlineNatural: isOnlineNatural(best), genderMatch: guessGender(best) === gender };
}

export class Speech {
  constructor() {
    this.supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
    this.voices = [];
    this.on = false;
    this.rate = CONFIG.speech.defaultRate;
    this.onVoices = null;
  }
  async init() {
    if (!this.supported) return;
    const refresh = () => { this.voices = speechSynthesis.getVoices(); this.onVoices?.(this.voices); };
    refresh();
    speechSynthesis.addEventListener?.('voiceschanged', refresh);
    if (!this.voices.length) await new Promise((r) => setTimeout(r, 800)), refresh(); // some browsers load lazily
  }
  choose(lang, npc, prefs) { return pickVoice(this.voices, lang, npc.voice.gender, prefs?.[lang]); }
  stop() { if (this.supported) speechSynthesis.cancel(); }
  speak(text, npc, prefs) {
    if (!this.supported || !text) return { ok: false, reason: 'unsupported', done: Promise.resolve() };
    const lang = detectLang(text);
    const pick = this.choose(lang, npc, prefs);
    this.stop();
    const sentences = text.match(/[^。！？!?.\n]+[。！？!?.]*/g) || [text];
    let resolveDone; const done = new Promise((r) => { resolveDone = r; });
    let lastU = null;
    for (const s of sentences) {
      if (!s.trim()) continue;
      const u = new SpeechSynthesisUtterance(s.trim()); lastU = u;
      u.lang = pick?.voice?.lang || (lang === 'ja' ? 'ja-JP' : 'en-US');
      if (pick) u.voice = pick.voice;
      u.rate = this.rate;
      u.pitch = npc.voice.pitch;
      speechSynthesis.speak(u);
    }
    if (lastU) { lastU.onend = lastU.onerror = () => resolveDone(); setTimeout(resolveDone, Math.max(3000, text.length * 450)); } else resolveDone();
    return { ok: !!pick, reason: pick ? null : 'no-voice', pick, done };
  }
}
