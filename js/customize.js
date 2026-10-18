// Player customization (world setting + per-NPC extra settings) and JSON export/import.
import { PERIOD_KEYS } from './world.js';

export const LIMITS = Object.freeze({ world: 500, npc: 300, playerName: 20, playerProfile: 300, playerPersonality: 300, fileBytes: 100 * 1024 });
export const SCHEMA = 'local-npc-chat-rpg/settings';
export const SCHEMA_VERSION = 1;
export const LENGTH_KEYS = Object.freeze(['short', 'normal', 'long']);

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

export const emptyPlayer = () => ({ name: '', profile: '', personality: '' });
export const emptyCustom = () => ({ world: '', player: emptyPlayer() });

export function sanitizePlayer(p) {
  return {
    name: clean(String(p?.name ?? '').replace(/[\r\n]+/g, ' '), LIMITS.playerName),
    profile: clean(p?.profile, LIMITS.playerProfile),
    personality: clean(p?.personality, LIMITS.playerPersonality)
  };
}

export function sanitizeCustom(c) {
  return { world: clean(c?.world, LIMITS.world), player: sanitizePlayer(c?.player) };
}

/** Validates a LEGACY settings file (schema local-npc-chat-rpg/settings v1). npcIds=null ignores the old per-NPC notes. */
export function parseImport(text, npcIds) {
  if (typeof text !== 'string' || text.length > LIMITS.fileBytes) return { ok: false, error: 'ファイルが大きすぎるか、読み込めません。' };
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, error: 'JSONとして読み込めませんでした。' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || j.schema !== SCHEMA) return { ok: false, error: 'このアプリの設定ファイルではありません。' };
  if (!Number.isInteger(j.schemaVersion) || j.schemaVersion > SCHEMA_VERSION) return { ok: false, error: 'このファイルは新しい形式です。アプリを更新してから読み込んでください。' };
  const warnings = [];
  const world = clean(j.world, LIMITS.world + 1);
  if (world.length > LIMITS.world) warnings.push(`世界観が${LIMITS.world}文字を超えていたため切り詰めました。`);
  const npcsIn = j.npcs && typeof j.npcs === 'object' && !Array.isArray(j.npcs) ? j.npcs : {};
  const npcs = {};
  for (const [id, v] of (npcIds ? Object.entries(npcsIn) : [])) {
    if (!npcIds.includes(id)) { warnings.push(`未知の住人「${String(id).slice(0, 30)}」の設定は無視しました。`); continue; }
    const t = clean(v, LIMITS.npc + 1);
    if (t.length > LIMITS.npc) warnings.push(`「${id}」の設定が${LIMITS.npc}文字を超えていたため切り詰めました。`);
    if (t) npcs[id] = t.slice(0, LIMITS.npc);
  }
  const timeMode = j.timeMode === 'auto' || PERIOD_KEYS.includes(j.timeMode) ? j.timeMode : 'auto';
  if (j.timeMode !== timeMode) warnings.push('時間の設定が不正だったため「端末の時間」にしました。');
  const replyLength = LENGTH_KEYS.includes(j.replyLength) ? j.replyLength : 'normal';
  let player;
  if (j.player && typeof j.player === 'object' && !Array.isArray(j.player)) {
    player = sanitizePlayer(j.player);
    for (const [k, lim] of [['name', LIMITS.playerName], ['profile', LIMITS.playerProfile], ['personality', LIMITS.playerPersonality]]) {
      if (String(j.player[k] ?? '').trim().length > lim) warnings.push(`プレイヤーの「${k}」が${lim}文字を超えていたため切り詰めました。`);
    }
  } // absent -> undefined: the app keeps the current player settings
  return { ok: true, warnings, data: { custom: { world: world.slice(0, LIMITS.world), npcs }, player, timeMode, replyLength } };
}
