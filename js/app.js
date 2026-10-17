import { CONFIG, APP, MODELS, getModel, modelVersion, DEFAULT_MODEL_KEY } from './config.js';
import { NPCS, getNpc } from './npcs.js';
import * as LLM from './llm.js';
import * as Store from './storage.js';
import { Chat } from './chat.js';
import { Speech } from './speech.js';
import { UpdateChecker } from './update-checker.js';
import * as ui from './ui.js';
const { $ } = ui;

const settings = Store.loadSettings();
if (!NPCS.some((n) => n.id === settings.selectedNpc)) settings.selectedNpc = NPCS[0].id;
if (!MODELS.some((m) => m.key === settings.model)) settings.model = DEFAULT_MODEL_KEY;
const speech = new Speech();
speech.on = settings.speechOn; speech.rate = settings.rate;
let modelReady = false;
const save = () => Store.saveSettings(settings);
const npcNow = () => getNpc(settings.selectedNpc);

const chat = new Chat({
  onStream: (id, text) => { if (id === settings.selectedNpc) ui.streamUpdate(text); },
  onDone: (id) => { ui.setGenerating(false); ui.setChatEnabled(modelReady); refreshModelUI(); if (id === settings.selectedNpc) render(); },
  onError: (e) => { console.error(e); ui.toast('返事の生成に失敗しました。もう一度試してください。'); showDetails(e); }
});

function render() { ui.renderMessages(settings.selectedNpc, chat.messages(settings.selectedNpc), { generating: chat.generating, onReplay: (t) => say(t, true) }); }
function showDetails(e) { $('err-details').hidden = false; $('err-pre').textContent = `${e?.name || 'Error'}: ${e?.message || e}\n${e?.stack || ''}`.slice(0, 2000); }

function say(text, force = false) {
  if (!force && !speech.on) return;
  if (!speech.supported) return ui.toast('このブラウザは音声合成に対応していません。');
  const r = speech.speak(text, npcNow(), settings.voices[settings.selectedNpc]);
  if (r.reason === 'no-voice') ui.toast('適切な声が見つかりませんでした。端末の標準音声で再生を試みます。');
}

function updateVoiceInfo() {
  const npc = npcNow(); const prefs = settings.voices[npc.id];
  if (!speech.supported) { $('voice-info').textContent = '音声合成は利用できません。'; return; }
  const part = (lang, label) => {
    const p = speech.choose(lang, npc, prefs);
    return p ? `${label}: ${p.voice.name}（${p.onlineNatural ? 'Microsoft Online Natural' : '標準音声'}）` : `${label}: 利用可能な声なし`;
  };
  $('voice-info').textContent = `${npc.name}の声 → ${part('ja', '日本語')} / ${part('en', '英語')}`;
}
function refreshVoices() {
  ui.fillVoiceSelects(speech.voices, settings.voices[settings.selectedNpc], (lang, val) => {
    settings.voices[settings.selectedNpc] = { ...(settings.voices[settings.selectedNpc] || {}), [lang]: val }; save(); updateVoiceInfo();
  });
  updateVoiceInfo();
}

function selectNpc(id) {
  if (chat.generating) return;
  speech.stop(); settings.selectedNpc = id; save();
  const npc = npcNow(); ui.markSelected(id); ui.setChatHeader(npc);
  chat.ensureGreeting(id); render(); refreshVoices();
}

async function send() {
  const input = $('input'); const text = input.value.trim();
  if (!text) return;
  if (!modelReady) return ui.toast('先にAIモデルを読み込んでください。');
  input.value = ''; speech.stop(); ui.setGenerating(true);
  const id = settings.selectedNpc;
  const p = chat.send(id, text);
  render();
  const reply = await p;
  ui.setGenerating(false); ui.setChatEnabled(modelReady); input.focus();
  if (reply && id === settings.selectedNpc) say(reply);
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
    showUnload: !!loadedDef, showDelete: st.cached, locked: busy || chat.generating
  });
  const est = await LLM.storageEstimate();
  $('storage-info').textContent = est ? `ブラウザの保存領域: ${fmtMB(est.usage)} 使用 / 上限の目安 ${fmtMB(est.quota)}` : '';
}

function markReady(def) {
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
    markReady(def);
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
  if (busy || chat.generating || !gpuInfo.ok) return;
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
  if (busy || chat.generating || !loadedDef) return;
  busy = true;
  const d = loadedDef; releasedDef = reason === 'idle' ? d : null;
  loadedDef = null; modelReady = false; ui.setChatEnabled(false);
  await LLM.unloadModel();
  if (reason === 'manual') { settings.autoLoad = false; save(); }
  ui.setBadge('badge-model', 'idle', 'モデル: GPU解放済み');
  ui.showModelPanel({ msg: reason === 'idle' ? 'しばらく使われなかったためGPUメモリを解放しました。このタブに戻ると自動で再読み込みします（ダウンロードは不要です）。' : 'GPUメモリを解放しました。会話するには、もう一度モデルを読み込んでください。' });
  busy = false; await refreshModelUI();
}

function onModelSelect(key) { settings.model = key; save(); refreshModelUI(); }

function gpuMessage(r) {
  if (r.reason === 'no-api') return 'このブラウザはWebGPUに対応していません。最新のChrome / Edge（デスクトップ・Android）や、WebGPUが有効なSafariをお試しください。';
  if (r.reason === 'no-adapter') return 'WebGPUは利用できますが、この端末で使えるGPUが見つかりませんでした。ブラウザの設定やGPUドライバを確認してください。';
  return 'WebGPUの初期化でエラーが発生しました。';
}

function wire() {
  $('btn-send').addEventListener('click', send);
  $('btn-stop').addEventListener('click', () => chat.stop());
  $('input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return; // never send mid-IME composition
    if (matchMedia('(pointer: coarse)').matches) return; // touch keyboards: Enter = newline
    e.preventDefault(); send();
  });
  $('btn-new').addEventListener('click', () => { speech.stop(); chat.newConversation(settings.selectedNpc); render(); });
  $('btn-clear').addEventListener('click', () => { speech.stop(); chat.clear(settings.selectedNpc); render(); });
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
  const about = () => { ui.fillAbout(loadedDef || selectedDef(), { 'モデル状態': modelReady ? `Local / Offline（${loadedDef.short} 準備完了）` : '未読み込み', 'WebGPU': gpuInfo.ok ? `利用可能${gpuInfo.f16 ? '（shader-f16対応）' : '（shader-f16非対応）'}` : '利用不可', '公式URL': CONFIG.publicUrl }); $('dlg-about').showModal(); };
  $('btn-about').addEventListener('click', about); $('btn-about2').addEventListener('click', about);
  $('btn-clear-data').addEventListener('click', () => {
    if (!confirm('すべての住人との会話履歴を削除します。設定とAIモデルは残ります。よろしいですか？')) return;
    chat.clearAll(); chat.ensureGreeting(settings.selectedNpc); render(); ui.toast('会話データを削除しました。');
  });
  $('btn-reset').addEventListener('click', () => $('dlg-reset').showModal());
  $('btn-reset-ok').addEventListener('click', async () => {
    await Store.resetAppData({ includeModel: $('chk-reset-model').checked });
    location.reload();
  });
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
  ui.renderNpcCards(settings.selectedNpc, selectNpc);
  wire(); ui.setGenerating(false); ui.setChatEnabled(false);
  speech.onVoices = refreshVoices;
  selectNpc(settings.selectedNpc);
  speech.init().then(refreshVoices);
  if (!speech.supported) ui.toast('このブラウザは音声合成に対応していません（会話は可能です）。', 6000);

  const checker = new UpdateChecker({
    onUpdate: (remote, o) => ui.showUpdate(remote, o.belowMinimum),
    onError: (e) => console.warn('update check failed', e)
  });
  $('btn-update').addEventListener('click', () => checker.apply());
  registerSW(checker); checker.start();

  ui.renderModelSelect(settings.model, onModelSelect);
  const gpu = await LLM.checkWebGPU(); gpuInfo = gpu;
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
