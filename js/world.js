// World time: derived from the device clock ("auto") or fixed manually by the player.
export const PERIODS = Object.freeze({
  morning: { label: '朝', range: '5〜11時', guide: '一日の始まりの時間。朝の挨拶、朝食、さわやかな空気、これからの予定の話が自然。' },
  day: { label: '昼', range: '11〜16時', guide: '活動的な昼の時間。昼の挨拶、昼食、午後の予定の話が自然。' },
  evening: { label: '夕方', range: '16〜19時', guide: '日が傾く夕方。一日の終わりが近づき、帰り道や夕食、夕焼けの話が自然。' },
  night: { label: '夜', range: '19〜24時', guide: '落ち着いた夜。夜の挨拶、静かな雰囲気、一日の振り返りの話が自然。' },
  late: { label: '深夜', range: '0〜5時', guide: 'かなり遅い深夜。静かで少し眠そうな雰囲気。なぜ起きているのかなど自然に触れてよい。' }
});
export const PERIOD_KEYS = Object.freeze(Object.keys(PERIODS));

export function periodOfHour(h) {
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 16) return 'day';
  if (h >= 16 && h < 19) return 'evening';
  if (h >= 19) return 'night';
  return 'late';
}

/** timeMode: 'auto' | one of PERIOD_KEYS. Returns {key, label, guide, auto, hour} */
export function resolveTime(timeMode, now = new Date()) {
  const auto = !PERIOD_KEYS.includes(timeMode);
  const key = auto ? periodOfHour(now.getHours()) : timeMode;
  const p = PERIODS[key];
  return { key, label: p.label, guide: p.guide, auto, hour: auto ? now.getHours() : null, minute: auto ? now.getMinutes() : null };
}

// ---- calendar: date from the device clock ("auto") or a fixed date chosen by the player ----
export const SEASONS = Object.freeze({
  spring: { label: '春', guide: '暖かくなり、桜や新しい季節の始まりを感じる頃。春風、花粉、新生活の話題が自然。' },
  summer: { label: '夏', guide: '暑い季節。蝉の声、冷たい飲み物、夏祭りや海、夏バテの話題が自然。' },
  autumn: { label: '秋', guide: '涼しくなる季節。紅葉、読書、食べ物のおいしさ、日が短くなる話題が自然。' },
  winter: { label: '冬', guide: '寒い季節。冷え込み、温かい飲み物、雪、年末年始の話題が自然。' }
});
export const seasonOfMonth = (m) => (m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'); // Japan-style
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
const SPECIAL = Object.freeze({ '1-1': '元日', '2-14': 'バレンタインデー', '3-3': 'ひな祭り', '5-5': 'こどもの日', '7-7': '七夕', '12-24': 'クリスマスイブ', '12-25': 'クリスマス', '12-31': '大晦日' });
const FIXED_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valid "YYYY-MM-DD" -> Date (local noon) or null. */
export function parseFixedDate(s) {
  const m = FIXED_RE.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}

/** dateMode: 'auto' | 'fixed'. Returns {y,m,d,weekday,season,seasonLabel,guide,special,text,auto}. */
export function resolveDate(dateMode, fixedDate, now = new Date()) {
  const fixed = dateMode === 'fixed' ? parseFixedDate(fixedDate) : null;
  const t = fixed || now;
  const y = t.getFullYear(), m = t.getMonth() + 1, d = t.getDate(), wd = t.getDay();
  const season = seasonOfMonth(m);
  return {
    y, m, d, weekday: WEEKDAY[wd], season, seasonLabel: SEASONS[season].label, guide: SEASONS[season].guide,
    special: SPECIAL[`${m}-${d}`] || '', text: `${y}年${m}月${d}日（${WEEKDAY[wd]}曜日）`, auto: !fixed
  };
}

/** Which calendar facts is the player asking about? (so the prompt can demand an exact answer) */
export function detectCalendarQuestion(text) {
  const t = String(text || '').normalize('NFKC').replace(/\s+/g, '');
  const date = /(今日|きょう|本日).{0,6}(何日|なんにち|いつ|日付|ひづけ|何月|なんがつ)|何月何日|なんがつなんにち|日付(は|を)|(今|いま)(は)?何月|今日(は)?何年|何年(です|だっけ)/.test(t);
  const weekday = /(何曜日|なんようび|曜日(は|を|って))/.test(t);
  const time = /(今|いま).{0,3}(何時|なんじ|時間)|何時(です|だっけ|ですか|？|\?|$)|時刻/.test(t);
  const season = /(今|いま).{0,4}(何の季節|どの季節|季節)|(今|いま)の季節/.test(t);
  return { date, weekday, time, season, any: date || weekday || time || season };
}
