// Backup / restore and single-character files (JSON). Validation is strict; nothing here touches the DOM.
import { MAX_CHARACTERS, sanitizeCharacter, newCharacterId } from './characters.js';
import { sanitizeCustom, parseImport as parseLegacySettings, LENGTH_KEYS } from './customize.js';
import { PERIOD_KEYS, parseFixedDate } from './world.js';
import { INTERVAL_KEYS } from './proactive.js';

export const BACKUP_SCHEMA = 'local-npc-chat-rpg/backup';
export const CHARACTER_SCHEMA = 'local-npc-chat-rpg/character';
export const FILE_LIMIT = 3 * 1024 * 1024;
const ID_OK = /^[A-Za-z0-9_-]{1,40}$/;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, n);

export function buildBackup({ characters, custom, settings, conversations, memory, relations }, { withChats = false, appVersion = '', now = new Date() } = {}) {
  const out = {
    schema: BACKUP_SCHEMA, schemaVersion: 1, appVersion, exportedAt: now.toISOString(), withChats,
    characters, world: custom.world || '', player: custom.player || {},
    settings: {
      timeMode: settings.timeMode, replyLength: settings.replyLength, memoryOn: settings.memoryOn,
      dateMode: settings.dateMode, fixedDate: settings.fixedDate, proactiveOn: settings.proactiveOn, proactiveInterval: settings.proactiveInterval
    }
  };
  if (withChats) { out.conversations = conversations || {}; out.memory = memory || {}; out.relations = relations || {}; }
  return out;
}

export function buildCharacterFile(character, { appVersion = '', now = new Date() } = {}) {
  const { id, createdAt, updatedAt, sampleKey, ...rest } = character; // identity is re-created on import
  return { schema: CHARACTER_SCHEMA, schemaVersion: 1, appVersion, exportedAt: now.toISOString(), character: rest };
}

function parseJson(text) {
  if (typeof text !== 'string' || text.length > FILE_LIMIT) return { error: 'ファイルが大きすぎるか、読み込めません。' };
  try { const j = JSON.parse(text); return j && typeof j === 'object' && !Array.isArray(j) ? { j } : { error: 'このアプリのファイルではありません。' }; }
  catch { return { error: 'JSONとして読み込めませんでした。' }; }
}

/** Single-character file -> {ok, character (id empty: caller assigns), warnings} */
export function parseCharacterFile(text) {
  const { j, error } = parseJson(text);
  if (error) return { ok: false, error };
  if (j.schema !== CHARACTER_SCHEMA) return { ok: false, error: 'このアプリの住人ファイルではありません。' };
  if (!Number.isInteger(j.schemaVersion) || j.schemaVersion > 1) return { ok: false, error: '新しい形式のファイルです。アプリを更新してから読み込んでください。' };
  const c = sanitizeCharacter({ ...(j.character || {}), id: '', sampleKey: null });
  if (!c.name) return { ok: false, error: '名前のない住人は読み込めません。' };
  return { ok: true, character: c, warnings: [] };
}

function sanitizeChat(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(-60).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => { const o = { role: m.role, content: clip(m.content, 2000) }; if (Number.isFinite(m.id)) o.id = m.id; if (m.greeting) o.greeting = true; return o; });
}

/** Full backup (or a legacy settings file) -> {ok, data, warnings}. data.characters is undefined for legacy files. */
export function parseBackup(text) {
  const { j, error } = parseJson(text);
  if (error) return { ok: false, error };
  const warnings = [];
  if (j.schema === 'local-npc-chat-rpg/settings') { // builds <= 0.6
    const r = parseLegacySettings(text, null);
    if (!r.ok) return r;
    warnings.push(...r.warnings, '古い形式の設定ファイルです。世界観・プレイヤー設定・時間・返答の長さだけを読み込みます（住人は変更されません）。');
    return { ok: true, warnings, data: { custom: { world: r.data.custom.world, player: r.data.player }, settings: { timeMode: r.data.timeMode, replyLength: r.data.replyLength } } };
  }
  if (j.schema !== BACKUP_SCHEMA) return { ok: false, error: 'このアプリのバックアップファイルではありません。' };
  if (!Number.isInteger(j.schemaVersion) || j.schemaVersion > 1) return { ok: false, error: '新しい形式のファイルです。アプリを更新してから読み込んでください。' };

  const idMap = new Map(), used = new Set(), characters = [];
  const list = Array.isArray(j.characters) ? j.characters : [];
  if (list.length > MAX_CHARACTERS) warnings.push(`住人が${MAX_CHARACTERS}人を超えていたため、先頭の${MAX_CHARACTERS}人だけを読み込みます。`);
  for (const raw of list.slice(0, MAX_CHARACTERS)) {
    const c = sanitizeCharacter(raw);
    if (!c.name) { warnings.push('名前のない住人を1人スキップしました。'); continue; }
    const old = String(raw?.id ?? '');
    c.id = ID_OK.test(old) && !used.has(old) ? old : newCharacterId();
    used.add(c.id); if (old && !idMap.has(old)) idMap.set(old, c.id); // first character with an id owns that id's chats
    characters.push(c);
  }
  const custom = sanitizeCustom({ world: j.world, player: j.player });
  const settings = {};
  if (j.settings?.timeMode === 'auto' || PERIOD_KEYS.includes(j.settings?.timeMode)) settings.timeMode = j.settings.timeMode;
  if (LENGTH_KEYS.includes(j.settings?.replyLength)) settings.replyLength = j.settings.replyLength;
  if (typeof j.settings?.memoryOn === 'boolean') settings.memoryOn = j.settings.memoryOn;
  if (j.settings?.dateMode === 'auto' || (j.settings?.dateMode === 'fixed' && parseFixedDate(j.settings?.fixedDate))) {
    settings.dateMode = j.settings.dateMode; settings.fixedDate = j.settings.dateMode === 'fixed' ? j.settings.fixedDate : '';
  }
  if (typeof j.settings?.proactiveOn === 'boolean') settings.proactiveOn = j.settings.proactiveOn;
  if (INTERVAL_KEYS.includes(j.settings?.proactiveInterval)) settings.proactiveInterval = j.settings.proactiveInterval;
  const data = { characters, custom, settings };
  if (j.withChats && j.conversations && typeof j.conversations === 'object') {
    data.conversations = {}; data.memory = {}; data.relations = {};
    for (const [old, msgs] of Object.entries(j.conversations)) { const id = idMap.get(old); if (id) data.conversations[id] = sanitizeChat(msgs); }
    for (const [old, m] of Object.entries(j.memory || {})) { const id = idMap.get(old); if (id && m && typeof m.summary === 'string') data.memory[id] = { summary: clip(m.summary, 300), through: Number.isFinite(m.through) ? m.through : 0 }; }
    for (const [old, r] of Object.entries(j.relations || {})) { const id = idMap.get(old); if (id && r?.knows) data.relations[id] = { knows: true }; }
  }
  return { ok: true, warnings, data };
}
