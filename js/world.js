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
