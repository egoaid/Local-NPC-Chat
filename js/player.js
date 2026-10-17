// Player-identity helpers (pure). The NPC only "knows" the player after being introduced.

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Did the player introduce themselves with `name` in `text`? (1-character names need an introduction pattern.) */
export function mentionsName(text, name) {
  const n = norm(name), t = norm(text);
  if (!n || !t) return false;
  if ([...n].length >= 2) return t.includes(n);
  const e = esc(n);
  return new RegExp(`(?:私は|わたしは|僕は|ぼくは|俺は|おれは|あたしは|名前は|iam|i'm|mynameis)${e}|${e}(?:です|といいます|と言います|と申します|と呼んで|だよ|だ。|だ$)`).test(t);
}

/** Name may be used in the next reply only if none of the last two NPC replies used it ("sometimes", not every turn). */
export function nameCooldownOk(recentAssistantTexts, name, window = 2) {
  const n = norm(name);
  if (!n) return false;
  return !recentAssistantTexts.slice(-window).some((t) => norm(t).includes(n));
}
