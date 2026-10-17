import { CONFIG, MODEL_KEY, APP } from './config.js';
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
const speech = new Speech();
speech.on = settings.speechOn; speech.rate = settings.rate;
let webgpuOk = false, modelReady = false, loading = false;
const save = () => Store.saveSettings(settings);
const npcNow = () => getNpc(settings.selectedNpc);

const chat = new Chat({
  onStream: (id, text) => { if (id === settings.selectedNpc) ui.streamUpdate(text); },
  onDone: (id) => { ui.setGenerating(false); if (id === settings.selectedNpc) render(); },
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
  ui.setGenerating(false); input.focus();
  if (reply && id === settings.selectedNpc) say(reply);
}

function classify(e) {
  const m = String(e?.message || e);
  if (/out of memory|insufficient|memory|allocation|OOM/i.test(m)) return 'メモリが足りない可能性があります。他のタブやアプリを閉じてから再試行してください。';
  if (/fetch|network|Failed to|load failed|offline|NetworkError/i.test(m)) return 'モデルのダウンロードに失敗しました。通信状況を確認して、もう一度お試しください（途中までの分は引き継がれる場合があります）。';
  return 'モデルの初期化に失敗しました。お使いのブラウザ/端末がWebGPUでの実行に対応していない可能性があります。';
}

async function loadModel() {
  if (loading || modelReady) return;
  if (!webgpuOk) return;
  loading = true;
  ui.setBadge('badge-model', 'busy', 'モデル: ダウンロード/読み込み中');
  ui.showModelPanel({ msg: `AIモデルを準備しています（初回は約${CONFIG.model.approxDownloadMB}MBのダウンロード。2回目以降は端末に保存された分を使います）。`, pct: 0 });
  try {
    await LLM.loadModel((p) => {
      if (p.phase === 'downloading') {
        const mb = (n) => (n / 1048576).toFixed(0);
        ui.setBadge('badge-model', 'busy', `モデル: ダウンロード中 ${p.pct.toFixed(0)}%`);
        ui.showModelPanel({ msg: p.total ? `ダウンロード中… ${mb(p.loaded)} / ${mb(p.total)} MB` : 'ダウンロードを開始しています…', pct: p.pct });
      } else {
        ui.setBadge('badge-model', 'busy', 'モデル: 初期化中');
        ui.showModelPanel({ msg: 'モデルをGPUに読み込んでいます…', pct: 100 });
      }
    });
    modelReady = true; settings.modelLoaded = true; settings.modelKey = MODEL_KEY; save();
    ui.setBadge('badge-model', 'ready', 'Local / Offline ✓ 準備完了');
    ui.showModelPanel({ hide: true });
    ui.setChatEnabled(true);
    ui.toast('準備ができました。会話はこの端末の中だけで処理されます。');
  } catch (e) {
    console.error(e);
    ui.setBadge('badge-model', 'error', 'モデル: エラー');
    ui.showModelPanel({ msg: classify(e), showLoad: true, loadLabel: 'もう一度試す', error: `${e?.name || 'Error'}: ${e?.message || e}\n${e?.stack || ''}`.slice(0, 2000) });
  } finally { loading = false; }
}

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
  $('btn-load').addEventListener('click', loadModel);
  $('chk-speech').checked = settings.speechOn;
  $('chk-speech').addEventListener('change', (e) => {
    speech.on = settings.speechOn = e.target.checked; save();
    if (!speech.on) speech.stop(); else if (!speech.supported) ui.toast('このブラウザは音声合成に対応していません。');
  });
  const rate = $('rng-rate'); rate.min = CONFIG.speech.minRate; rate.max = CONFIG.speech.maxRate; rate.value = settings.rate; $('out-rate').textContent = Number(settings.rate).toFixed(1);
  rate.addEventListener('input', () => { speech.rate = settings.rate = Number(rate.value); $('out-rate').textContent = speech.rate.toFixed(1); save(); });
  const about = () => { ui.fillAbout({ 'モデル状態': modelReady ? 'Local / Offline（準備完了）' : '未読み込み', 'WebGPU': webgpuOk ? '利用可能' : '利用不可' }); $('dlg-about').showModal(); };
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

  const gpu = await LLM.checkWebGPU(); webgpuOk = gpu.ok;
  ui.setBadge('badge-gpu', gpu.ok ? 'ready' : 'error', gpu.ok ? `WebGPU: 利用可能${gpu.info ? ` (${gpu.info})` : ''}` : 'WebGPU: 利用不可');
  if (!gpu.ok) {
    ui.setBadge('badge-model', 'error', 'モデル: 実行不可');
    ui.showModelPanel({ msg: gpuMessage(gpu), error: gpu.detail || `WebGPU check failed: ${gpu.reason}` });
    return;
  }
  const changed = settings.modelLoaded && settings.modelKey && settings.modelKey !== MODEL_KEY;
  if (settings.modelLoaded && !changed) { loadModel(); return; } // cached: no consent prompt needed
  ui.showModelPanel({
    msg: changed ? '新しいAIモデルが必要です。再度ダウンロードが必要になる場合があります。' : `初回のみ、AIモデル（約${CONFIG.model.approxDownloadMB}MB）をダウンロードして端末に保存します。Wi‑Fi接続をおすすめします。会話内容は外部に送信されません。`,
    showLoad: true, loadLabel: `モデルをダウンロードして開始（約${CONFIG.model.approxDownloadMB}MB）`
  });
}
init();
