// Benchmark analysis (pure functions). No dictionary: shiritori rules are checked mechanically and every violation is recorded;
// story quality is measured with transparent heuristics plus the player's own ratings. See README for how to read the numbers.

export const BENCH_TITLES = Object.freeze([
  '森の館で起きたサスペンスストーリー', '宇宙船が遭難して、乗組員が力を合わせる話', '雨の日の喫茶店で起きた小さな奇跡'
]);
export const VIOLATIONS = Object.freeze({
  'wrong-start': '指定の音で始まらない', used: '使用済みの言葉', 'ends-n': '「ん」で終わる', 'not-kana': 'ひらがな以外（漢字など）',
  'too-short': '1文字の言葉', 'bad-ending': 'つなげられない終わり方', empty: '空の出力'
});
const avg = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** One finished shiritori game -> metrics. attempts: GroupSession.attempts; endedBy: 'n'|'fail'|'limit'|'stopped'. */
export function analyzeShiritori(attempts, { endedBy = 'stopped', validWords = [], retries = 1, lenient = true } = {}) {
  const byTurn = new Map();
  for (const a of attempts) { if (!byTurn.has(a.turn)) byTurn.set(a.turn, []); byTurn.get(a.turn).push(a); }
  const turns = [...byTurn.entries()].sort((x, y) => x[0] - y[0]).map(([, v]) => v);
  const firstTryOk = turns.map((t) => t[0].reason === null);
  let chain = 0; for (const ok of firstTryOk) { if (ok) chain++; else break; } // turns in a row that were right on the first try
  const violations = {};
  for (const a of attempts) if (a.reason) violations[a.reason] = (violations[a.reason] || 0) + 1;
  return {
    type: 'shiritori', endedBy, retries, lenient,
    turns: turns.length, validWords: validWords.length, attempts: attempts.length,
    firstTryOk: firstTryOk.filter(Boolean).length, firstTryRate: turns.length ? firstTryOk.filter(Boolean).length / turns.length : null,
    chain, violations, noisy: attempts.filter((a) => a.noisy).length,
    avgMs: avg(attempts.map((a) => a.ms)), avgTokens: avg(attempts.map((a) => a.newTokens)), avgPromptTokens: avg(attempts.map((a) => a.promptTokens))
  };
}

const JA = /[぀-ヿ一-鿿ー、。！？「」]/;
const content = (s) => { // kanji / katakana runs (the "content-bearing" part of a Japanese sentence)
  const out = new Set();
  for (const run of String(s).match(/[ァ-ヺー一-鿿]{2,}/g) || []) for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  return out;
};
const bigrams = (s) => { const t = String(s).replace(/\s/g, ''); const set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
const overlap = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.min(a.size, b.size); };

/** lines: story lines (npc only), attempts: GroupSession.attempts. */
export function analyzeStory(lines, attempts, { retries = 0, temperature = null, title = '', maxTurns = null } = {}) {
  const texts = lines.map((l) => l.text);
  const jaRatios = texts.map((t) => { const c = [...t.replace(/\s/g, '')]; return c.length ? c.filter((x) => JA.test(x)).length / c.length : 0; });
  const complete = texts.map((t) => /[。！？!?」』）)]$/.test(t) && !t.endsWith('……'));
  const repeat = [], cont = [];
  const seen = new Set();
  texts.forEach((t, i) => {
    const bg = bigrams(t);
    repeat.push(i ? Math.max(...texts.slice(0, i).map((p) => overlap(bg, bigrams(p)))) : 0);
    const cs = content(t);
    if (i && cs.size) { let n = 0; for (const x of cs) if (seen.has(x)) n++; cont.push(n / cs.size); }
    for (const x of cs) seen.add(x);
  });
  return {
    type: 'story', title, retries, temperature, requested: maxTurns,
    lines: texts.length, completed: maxTurns ? texts.length >= maxTurns : null,
    avgLen: avg(texts.map((t) => [...t].length)), longLines: texts.filter((t) => [...t].length > 100).length,
    jaRatio: avg(jaRatios), completeRate: texts.length ? complete.filter(Boolean).length / texts.length : null,
    repeatScore: avg(repeat.slice(1)), dupLines: repeat.filter((x) => x >= 0.7).length,
    continuity: avg(cont), // share of content words (kanji/katakana 2-grams) already used earlier: high = continuity, too high = repetition
    selfRef: texts.filter((t) => /(AI|ＡＩ|言語モデル|チャットボット|プログラム|アシスタント)/.test(t)).length,
    labelLeak: attempts.filter((a) => /^[^\s：:]{1,12}[：:]/.test(a.raw || '')).length,
    shortOrDup: attempts.filter((a) => a.reason).length,
    avgMs: avg(attempts.map((a) => a.ms)), avgTokens: avg(attempts.map((a) => a.newTokens)), avgPromptTokens: avg(attempts.map((a) => a.promptTokens))
  };
}

/** runs: [{model:{key,short}, test, metrics, ratings?, nonsense?, words?}] -> one row per (model, test). */
export function aggregate(runs) {
  const groups = new Map();
  for (const r of runs) { const k = `${r.model?.key}|${r.test}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const rows = [];
  for (const [k, rs] of groups) {
    const m = rs.map((r) => r.metrics), first = rs[0];
    const row = { key: k, model: first.model?.short || first.model?.key || '?', modelId: first.model?.id || '', test: first.test, runs: rs.length, avgMs: avg(m.map((x) => x.avgMs)), avgTokens: avg(m.map((x) => x.avgTokens)) };
    if (first.test === 'shiritori') {
      const turns = sum(m.map((x) => x.turns)), ok = sum(m.map((x) => x.firstTryOk));
      Object.assign(row, {
        avgChain: avg(m.map((x) => x.chain)), avgWords: avg(m.map((x) => x.validWords)), firstTryRate: turns ? ok / turns : null,
        noisyRate: turns ? sum(m.map((x) => x.noisy)) / Math.max(1, sum(m.map((x) => x.attempts))) : null, violations: {}
      });
      const att = Math.max(1, sum(m.map((x) => x.attempts)));
      for (const x of m) for (const [v, n] of Object.entries(x.violations)) row.violations[v] = (row.violations[v] || 0) + n;
      for (const v of Object.keys(row.violations)) row.violations[v] = row.violations[v] / att; // share of all attempts
      const rated = rs.filter((r) => Array.isArray(r.nonsense));
      const words = sum(rated.map((r) => r.words?.length || 0));
      row.nonsenseRate = words ? sum(rated.map((r) => r.nonsense.length)) / words : null; // player-marked
    } else {
      Object.assign(row, {
        jaRatio: avg(m.map((x) => x.jaRatio)), completeRate: avg(m.map((x) => x.completeRate)), repeatScore: avg(m.map((x) => x.repeatScore)),
        continuity: avg(m.map((x) => x.continuity)), selfRef: sum(m.map((x) => x.selfRef)), dupLines: sum(m.map((x) => x.dupLines)),
        completionRate: rs.filter((r) => r.metrics.completed === true).length / rs.length
      });
      for (const key of ['coherence', 'naturalness', 'interest']) row[key] = avg(rs.map((r) => r.ratings?.[key]));
    }
    rows.push(row);
  }
  return rows.sort((a, b) => a.test.localeCompare(b.test) || a.model.localeCompare(b.model));
}

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function toCSV(runs) {
  const head = ['日時', 'モデル', 'テスト', '設定', '主な結果', '平均ms', '平均出力トークン'];
  const rows = runs.map((r) => {
    const m = r.metrics, p = r.params || {};
    const set = `temp=${p.temperature ?? ''} retries=${p.retries ?? ''}${p.lenient === false ? ' strict' : ''}${p.title ? ` title=${p.title}` : ''}`;
    const res = r.test === 'shiritori'
      ? `連鎖${m.chain} 語${m.validWords} 初回成功${m.firstTryRate === null ? '-' : Math.round(m.firstTryRate * 100)}% 終了:${m.endedBy} 違反:${Object.entries(m.violations).map(([k, v]) => `${k}=${v}`).join('/')}`
      : `発言${m.lines} 日本語${m.jaRatio === null ? '-' : Math.round(m.jaRatio * 100)}% 文末完結${m.completeRate === null ? '-' : Math.round(m.completeRate * 100)}% 反復${m.repeatScore === null ? '-' : m.repeatScore.toFixed(2)} 継続${m.continuity === null ? '-' : m.continuity.toFixed(2)}`;
    return [r.ts, r.model?.short, r.test, set, res, m.avgMs === null ? '' : Math.round(m.avgMs), m.avgTokens === null ? '' : m.avgTokens.toFixed(1)].map(q).join(',');
  });
  return [head.map(q).join(','), ...rows].join('\n');
}

/** Small deterministic RNG (mulberry32): the same seed gives every model the same starter words / speaker order. */
export function seededRand(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const BENCH_SCHEMA = 'local-npc-chat-rpg/bench';
