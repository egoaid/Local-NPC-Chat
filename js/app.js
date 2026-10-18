import { CONFIG, APP, MODELS, LENGTHS, LIGHT_CONTEXT, PROACTIVE, getModel, modelVersion, DEFAULT_MODEL_KEY } from './config.js';
import * as LLM from './llm.js';
import * as Store from './storage.js';
import { Chat } from './chat.js';
import { Speech } from './speech.js';
import { UpdateChecker } from './update-checker.js';
import * as ui from './ui.js';
import { resolveTime, resolveDate, parseFixedDate, PERIOD_KEYS } from './world.js';
import { nextDelay, pickSpeaker, blockReason, INTERVAL_KEYS } from './proactive.js';
import { GroupSession, GROUP } from './group.js';
import { LIMITS, LENGTH_KEYS, sanitizeCustom, sanitizePlayer } from './customize.js';
import { MAX_CHARACTERS, CLIMITS, SOFT_TOTAL_CHARS, blankCharacter, sanitizeCharacter, validateCharacter, newCharacterId, promptChars } from './characters.js';
import { SAMPLES, characterFromSample } from './samples.js';
import { migrateLegacy } from './migrate.js';
import { buildBackup, buildCharacterFile, parseBackup, parseCharacterFile, FILE_LIMIT } from './backup.js';
const { $ } = ui;

// ---- storage (IndexedDB; falls back to localStorage) ----
Store.onStorageError((e) => { console.warn('storage', e); ui.toast('データの保存でエラーが発生しました。保存領域がいっぱいか、ブラウザの設定で制限されている可能性があります。', 8000); });
await Store.initStorage();

const settings = Store.loadSettings();
let custom = sanitizeCustom(Store.loadCustom());
let characters = Store.loadCharacters().map((c) => sanitizeCharacter(c)).filter((c) => c.id && c.name);
{ // one-time migration from builds <= 0.6 (four fixed residents)
  const meta = Store.loadMeta();
  if (!meta.charactersMigrated) {
    if (!characters.length) {
      const r = migrateLegacy({ conversations: Store.loadConversations(), memory: Store.loadMemory(), relations: Store.loadRelations(), custom: Store.loadCustom() });
      characters = r.characters; custom = sanitizeCustom(r.custom);
    }
    Store.saveCharacters(characters); Store.saveCustom(custom); Store.saveMeta({ ...meta, charactersMigrated: true });
  }
}
const charById = (id) => characters.find((c) => c.id === id) || null;
if (!charById(settings.selectedNpc)) settings.selectedNpc = characters[0]?.id ?? null;
if (!MODELS.some((m) => m.key === settings.model)) settings.model = DEFAULT_MODEL_KEY;
if (settings.timeMode !== 'auto' && !PERIOD_KEYS.includes(settings.timeMode)) settings.timeMode = 'auto';
if (!LENGTH_KEYS.includes(settings.replyLength)) settings.replyLength = 'normal';
if (settings.dateMode !== 'fixed' || !parseFixedDate(settings.fixedDate)) { settings.dateMode = 'auto'; settings.fixedDate = ''; }
if (!INTERVAL_KEYS.includes(settings.proactiveInterval)) settings.proactiveInterval = 'normal';
const nowTime = () => resolveTime(settings.timeMode);
const budget = () => { const c = settings.lightMode ? LIGHT_CONTEXT : (loadedDef || selectedDef()).context; return { budgetChars: c.historyChars, maxMessages: c.maxMessages }; };
const getContext = () => ({ budget: budget(), memoryOn: settings.memoryOn, player: custom.player, world: custom.world, time: nowTime(), calendar: resolveDate(settings.dateMode, settings.fixedDate), length: LENGTHS[settings.replyLength] });
const speech = new Speech();
speech.on = settings.speechOn; speech.rate = settings.rate;
let modelReady = false, firstTokenAt = 0, slowHintShown = false, lastStats = null;
const runs = []; // diagnostics (newest last)
const unread = new Set(); // character ids with an unread spontaneous message
let proactiveTimer = null, proactiveStreak = 0, lastSpeakerId = null, startupDone = false;
LLM.setUseWorker(settings.useWorker);
const save = () => Store.saveSettings(settings);
const npcNow = () => charById(settings.selectedNpc);

const chat = new Chat({
  getContext, getCharacter: charById,
  onKnowsChange: (id) => { if (id === settings.selectedNpc) $('chk-knows').checked = chat.knows(id); },
  onSummarizing: (on) => { $('memory-status').textContent = on ? '記憶を整理中…' : ''; if (!on) syncMemoryUI(); refreshModelUI(); },
  onStream: (id, text) => { if (!firstTokenAt) firstTokenAt = Date.now(); if (id === settings.selectedNpc) ui.streamUpdate(text); },
  onStats: (s) => { lastStats = s; },
  onDone: (id) => { ui.setGenerating(false); ui.setChatEnabled(modelReady); refreshModelUI(); if (id === settings.selectedNpc) render(); },
  onError: (e) => { console.error(e); ui.toast('返事の生成に失敗しました。もう一度試してください。'); showDetails(e); }
});

function render() {
  const npc = npcNow();
  ui.showEmptyState(!npc);
  if (npc) ui.renderMessages(npc, chat.messages(npc.id), { generating: chat.generating, onReplay: (t) => say(t, true) });
}
function showDetails(e) { $('err-details').hidden = false; $('err-pre').textContent = `${e?.name || 'Error'}: ${e?.message || e}\n${e?.stack || ''}`.slice(0, 2000); }

function say(text, force = false) {
  const npc = npcNow(); if (!npc) return;
  if (!force && !speech.on) return;
  if (!speech.supported) return ui.toast('このブラウザは音声合成に対応していません。');
  const r = speech.speak(text, npc, settings.voices[npc.id]);
  if (r.reason === 'no-voice') ui.toast('適切な声が見つかりませんでした。端末の標準音声で再生を試みます。');
}

function updateVoiceInfo() {
  const npc = npcNow();
  if (!npc) { $('voice-info').textContent = ''; return; }
  if (!speech.supported) { $('voice-info').textContent = '音声合成は利用できません。'; return; }
  const prefs = settings.voices[npc.id];
  const part = (lang, label) => {
    const p = speech.choose(lang, npc, prefs);
    return p ? `${label}: ${p.voice.name}（${p.onlineNatural ? 'Microsoft Online Natural' : '標準音声'}）` : `${label}: 利用可能な声なし`;
  };
  $('voice-info').textContent = `${npc.name}の声 → ${part('ja', '日本語')} / ${part('en', '英語')}`;
}
function refreshVoices() {
  const npc = npcNow();
  ui.fillVoiceSelects(speech.voices, npc ? settings.voices[npc.id] : null, (lang, val) => {
    if (!npcNow()) return;
    const id = settings.selectedNpc;
    settings.voices[id] = { ...(settings.voices[id] || {}), [lang]: val }; save(); updateVoiceInfo();
  });
  updateVoiceInfo();
}

function refreshNpcList() {
  ui.renderNpcCards(characters, settings.selectedNpc, selectNpc, openEditor, unread);
  $('npc-count').textContent = `${characters.length} / ${MAX_CHARACTERS}人`;
  const full = characters.length >= MAX_CHARACTERS;
  $('btn-add-char').disabled = full; $('btn-add-sample').disabled = full; $('btn-import-char').disabled = full;
  renderGroupPeople(); updateGroupUI();
}

function selectNpc(id) {
  if (chat.generating) return;
  speech.stop(); settings.selectedNpc = charById(id) ? id : null; save();
  const npc = npcNow(); if (npc && unread.delete(npc.id)) refreshNpcList(); ui.markSelected(settings.selectedNpc); ui.setChatHeader(npc);
  if (npc) chat.ensureGreeting(npc.id, nowTime().key);
  render(); refreshVoices(); syncCustomUI();
}

async function send() {
  const input = $('input'); const text = input.value.trim();
  if (!text || !npcNow()) return;
  if (!modelReady) return ui.toast('先にAIモデルを読み込んでください（画面下の「ローカルAIモデル」）。');
  input.value = ''; speech.stop(); ui.setGenerating(true); firstTokenAt = 0; lastStats = null; const t0 = Date.now();
  proactiveStreak = 0; unread.delete(settings.selectedNpc); scheduleProactive(nextDelay(settings.proactiveInterval)); // the player is active: push the next spontaneous message back
  const id = settings.selectedNpc;
  const p = chat.send(id, text);
  render();
  const reply = await p;
  const total = Date.now() - t0, ttft = firstTokenAt ? firstTokenAt - t0 : null;
  if (reply) {
    const nt = lastStats?.newTokens ?? null;
    runs.push({ ttft, total, promptTokens: lastStats?.promptTokens ?? null, newTokens: nt, tps: nt && ttft !== null && total > ttft ? nt / ((total - ttft) / 1000) : null });
    if (runs.length > 10) runs.shift();
    updateDiag();
  }
  if (ttft && ttft > 8000 && !settings.lightMode && !slowHintShown) { slowHintShown = true; ui.toast('返事が始まるまで時間がかかっています。重いときは、画面下のモデル設定で「軽量モード」をお試しください。', 8000); }
  ui.setGenerating(false); ui.setChatEnabled(modelReady); input.focus();
  if (reply && id === settings.selectedNpc) say(reply);
  if (reply && settings.memoryOn) chat.maybeSummarize(id); // background; yields to the next message
}

const fmtMB = (b) => `${(b / 1048576).toFixed(0)}MB`;
let loadedDef = null, busy = false, idleTimer = null, releasedDef = null, gpuInfo = { ok: false, f16: false };
const selectedDef = () => getModel(settings.model);

function classify(e, def) {
  const m = String(e?.message || e);
  if (/shader-f16|f16/i.test(m)) return 'この端末のWebGPUは16bit浮動小数点(shader-f16)に対応していない可能性があります。350Mモデルをお試しください。';
  if (/out of memory|insufficient|memory|allocation|OOM|buffer/i.test(m)) return `メモリ（GPUメモリ）が足りない可能性があります。他のタブやアプリを閉じるか、より小さいモデル（350M）をお使いください。`;
  if (/Failed to fetch|NetworkError|network|load failed|offline|HTTP \d{3}/i.test(m)) return 'モデルのダウンロードに失敗しました。通信状況を確認して、もう一度お試しください。';
  return `モデル「${def.short}」の初期化に失敗しました。お使いのブラウザ/端末がWebGPUでの実行に対応していない可能性があります。`;
}

async function refreshModelUI() {
  updateGroupUI();
  const def = selectedDef();
  const st = await LLM.getCacheStatus(def);
  const isLoaded = loadedDef?.key === def.key;
  const needF16Block = def.needsF16 && gpuInfo.ok && !gpuInfo.f16;
  const state = isLoaded ? '使用中' : st.cached ? '端末に保存済み（未読み込み）' : '未ダウンロード';
  const verWarn = st.cached && settings.modelVersions[def.key] && settings.modelVersions[def.key] !== modelVersion(def) ? ' ※モデルの版が変わったため、再ダウンロードが必要になる場合があります。' : '';
  ui.setModelControls({
    info: `${def.note} 状態: ${state}。サイズ: 約${def.approxMB}MB。${needF16Block ? ' ※この端末ではshader-f16が使えないため選べません。' : ''}${verWarn}`,
    showLoad: !isLoaded, loadDisabled: !gpuInfo.ok || needF16Block,
    loadLabel: st.cached ? `「${def.short}」を読み込む${loadedDef ? '（切り替え）' : ''}` : `「${def.short}」をダウンロードして読み込む（約${def.approxMB}MB）`,
    showUnload: !!loadedDef, showDelete: st.cached, locked: busy || chat.busy
  });
  const est = await LLM.storageEstimate();
  $('storage-info').textContent = est ? `ブラウザの保存領域: ${fmtMB(est.usage)} 使用 / 上限の目安 ${fmtMB(est.quota)}` : '';
}

function updateBackendInfo() {
  const b = LLM.backendInfo();
  $('backend-info').textContent = b.mode === 'worker' ? '推論: 別スレッド（Worker）で実行中' : b.mode === 'main' ? `推論: メインスレッドで実行中${b.fallbackReason ? `（別スレッドを使えなかったため: ${b.fallbackReason}）` : ''}` : '';
}
function markReady(def) {
  updateBackendInfo(); updateDiag();
  ui.setBadge('badge-model', 'ready', `Local / Offline ✓ ${def.short} 準備完了`);
  ui.showModelPanel({ msg: `使用中: ${def.label}。推論はこの端末のGPUだけで行われ、会話は外部に送信されません。` });
  ui.setChatEnabled(true);
}

async function doLoad(def, { silent = false } = {}) {
  ui.setBadge('badge-model', 'busy', `モデル(${def.short}): 準備中`);
  ui.showModelPanel({ msg: `「${def.short}」を準備しています（初回のみダウンロード。2回目以降は端末に保存された分を使います）。`, pct: 0 });
  try {
    await LLM.loadModel(def, (p) => {
      if (p.phase === 'downloading') {
        ui.setBadge('badge-model', 'busy', `モデル(${def.short}): ダウンロード中 ${p.pct.toFixed(0)}%`);
        ui.showModelPanel({ msg: p.total ? `ダウンロード中… ${fmtMB(p.loaded)} / ${fmtMB(p.total)}` : 'ダウンロードを開始しています…', pct: p.pct });
      } else {
        ui.setBadge('badge-model', 'busy', `モデル(${def.short}): GPUに読み込み中`);
        ui.showModelPanel({ msg: 'モデルをGPUに読み込んでいます…', pct: 100 });
      }
    });
    loadedDef = def; modelReady = true;
    settings.autoLoad = true; settings.modelVersions[def.key] = modelVersion(def); save();
    markReady(def); startProactive();
    if (!silent) ui.toast(`「${def.short}」の準備ができました。`);
    return true;
  } catch (e) {
    console.error(e);
    loadedDef = null; modelReady = false; ui.setChatEnabled(false);
    ui.setBadge('badge-model', 'error', `モデル(${def.short}): エラー`);
    ui.showModelPanel({ msg: classify(e, def), error: `${e?.name || 'Error'}: ${e?.message || e}\n${e?.stack || ''}`.slice(0, 2000) });
    return false;
  }
}

/** Switch/load: releases the current model first, then loads `def`. Rolls back once if the new load fails. */
async function switchTo(def, opts) {
  if (busy || chat.busy || !gpuInfo.ok) { if (chat.summarizing) ui.toast('記憶を整理中です。少し待ってからもう一度お試しください。'); return; }
  busy = true; await refreshModelUI();
  const prev = loadedDef;
  modelReady = false; ui.setChatEnabled(false); loadedDef = null;
  await LLM.unloadModel(); // free GPU memory before allocating the next model
  let ok = await doLoad(def, opts);
  if (!ok && prev && prev.key !== def.key && (await LLM.getCacheStatus(prev)).cached) {
    ui.toast(`「${def.short}」を読み込めなかったため、「${prev.short}」に戻します。`, 6000);
    const keepErr = $('err-pre').textContent;
    if (await doLoad(prev, { silent: true })) {
      settings.model = prev.key; save(); ui.renderModelSelect(prev.key, onModelSelect);
      ui.showModelPanel({ msg: `「${def.short}」を読み込めなかったため「${prev.short}」に戻しました。`, error: keepErr });
    }
  }
  busy = false; await refreshModelUI();
}

async function unloadNow(reason) {
  if (busy || chat.busy || !loadedDef) { if (reason === 'idle' && loadedDef && document.hidden) idleTimer = setTimeout(() => unloadNow('idle'), 30000); return; }
  busy = true;
  const d = loadedDef; releasedDef = reason === 'idle' ? d : null;
  loadedDef = null; modelReady = false; ui.setChatEnabled(false);
  await LLM.unloadModel();
  if (reason === 'manual') { settings.autoLoad = false; save(); }
  ui.setBadge('badge-model', 'idle', 'モデル: GPU解放済み');
  ui.showModelPanel({ msg: reason === 'idle' ? 'しばらく使われなかったためGPUメモリを解放しました。このタブに戻ると自動で再読み込みします（ダウンロードは不要です）。' : 'GPUメモリを解放しました。会話するには、もう一度モデルを読み込んでください。' });
  busy = false; await refreshModelUI();
}

function onModelSelect(key) { settings.model = key; save(); refreshModelUI(); updateDiag(); }

function gpuMessage(r) {
  if (r.reason === 'no-api') return 'このブラウザはWebGPUに対応していません。最新のChrome / Edge（デスクトップ・Android）や、WebGPUが有効なSafariをお試しください。';
  if (r.reason === 'no-adapter') return 'WebGPUは利用できますが、この端末で使えるGPUが見つかりませんでした。ブラウザの設定やGPUドライバを確認してください。';
  return 'WebGPUの初期化でエラーが発生しました。';
}

// ---- spontaneous NPC messages (one speaker at a time, short, can be turned off) ----
function stopProactive() { clearTimeout(proactiveTimer); proactiveTimer = null; }
function scheduleProactive(ms) {
  clearTimeout(proactiveTimer); proactiveTimer = null;
  if (!settings.proactiveOn) return;
  proactiveTimer = setTimeout(tickProactive, ms);
}
/** Starts the chain once the model is ready (first message shortly after launch, then spaced out). */
function startProactive() {
  if (!settings.proactiveOn || !modelReady || !characters.length || proactiveTimer !== null) return;
  scheduleProactive(startupDone ? nextDelay(settings.proactiveInterval) : PROACTIVE.startupDelayMs);
}
async function tickProactive() {
  proactiveTimer = null;
  const reason = blockReason({ enabled: settings.proactiveOn, modelReady, hidden: document.hidden, busy: busy || chat.busy, typing: $('input').value.trim() !== '', streak: proactiveStreak, characters: characters.length > 0, groupActive: groupActive() });
  if (['disabled', 'no-characters', 'model-not-ready', 'streak-limit'].includes(reason)) return; // restarted by an event (model ready / toggle / the player writes)
  if (reason) return scheduleProactive(PROACTIVE.retryMs);
  startupDone = true;
  const blocked = characters.filter((c) => chat.hasUnansweredProactive(c.id)).map((c) => c.id);
  const speaker = pickSpeaker({ characters, lastSpeakerId, blockedIds: blocked });
  if (!speaker) return scheduleProactive(nextDelay(settings.proactiveInterval));
  const msg = await chat.speakFirst(speaker.id);
  if (msg && charById(speaker.id)) {
    lastSpeakerId = speaker.id; proactiveStreak++;
    if (settings.selectedNpc === speaker.id) { render(); say(msg.content); }
    else { unread.add(speaker.id); refreshNpcList(); ui.toast(`${speaker.name}さんが話しかけてきました。`, 6000); }
  }
  refreshModelUI();
  if (proactiveStreak < PROACTIVE.maxStreak) scheduleProactive(nextDelay(settings.proactiveInterval));
}

// ---- world time / player settings ----
function updateTimeBadge() {
  const dt = resolveDate(settings.dateMode, settings.fixedDate);
  ui.setBadge('badge-date', 'idle', `📅 ${dt.m}月${dt.d}日(${dt.weekday})・${dt.seasonLabel}${dt.auto ? '' : '（固定）'}`);
  const t = nowTime();
  const hh = String(t.hour).padStart(2, '0'), mm = String(t.minute).padStart(2, '0');
  ui.setBadge('badge-time', 'idle', `🕒 ${t.label}${t.auto ? `（${hh}:${mm}）` : '（固定）'}`);
}
let saveTimer = null, statusTimer = null;
function setStatus(msg) { const el = $('custom-status'); el.textContent = msg; clearTimeout(statusTimer); statusTimer = setTimeout(() => { el.textContent = ''; }, 6000); }
function syncMemoryUI() {
  const npc = npcNow();
  $('memory-npc-name').textContent = npc ? npc.name : '（住人なし）';
  $('txt-memory').value = npc ? chat.memoryOf(npc.id) : '';
}
function syncCustomUI() {
  const npc = npcNow();
  syncMemoryUI(); $('chk-memory').checked = settings.memoryOn;
  $('knows-npc-name').textContent = npc ? npc.name : '（住人なし）'; $('chk-knows').checked = npc ? chat.knows(npc.id) : false; $('chk-knows').disabled = !npc;
  $('btn-clear-memory').disabled = !npc;
  $('inp-player-name').value = custom.player.name;
  $('txt-player-profile').value = custom.player.profile; $('txt-player-personality').value = custom.player.personality;
  $('cnt-player-profile').textContent = custom.player.profile.length; $('cnt-player-personality').textContent = custom.player.personality.length;
  $('txt-world').value = custom.world; $('cnt-world').textContent = custom.world.length;
  $('sel-time').value = settings.timeMode; $('sel-length').value = settings.replyLength;
  $('sel-date').value = settings.dateMode; $('lbl-fixed-date').hidden = settings.dateMode !== 'fixed'; $('inp-fixed-date').value = settings.fixedDate;
  $('chk-proactive').checked = settings.proactiveOn; $('sel-proactive').value = settings.proactiveInterval;
  updateTimeBadge();
}
function persistCustom() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { Store.saveCustom(custom); setStatus('保存しました（この端末のブラウザ内）。'); }, 400);
}
function wireCustom() {
  $('txt-world').maxLength = LIMITS.world;
  $('txt-world').addEventListener('input', (e) => { custom.world = e.target.value.slice(0, LIMITS.world); $('cnt-world').textContent = custom.world.length; persistCustom(); });
  $('sel-time').addEventListener('change', (e) => { settings.timeMode = e.target.value; save(); updateTimeBadge(); });
  $('sel-length').addEventListener('change', (e) => { settings.replyLength = e.target.value; save(); });
  const sp = $('sel-proactive'); sp.textContent = ''; for (const [k, v] of Object.entries(PROACTIVE.intervals)) sp.add(new Option(v.label, k));
  $('sel-date').addEventListener('change', (e) => {
    settings.dateMode = e.target.value; $('lbl-fixed-date').hidden = settings.dateMode !== 'fixed';
    if (settings.dateMode === 'fixed' && !parseFixedDate(settings.fixedDate)) { const d = new Date(); settings.fixedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; $('inp-fixed-date').value = settings.fixedDate; }
    save(); updateTimeBadge();
  });
  $('inp-fixed-date').addEventListener('change', (e) => { if (parseFixedDate(e.target.value)) { settings.fixedDate = e.target.value; save(); updateTimeBadge(); } });
  $('chk-proactive').addEventListener('change', (e) => { settings.proactiveOn = e.target.checked; save(); if (settings.proactiveOn) startProactive(); else stopProactive(); });
  sp.addEventListener('change', (e) => { settings.proactiveInterval = e.target.value; save(); if (settings.proactiveOn) scheduleProactive(nextDelay(settings.proactiveInterval)); });
  setInterval(updateTimeBadge, 30000);
  const player = () => (custom.player || (custom.player = sanitizePlayer({})));
  $('inp-player-name').maxLength = LIMITS.playerName;
  $('inp-player-name').addEventListener('input', (e) => { player().name = e.target.value.replace(/[\r\n]+/g, ' ').slice(0, LIMITS.playerName); persistCustom(); });
  $('txt-player-profile').addEventListener('input', (e) => { player().profile = e.target.value.slice(0, LIMITS.playerProfile); $('cnt-player-profile').textContent = player().profile.length; persistCustom(); });
  $('txt-player-personality').addEventListener('input', (e) => { player().personality = e.target.value.slice(0, LIMITS.playerPersonality); $('cnt-player-personality').textContent = player().personality.length; persistCustom(); });
  $('chk-knows').addEventListener('change', (e) => { if (npcNow()) chat.setKnows(settings.selectedNpc, e.target.checked); });
  $('chk-memory').addEventListener('change', (e) => { settings.memoryOn = e.target.checked; save(); });
  $('btn-clear-memory').addEventListener('click', () => { if (!npcNow()) return; chat.clearMemory(settings.selectedNpc); syncCustomUI(); setStatus('この住人の記憶を消しました（会話の履歴は残っています）。'); });
  $('btn-reset-custom').addEventListener('click', () => {
    if (!confirm('入力した世界観と、あなた（プレイヤー）の設定を消します。よろしいですか？')) return;
    custom = sanitizeCustom({}); Store.saveCustom(custom); syncCustomUI(); setStatus('入力した設定を消しました。');
  });
}

// ---- characters: editor / samples / files ----
let editingId = null;
const FIELD = { name: 'f-name', age: 'f-age', gender: 'f-gender', occupation: 'f-occupation', firstPerson: 'f-first', personality: 'f-personality', speechStyle: 'f-speech', sampleLines: 'f-lines', interests: 'f-interests', notes: 'f-notes', greeting: 'f-greeting' };
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const safeName = (s) => String(s).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 20) || 'character';

function readEditor() {
  const base = editingId ? charById(editingId) : blankCharacter();
  const merged = { ...base };
  for (const [k, id] of Object.entries(FIELD)) merged[k] = $(id).value;
  merged.voice = { gender: $('f-vgender').value, pitch: Number($('f-pitch').value) };
  if (merged.greeting) delete merged.greetings;                       // a custom greeting overrides the sample's per-period greetings
  if (base.personality !== undefined && merged.personality !== base.personality) delete merged.summary; // card summary would be stale
  return sanitizeCharacter(merged);
}
function updateTotal() {
  const n = promptChars(readEditor());
  $('f-total').textContent = `設定の合計: 約${n}字${n > SOFT_TOTAL_CHARS ? '（長いほど、返事の開始が遅くなります）' : ''}`;
  $('out-pitch').textContent = Number($('f-pitch').value).toFixed(2);
}
function openEditor(id = null) {
  if (chat.generating) return;
  if (!id && characters.length >= MAX_CHARACTERS) return ui.toast(`住人は${MAX_CHARACTERS}人までです。`);
  editingId = id;
  const c = id ? charById(id) : blankCharacter();
  if (!c) return;
  for (const [k, fid] of Object.entries(FIELD)) $(fid).value = c[k] ?? '';
  $('f-vgender').value = c.voice.gender; $('f-pitch').value = c.voice.pitch;
  $('char-dlg-title').textContent = id ? `「${c.name}」を編集` : '住人を追加';
  $('btn-char-delete').hidden = !id; $('btn-char-export').hidden = !id;
  $('f-error').textContent = ''; updateTotal();
  $('dlg-char').showModal();
}
function saveEditor() {
  const c = readEditor();
  const errs = validateCharacter(c);
  if (errs.length) { $('f-error').textContent = errs.join(' '); return; }
  const now = Date.now();
  const dup = characters.some((o) => o.id !== editingId && o.name === c.name);
  if (editingId) {
    c.id = editingId; c.updatedAt = now;
    characters = characters.map((o) => (o.id === editingId ? c : o));
  } else {
    c.id = newCharacterId(); c.createdAt = c.updatedAt = now; characters.push(c);
  }
  Store.saveCharacters(characters);
  const wasNew = !editingId; editingId = null;
  $('dlg-char').close();
  refreshNpcList();
  if (wasNew) { selectNpc(c.id); startProactive(); Store.requestPersistence().then(updateDataInfo); } else { ui.setChatHeader(npcNow()); render(); syncCustomUI(); refreshVoices(); }
  ui.toast(dup ? '保存しました（同じ名前の住人がいます）。' : '保存しました。');
}
function deleteEditing() {
  const c = charById(editingId); if (!c) return;
  if (!confirm(`「${c.name}」を削除します。この住人との会話履歴と記憶も消えます。よろしいですか？`)) return;
  chat.deleteData(c.id); delete settings.voices[c.id];
  characters = characters.filter((o) => o.id !== c.id); Store.saveCharacters(characters);
  editingId = null; $('dlg-char').close();
  if (settings.selectedNpc === c.id) settings.selectedNpc = characters[0]?.id ?? null;
  save(); refreshNpcList(); selectNpc(settings.selectedNpc); ui.toast('削除しました。');
}
function openSamples() {
  const ul = $('sample-list'); ul.textContent = '';
  for (const s of SAMPLES) {
    const li = document.createElement('li'); const d = document.createElement('div');
    d.innerHTML = '<div class="s-name"></div><div class="s-desc"></div>';
    d.querySelector('.s-name').textContent = s.data.name; d.querySelector('.s-desc').textContent = `${s.data.age}歳・${s.data.occupation}　${s.data.summary}`;
    const b = document.createElement('button'); b.type = 'button';
    const exists = characters.some((c) => c.sampleKey === s.key);
    b.textContent = exists ? '追加済み' : '追加'; b.disabled = exists || characters.length >= MAX_CHARACTERS;
    b.addEventListener('click', () => {
      const c = characterFromSample(s, newCharacterId()); characters.push(c); Store.saveCharacters(characters);
      refreshNpcList(); selectNpc(c.id); $('dlg-samples').close(); ui.toast(`「${c.name}」を追加しました。名前や設定は「編集」から変えられます。`); Store.requestPersistence().then(updateDataInfo);
    });
    li.append(d, b); ul.appendChild(li);
  }
  $('dlg-samples').showModal();
}
async function importCharacterFile(file) {
  if (!file) return;
  if (characters.length >= MAX_CHARACTERS) return ui.toast(`住人は${MAX_CHARACTERS}人までです。`);
  if (file.size > FILE_LIMIT) return ui.toast('ファイルが大きすぎます。');
  const r = parseCharacterFile(await file.text());
  if (!r.ok) return ui.toast(r.error, 6000);
  const c = r.character; c.id = newCharacterId(); c.createdAt = c.updatedAt = Date.now();
  characters.push(c); Store.saveCharacters(characters); refreshNpcList(); selectNpc(c.id); ui.toast(`「${c.name}」を読み込みました。`);
}
function wireCharacters() {
  $('btn-add-char').addEventListener('click', () => openEditor(null));
  $('btn-add-sample').addEventListener('click', openSamples);
  $('btn-import-char').addEventListener('click', () => $('file-import-char').click());
  $('file-import-char').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; importCharacterFile(f); });
  $('btn-char-save').addEventListener('click', saveEditor);
  $('btn-char-cancel').addEventListener('click', () => { editingId = null; $('dlg-char').close(); });
  $('btn-char-delete').addEventListener('click', deleteEditing);
  $('btn-char-export').addEventListener('click', () => { const c = charById(editingId); if (c) downloadJson(buildCharacterFile(c, { appVersion: APP.version }), `npc-${safeName(c.name)}-${stamp()}.json`); });
  const dlg = $('dlg-char');
  dlg.addEventListener('input', updateTotal);
  dlg.addEventListener('cancel', () => { editingId = null; });
  $('f-name').maxLength = CLIMITS.name;
}

// ---- group modes: characters talk to each other (story / shiritori) ----
let group = null; // { session, state: 'running'|'paused'|'waiting'|'finished', stepMode, pauseRequested }
const gSelected = new Set();
let groupLoopRunning = false;
const groupActive = () => !!group && group.state !== 'finished';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setGStatus = (t) => { $('g-status').textContent = t; };

function renderGroupPeople() {
  for (const id of [...gSelected]) if (!charById(id)) gSelected.delete(id);
  const box = $('g-people'); box.textContent = '';
  for (const c of characters) {
    const lab = document.createElement('label'); lab.className = 'toggle';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = c.id; cb.checked = gSelected.has(c.id);
    cb.disabled = groupActive() || (!cb.checked && gSelected.size >= GROUP.maxParticipants);
    cb.addEventListener('change', () => { if (cb.checked) gSelected.add(c.id); else gSelected.delete(c.id); renderGroupPeople(); updateGroupUI(); });
    lab.append(cb, document.createTextNode(` ${c.name}`)); box.appendChild(lab);
  }
}
function updateGroupUI() {
  if (!$('sel-gmode')) return;
  const mode = $('sel-gmode').value, active = groupActive(), st = group?.state;
  $('g-story-opts').hidden = mode !== 'story'; $('g-shiri-opts').hidden = mode !== 'shiritori';
  $('g-people-hint').textContent = characters.length < 2 && mode === 'story' ? '物語づくりには住人が2人以上必要です（「サンプル住人」から追加できます）。' : `選択中: ${gSelected.size}人（最大${GROUP.maxParticipants}人）`;
  $('btn-gstart').hidden = active; $('btn-gstart').disabled = !modelReady;
  $('btn-gpause').hidden = !(st === 'running' || st === 'paused'); $('btn-gpause').textContent = st === 'paused' ? '再開' : '一時停止';
  $('btn-gstep').hidden = st !== 'paused';
  $('btn-gstop').hidden = !active;
  $('g-directive').hidden = !(active && group.session.mode === 'story');
  $('g-word').hidden = st !== 'waiting';
  const has = !!group && group.session.lines.length > 0;
  $('btn-gsave').hidden = !has; $('btn-gcopy').hidden = !has;
  for (const id of ['sel-gmode', 'inp-gtitle', 'sel-gturns', 'sel-gpace', 'chk-gplayer']) $(id).disabled = active;
}
function renderGroupLine(line) {
  const d = document.createElement('div'); d.className = `gline ${line.kind}`;
  if (line.kind !== 'system') { const n = document.createElement('span'); n.className = 'gname'; n.textContent = line.kind === 'directive' ? 'あなたの指示' : line.name; d.appendChild(n); }
  const t = document.createElement('span'); const rd = line.reading && line.reading !== line.text.replace(/[「」]/g, '') ? `（${line.reading}）` : '';
  t.textContent = line.text + rd; d.appendChild(t);
  const log = $('group-log'); log.appendChild(d); log.scrollTop = log.scrollHeight;
}
async function showGroupLine(line) {
  renderGroupLine(line);
  if (speech.on && speech.supported && line.kind === 'npc') { // one voice at a time; wait until it finishes
    const c = charById(line.speakerId);
    if (c) await speech.speak(line.text.replace(/[「」]/g, ''), c, settings.voices[c.id]).done;
  }
}
function pauseGroup(msg) { if (!group || group.state === 'finished') return; group.state = 'paused'; group.pauseRequested = false; setGStatus(msg); updateGroupUI(); }
function finishGroup(result) {
  if (!group) return; group.state = 'finished';
  const s = group.session;
  setGStatus(s.mode === 'story' ? 'おしまい。「テキストで保存」で物語を残せます。' : result?.reason === 'lost' ? `ゲーム終了（${s.order.find((p) => p.id === result.loser)?.name || ''}の負け）。` : 'ゲーム終了。');
  updateGroupUI(); refreshModelUI();
}
function startGroup() {
  if (groupActive()) return;
  if (!modelReady) return setGStatus('先にAIモデルを読み込んでください（画面下の「ローカルAIモデル」）。');
  if (chat.busy) return setGStatus('いまは別の処理中です。少し待ってからもう一度お試しください。');
  const mode = $('sel-gmode').value, chars = [...gSelected].map(charById).filter(Boolean);
  const withPlayer = mode === 'shiritori' && $('chk-gplayer').checked;
  if (mode === 'story' && chars.length < 2) return setGStatus('物語づくりには、2人以上の住人を選んでください。');
  if (mode === 'shiritori' && chars.length + (withPlayer ? 1 : 0) < 2) return setGStatus('しりとりには、あなたを含めて2人以上が必要です。');
  const title = $('inp-gtitle').value.trim();
  if (mode === 'story' && !title) return setGStatus('物語のタイトル（テーマ）を入力してください。');
  const session = new GroupSession({ mode, characters: chars, title, maxTurns: Number($('sel-gturns').value) || GROUP.story.defaultTurns, includePlayer: withPlayer, playerName: custom.player.name || 'あなた', generate: (m, o) => chat.generateExclusive(m, o) });
  group = { session, state: 'running', stepMode: $('sel-gpace').value === 'step', pauseRequested: false };
  $('group-log').textContent = '';
  if (mode === 'story') renderGroupLine({ kind: 'system', text: `物語『${session.title}』を、${chars.map((c) => c.name).join('・')}で語り継ぎます。` });
  setGStatus('始めます…'); updateGroupUI(); runGroup();
}
async function runGroup() {
  if (groupLoopRunning || !group) return;
  groupLoopRunning = true; const g = group; let busyTries = 0;
  try {
    while (g.state === 'running') {
      if (document.hidden) { pauseGroup('タブが見えなくなったため、一時停止しました。'); break; }
      if (!modelReady) { pauseGroup('AIモデルが読み込まれていないため、一時停止しました。'); break; }
      setGStatus(`${g.session.current()?.name || ''}${g.session.mode === 'story' ? 'が語っています…' : 'が考えています…'}`);
      let r;
      try { r = await g.session.step(); } catch (e) { console.error(e); pauseGroup('生成でエラーが出たため、一時停止しました。'); showDetails(e); break; }
      if (g.state === 'finished' || r.type === 'stopped') break;
      if (r.type === 'busy') { if (++busyTries > 25) { pauseGroup('他の処理が長引いているため、一時停止しました。'); break; } await sleep(800); continue; }
      busyTries = 0;
      if (r.type === 'aborted') { pauseGroup('チャットを送ったため、会話を一時停止しました。「再開」で続けられます。'); break; }
      if (r.type === 'wait-player') { g.state = 'waiting'; setGStatus(`あなたの番です。「${r.required}」から始まる言葉を答えてください。`); updateGroupUI(); $('inp-gword').focus(); break; }
      if (r.line) await showGroupLine(r.line);
      if (r.system) await showGroupLine(r.system);
      if (g.state === 'finished') break;
      if (r.type === 'end') { finishGroup(r.result); break; }
      updateGroupUI();
      if (g.stepMode) { pauseGroup('「次の発言」で続けます。'); break; }
      if (g.pauseRequested) { pauseGroup('一時停止中です。'); break; }
      await sleep(GROUP.paceMs);
    }
  } finally { groupLoopRunning = false; updateGroupUI(); }
}
async function submitGroupWord() {
  if (!group || group.state !== 'waiting') return;
  const r = group.session.playerWord($('inp-gword').value);
  if (!r.ok) return setGStatus(r.error);
  $('inp-gword').value = ''; group.state = 'running'; updateGroupUI();
  await showGroupLine(r.result.line); if (r.result.system) await showGroupLine(r.result.system);
  if (r.result.type === 'end') return finishGroup(r.result.result);
  runGroup();
}
function wireGroup() {
  const turns = $('sel-gturns'); turns.textContent = ''; for (const n of GROUP.story.turnChoices) turns.add(new Option(`${n}発言`, n)); turns.value = GROUP.story.defaultTurns;
  $('sel-gmode').addEventListener('change', updateGroupUI);
  $('btn-gstart').addEventListener('click', startGroup);
  $('btn-gpause').addEventListener('click', () => {
    if (!group) return;
    if (group.state === 'running') { group.pauseRequested = true; setGStatus('この発言のあとで一時停止します。'); }
    else if (group.state === 'paused') { group.state = 'running'; updateGroupUI(); runGroup(); }
  });
  $('btn-gstep').addEventListener('click', () => { if (group?.state === 'paused') { group.state = 'running'; updateGroupUI(); runGroup(); } });
  $('btn-gstop').addEventListener('click', () => {
    if (!group) return; group.session.stop(); group.state = 'finished'; chat.abortExclusive(); speech.stop();
    setGStatus('終了しました。'); updateGroupUI(); refreshModelUI();
  });
  const directive = () => { const l = group?.session.insertDirective($('inp-gdirective').value); if (l) { renderGroupLine(l); $('inp-gdirective').value = ''; setGStatus('指示を入れました。次の発言に反映されます。'); updateGroupUI(); } };
  $('btn-gdirective').addEventListener('click', directive);
  $('btn-gword').addEventListener('click', submitGroupWord);
  for (const [id, fn] of [['inp-gword', submitGroupWord], ['inp-gdirective', directive]]) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); fn(); } });
  $('btn-gforfeit').addEventListener('click', () => { const r = group?.session.forfeit(); if (r) { renderGroupLine(r.line); finishGroup(r.result); } });
  $('btn-gsave').addEventListener('click', () => {
    const blob = new Blob([group.session.exportText()], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${group.session.mode === 'story' ? 'story' : 'shiritori'}-${stamp()}.txt`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('btn-gcopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(group.session.exportText()); ui.toast('コピーしました。'); } catch { ui.toast('コピーできませんでした。'); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && group?.state === 'running') group.pauseRequested = true; });
  updateGroupUI();
}

// ---- backup / data ----
async function updateDataInfo() {
  const s = await Store.storageStatus();
  const mb = (n) => (n === null ? '—' : `${(n / 1048576).toFixed(1)}MB`);
  const where = { indexedDB: 'IndexedDB', localStorage: 'localStorage（IndexedDBが使えないため）', memory: 'メモリのみ（保存されません）' }[s.backend];
  $('data-info').textContent = `保存先: ${where} / 永続化: ${s.persisted === null ? '不明' : s.persisted ? '有効（ブラウザに消されにくい）' : '未設定'} / 使用量: ${mb(s.usage)}（上限の目安 ${mb(s.quota)}）`;
  $('btn-persist').hidden = s.persisted === true;
}
function exportBackup(withChats) {
  downloadJson(buildBackup({ characters, custom, settings, conversations: chat.convs, memory: chat.mem, relations: chat.rel }, { withChats, appVersion: APP.version }), `local-npc-chat-backup-${stamp()}.json`);
  setStatus(withChats ? 'バックアップを書き出しました（会話履歴と記憶を含みます）。' : 'バックアップを書き出しました（会話履歴は含みません）。');
}
async function importBackup(file) {
  if (!file) return;
  if (file.size > FILE_LIMIT) return ui.toast('ファイルが大きすぎます。');
  const r = parseBackup(await file.text());
  if (!r.ok) { setStatus(`読み込みに失敗しました：${r.error}`); return ui.toast(r.error, 6000); }
  const d = r.data;
  const lines = [];
  if (d.characters) lines.push(`住人 ${d.characters.length}人（現在の住人は置き換えられます）`);
  lines.push('世界観・あなたの設定・時間/返答の長さ/記憶の設定');
  if (d.conversations) lines.push('会話履歴と記憶（現在のものは置き換えられます）');
  if (!confirm(`次の内容で現在のデータを上書きします。よろしいですか？\n・${lines.join('\n・')}${r.warnings.length ? `\n\n注意:\n${r.warnings.join('\n')}` : ''}`)) return;
  if (d.characters) {
    const keep = new Set(d.characters.map((c) => c.id));
    for (const c of characters) if (!keep.has(c.id)) chat.deleteData(c.id);
    characters = d.characters; Store.saveCharacters(characters);
  }
  custom = { ...custom, ...d.custom }; Store.saveCustom(custom);
  Object.assign(settings, d.settings || {}); save();
  if (d.conversations) chat.replaceState({ conversations: d.conversations, memory: d.memory, relations: d.relations });
  if (!charById(settings.selectedNpc)) settings.selectedNpc = characters[0]?.id ?? null;
  refreshNpcList(); selectNpc(settings.selectedNpc);
  setStatus(`バックアップを読み込みました。${r.warnings.join(' ')}`);
}

// ---- diagnostics ----
function diagInfo() {
  const b = LLM.backendInfo(); const bud = budget();
  return {
    アプリ: `v${APP.version}`, モデル: loadedDef ? `${loadedDef.id} (${loadedDef.dtype})` : `（未読み込み／選択中: ${selectedDef().short}）`,
    推論スレッド: b.mode === 'worker' ? '別スレッド(Worker)' : b.mode === 'main' ? `メインスレッド${b.fallbackReason ? `（${b.fallbackReason}）` : ''}` : '未起動',
    WebGPU: gpuInfo.ok ? `利用可能${gpuInfo.info ? ` (${gpuInfo.info})` : ''}${gpuInfo.f16 ? ' / shader-f16' : ''}` : '利用不可',
    '履歴の予算': `${bud.budgetChars}字・${bud.maxMessages}発言${settings.lightMode ? '（軽量モード）' : ''}`,
    保存先: Store.storageBackend(), 住人数: characters.length
  };
}
function updateDiag() { ui.renderDiagnostics(diagInfo(), runs); }

function wire() {
  $('btn-send').addEventListener('click', send);
  $('btn-stop').addEventListener('click', () => chat.stop());
  $('input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return; // never send mid-IME composition
    if (matchMedia('(pointer: coarse)').matches) return; // touch keyboards: Enter = newline
    e.preventDefault(); send();
  });
  $('btn-new').addEventListener('click', () => { const n = npcNow(); if (!n) return; speech.stop(); chat.newConversation(n.id, nowTime().key); render(); syncCustomUI(); });
  $('btn-clear').addEventListener('click', () => { const n = npcNow(); if (!n) return; speech.stop(); chat.clear(n.id); render(); syncCustomUI(); });
  $('chk-worker').checked = settings.useWorker; $('chk-light').checked = settings.lightMode;
  $('chk-worker').addEventListener('change', (e) => { settings.useWorker = e.target.checked; save(); LLM.setUseWorker(settings.useWorker); ui.toast(loadedDef ? '次にモデルを読み込むときから反映されます（「GPUメモリを解放」→「読み込む」）。' : '設定しました。'); });
  $('chk-light').addEventListener('change', (e) => { settings.lightMode = e.target.checked; save(); updateDiag(); ui.toast(settings.lightMode ? '軽量モードをオンにしました（次の返事から）。' : '軽量モードをオフにしました。'); });
  $('btn-load').addEventListener('click', () => switchTo(selectedDef()));
  $('btn-unload').addEventListener('click', () => unloadNow('manual'));
  $('btn-delete-model').addEventListener('click', async () => {
    const def = selectedDef();
    if (!confirm(`「${def.short}」の保存データ（約${def.approxMB}MB）を削除します。次に使うときは再ダウンロードが必要です。よろしいですか？`)) return;
    if (loadedDef?.key === def.key) await unloadNow('manual');
    const n = await LLM.deleteCache(def); ui.toast(n ? '保存データを削除しました。' : '削除するデータがありませんでした。'); refreshModelUI();
  });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(idleTimer);
    if (document.hidden) {
      if (modelReady) idleTimer = setTimeout(() => unloadNow('idle'), CONFIG.idleReleaseMs);
    } else if (releasedDef && !busy) { const d = releasedDef; releasedDef = null; switchTo(d, { silent: true }); }
  });
  $('chk-speech').checked = settings.speechOn;
  $('chk-speech').addEventListener('change', (e) => {
    speech.on = settings.speechOn = e.target.checked; save();
    if (!speech.on) speech.stop(); else if (!speech.supported) ui.toast('このブラウザは音声合成に対応していません。');
  });
  const rate = $('rng-rate'); rate.min = CONFIG.speech.minRate; rate.max = CONFIG.speech.maxRate; rate.value = settings.rate; $('out-rate').textContent = Number(settings.rate).toFixed(1);
  rate.addEventListener('input', () => { speech.rate = settings.rate = Number(rate.value); $('out-rate').textContent = speech.rate.toFixed(1); save(); });
  const about = () => { ui.fillAbout(loadedDef || selectedDef(), { '推論スレッド': LLM.backendInfo().mode === 'worker' ? '別スレッド(Worker)' : LLM.backendInfo().mode === 'main' ? 'メインスレッド' : '未起動', 'モデル状態': modelReady ? `Local / Offline（${loadedDef.short} 準備完了）` : '未読み込み', 'WebGPU': gpuInfo.ok ? `利用可能${gpuInfo.f16 ? '（shader-f16対応）' : '（shader-f16非対応）'}` : '利用不可', '公式URL': CONFIG.publicUrl }); $('dlg-about').showModal(); };
  $('btn-about').addEventListener('click', about); $('btn-about2').addEventListener('click', about);
  $('btn-clear-data').addEventListener('click', () => {
    if (!confirm('すべての住人との会話履歴と記憶を削除します。住人・設定・AIモデルは残ります。よろしいですか？')) return;
    chat.clearAll(); const n = npcNow(); if (n) chat.ensureGreeting(n.id, nowTime().key); render(); syncCustomUI(); ui.toast('会話データを削除しました。');
  });
  $('btn-reset').addEventListener('click', () => $('dlg-reset').showModal());
  $('btn-reset-ok').addEventListener('click', async () => {
    await Store.resetAppData({ includeModel: $('chk-reset-model').checked });
    location.reload();
  });
  $('btn-export-backup').addEventListener('click', () => exportBackup(false));
  $('btn-export-backup-chats').addEventListener('click', () => exportBackup(true));
  $('btn-import-backup').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; importBackup(f); });
  $('btn-persist').addEventListener('click', async () => { const ok = await Store.requestPersistence(); ui.toast(ok ? '保存領域を消えにくくしました。' : 'ブラウザが許可しませんでした（利用状況によって許可される場合があります）。', 6000); updateDataInfo(); });
  $('btn-copy-diag').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('diag-pre').textContent); ui.toast('診断をコピーしました。'); } catch { ui.toast('コピーできませんでした。手動で選択してコピーしてください。'); } });
  $('btn-update-later').addEventListener('click', ui.hideUpdate);
}

async function registerSW(checker) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('service-worker.js');
    reg.addEventListener('updatefound', () => { if (navigator.serviceWorker.controller) checker.check(); });
  } catch (e) { console.warn(e); ui.toast('オフライン機能（サービスワーカー）を有効にできませんでした。'); showDetails(e); }
}

async function init() {
  $('ver').textContent = APP.version;
  document.title = `${APP.appName} v${APP.version}`;
  wire(); wireCustom(); wireCharacters(); wireGroup(); ui.setGenerating(false); ui.setChatEnabled(false);
  refreshNpcList();
  speech.onVoices = refreshVoices;
  selectNpc(settings.selectedNpc);
  speech.init().then(refreshVoices);
  updateDataInfo(); updateDiag();
  if (!speech.supported) ui.toast('このブラウザは音声合成に対応していません（会話は可能です）。', 6000);

  const checker = new UpdateChecker({
    onUpdate: (remote, o) => ui.showUpdate(remote, o.belowMinimum),
    onError: (e) => console.warn('update check failed', e)
  });
  $('btn-update').addEventListener('click', () => checker.apply());
  registerSW(checker); checker.start();

  ui.renderModelSelect(settings.model, onModelSelect);
  const gpu = await LLM.checkWebGPU(); gpuInfo = gpu; updateDiag();
  ui.setBadge('badge-gpu', gpu.ok ? 'ready' : 'error', gpu.ok ? `WebGPU: 利用可能${gpu.info ? ` (${gpu.info})` : ''}` : 'WebGPU: 利用不可');
  if (!gpu.ok) {
    ui.setBadge('badge-model', 'error', 'モデル: 実行不可');
    ui.showModelPanel({ msg: gpuMessage(gpu), error: gpu.detail || `WebGPU check failed: ${gpu.reason}` });
    await refreshModelUI();
    return;
  }
  const def = selectedDef();
  const st = await LLM.getCacheStatus(def);
  if (settings.autoLoad && st.cached && !(def.needsF16 && !gpu.f16)) { await switchTo(def, { silent: true }); return; } // cached: no download consent needed
  ui.showModelPanel({ msg: st.cached ? 'モデルは端末に保存されています。「読み込む」を押すと開始します。' : `初回のみ、AIモデル（約${def.approxMB}MB）をダウンロードして端末に保存します。Wi‑Fi接続をおすすめします。会話内容は外部に送信されません。` });
  await refreshModelUI();
}
init();
