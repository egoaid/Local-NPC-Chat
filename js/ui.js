import { NPCS, getNpc } from './npcs.js';
import { CONFIG, APP } from './config.js';

export const $ = (id) => document.getElementById(id);
let toastTimer;

export function toast(msg, ms = 4000) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function setBadge(id, cls, text) { const b = $(id); b.className = `badge badge-${cls}`; b.textContent = text; }

export function renderNpcCards(selectedId, onSelect) {
  const box = $('npc-cards'); box.textContent = '';
  for (const n of NPCS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'npc-card'; b.dataset.id = n.id;
    b.setAttribute('aria-pressed', String(n.id === selectedId));
    b.innerHTML = '<span class="n"></span><span class="o"></span><span class="d"></span>';
    b.querySelector('.n').textContent = n.name;
    b.querySelector('.o').textContent = `${n.age}歳・${n.occupation}`;
    b.querySelector('.d').textContent = n.summary;
    b.addEventListener('click', () => onSelect(n.id));
    box.appendChild(b);
  }
}
export function markSelected(id) { document.querySelectorAll('.npc-card').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id))); }
export function lockNpcCards(lock) { document.querySelectorAll('.npc-card').forEach((b) => { b.disabled = lock; }); }

export function setChatHeader(npc) { $('chat-npc-name').textContent = npc.name; $('chat-npc-meta').textContent = `${npc.age}歳・${npc.occupation}`; }

function bubble(msg, npc, { typing = false, onReplay } = {}) {
  const el = document.createElement('div');
  el.className = `msg ${msg.role === 'user' ? 'me' : 'npc'}${typing ? ' typing' : ''}`;
  const who = document.createElement('span'); who.className = 'who'; who.textContent = msg.role === 'user' ? 'あなた' : npc.name;
  const b = document.createElement('div'); b.className = 'bubble'; b.textContent = msg.content;
  el.append(who, b);
  if (msg.role !== 'user' && !typing && msg.content && onReplay) {
    const r = document.createElement('button'); r.type = 'button'; r.className = 'secondary replay'; r.textContent = '🔊 聞く';
    r.setAttribute('aria-label', `${npc.name}の発言を読み上げる`); r.addEventListener('click', () => onReplay(msg.content));
    el.appendChild(r);
  }
  return el;
}
export function renderMessages(npcId, list, { generating = false, onReplay } = {}) {
  const npc = getNpc(npcId); const box = $('messages'); box.textContent = '';
  list.forEach((m, i) => box.appendChild(bubble(m, npc, { typing: generating && i === list.length - 1 && m.role === 'assistant', onReplay })));
  box.scrollTop = box.scrollHeight;
}
export function streamUpdate(text) {
  const last = $('messages').lastElementChild?.querySelector('.bubble');
  if (last) { last.textContent = text || '…'; $('messages').scrollTop = $('messages').scrollHeight; }
}

export function setGenerating(on) {
  $('btn-send').disabled = on; $('btn-stop').hidden = !on; $('input').disabled = on;
  lockNpcCards(on); $('btn-new').disabled = on; $('btn-clear').disabled = on;
}
export function setChatEnabled(ok) { $('btn-send').disabled = !ok; }

export function showModelPanel({ msg, pct = null, showLoad = false, loadLabel, error = null, hide = false }) {
  $('panel-model').hidden = hide;
  $('model-msg').textContent = msg || '';
  const p = $('model-progress'); p.hidden = pct === null; if (pct !== null) p.value = pct;
  const b = $('btn-load'); b.hidden = !showLoad; if (loadLabel) b.textContent = loadLabel;
  const d = $('err-details'); d.hidden = !error; $('err-pre').textContent = error || '';
}

export function showUpdate(remote, belowMinimum) {
  $('update-text').textContent = `新しいバージョン v${remote.version} があります（現在 v${APP.version}）。${belowMinimum ? 'この版は古くなっています。' : ''}更新しますか？`;
  $('update-banner').hidden = false;
}
export const hideUpdate = () => { $('update-banner').hidden = true; };

export function fillAbout(extra = {}) {
  const rows = [
    ['アプリ', APP.appName], ['バージョン', APP.version], ['リリース日', APP.releaseDate || ''],
    ['モデル', `${CONFIG.model.id} (${CONFIG.model.dtype}, WebGPU)`], ['モデルのライセンス', `${CONFIG.model.license} — ${CONFIG.model.sourceUrl}`],
    ['著作権', `${APP.copyright} ${APP.rights}`],
    ['サードパーティ', 'Transformers.js (Apache-2.0), ONNX Runtime Web (MIT), LiquidAI LFM2.5-350M-ONNX (LFM Open License v1.0)。詳細はREADME参照。'],
    ...Object.entries(extra)
  ];
  const dl = $('about-list'); dl.textContent = '';
  for (const [k, v] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); }
}

export function fillVoiceSelects(voices, current, onChange) {
  for (const lang of ['ja', 'en']) {
    const sel = $(`sel-${lang}`); sel.textContent = '';
    const auto = new Option('自動（おすすめ）', 'auto'); sel.add(auto);
    voices.filter((v) => (v.lang || '').toLowerCase().startsWith(lang)).forEach((v) => sel.add(new Option(`${v.name} (${v.lang})`, v.name)));
    sel.value = [...sel.options].some((o) => o.value === current?.[lang]) ? current[lang] : 'auto';
    sel.onchange = () => onChange(lang, sel.value);
  }
}
