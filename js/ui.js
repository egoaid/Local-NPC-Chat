import { cardLine, cardSummary } from './characters.js';
import { MODELS, APP } from './config.js';

export const $ = (id) => document.getElementById(id);
let toastTimer;

export function toast(msg, ms = 4000) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function setBadge(id, cls, text) { const b = $(id); b.className = `badge badge-${cls}`; b.textContent = text; }

export function renderNpcCards(list, selectedId, onSelect, onEdit, unread = new Set()) {
  const box = $('npc-cards'); box.textContent = '';
  for (const n of list) {
    const wrap = document.createElement('div'); wrap.className = 'npc-item';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'npc-card'; b.dataset.id = n.id;
    b.setAttribute('aria-pressed', String(n.id === selectedId));
    b.innerHTML = '<span class="n"></span><span class="o"></span><span class="d"></span>';
    b.querySelector('.n').textContent = n.name;
    if (unread.has(n.id)) { const d = document.createElement('span'); d.className = 'new-dot'; d.textContent = ' 💬新着'; d.setAttribute('aria-label', '新しいメッセージ'); b.querySelector('.n').appendChild(d); }
    b.querySelector('.o').textContent = cardLine(n);
    b.querySelector('.d').textContent = cardSummary(n);
    b.addEventListener('click', () => onSelect(n.id));
    const e = document.createElement('button');
    e.type = 'button'; e.className = 'secondary npc-edit'; e.textContent = '編集'; e.dataset.id = n.id;
    e.setAttribute('aria-label', `${n.name}を編集`); e.addEventListener('click', () => onEdit(n.id));
    wrap.append(b, e); box.appendChild(wrap);
  }
}
export function markSelected(id) { document.querySelectorAll('.npc-card').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id))); }
export function lockNpcCards(lock) { document.querySelectorAll('.npc-card, .npc-edit').forEach((b) => { b.disabled = lock; }); }

export function setChatHeader(npc) { $('chat-npc-name').textContent = npc ? npc.name : ''; $('chat-npc-meta').textContent = npc ? cardLine(npc) : ''; }
/** Empty state: no characters yet -> hide the chat, show guidance. */
export function showEmptyState(empty) { $('empty-state').hidden = !empty; $('chat-body').hidden = empty; }

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
export function renderMessages(npc, list, { generating = false, onReplay } = {}) {
  const box = $('messages'); box.textContent = '';
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
  ['sel-model', 'btn-load', 'btn-unload', 'btn-delete-model'].forEach((id) => { $(id).disabled = on || $(id).disabled; });
}
export function setChatEnabled(ok) { $('btn-send').disabled = !ok; $('model-hint').hidden = ok; }

/** Diagnostics panel. runs: [{ttft,total,promptTokens,newTokens,tps,chars}] (newest last) */
export function renderDiagnostics(info, runs) {
  const lines = [];
  const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
  for (const [k, v] of Object.entries(info)) lines.push(`${k}: ${v}`);
  const last = runs[runs.length - 1];
  if (last) {
    lines.push('', `直近の返事: 開始まで ${fmt(last.ttft / 1000)}秒 / 全体 ${fmt(last.total / 1000)}秒 / 入力 ${last.promptTokens ?? '—'}トークン / 出力 ${last.newTokens ?? '—'}トークン / ${fmt(last.tps)} トークン/秒`);
    const avg = (f) => { const v = runs.map(f).filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    lines.push(`平均（直近${runs.length}回）: 開始まで ${fmt(avg((r) => r.ttft) / 1000)}秒 / ${fmt(avg((r) => r.tps))} トークン/秒`);
  } else lines.push('', 'まだ返事を生成していません。');
  $('diag-pre').textContent = lines.join('\n');
}

export function showModelPanel({ msg, pct = null, error = null }) {
  $('model-msg').textContent = msg || '';
  const p = $('model-progress'); p.hidden = pct === null; if (pct !== null) p.value = pct;
  const d = $('err-details'); d.hidden = !error; $('err-pre').textContent = error || '';
}
export function renderModelSelect(selectedKey, onChange) {
  const sel = $('sel-model'); sel.textContent = '';
  MODELS.forEach((m) => sel.add(new Option(`${m.label}・約${m.approxMB}MB`, m.key)));
  sel.value = selectedKey; sel.onchange = () => onChange(sel.value);
}
/** v: {info, loadLabel, showLoad, loadDisabled, showUnload, showDelete, locked} */
export function setModelControls(v) {
  $('model-info').textContent = v.info || '';
  const l = $('btn-load'); l.hidden = !v.showLoad; l.textContent = v.loadLabel || 'モデルを読み込む'; l.disabled = v.locked || v.loadDisabled;
  const u = $('btn-unload'); u.hidden = !v.showUnload; u.disabled = v.locked;
  const d = $('btn-delete-model'); d.hidden = !v.showDelete; d.disabled = v.locked;
  $('sel-model').disabled = v.locked;
}

export function showUpdate(remote, belowMinimum) {
  $('update-text').textContent = `新しいバージョン v${remote.version} があります（現在 v${APP.version}）。${belowMinimum ? 'この版は古くなっています。' : ''}更新しますか？`;
  $('update-banner').hidden = false;
}
export const hideUpdate = () => { $('update-banner').hidden = true; };

export function fillAbout(def, extra = {}) {
  const rows = [
    ['アプリ', APP.appName], ['バージョン', APP.version], ['リリース日', APP.releaseDate || ''],
    ['使用モデル', `${def.id} (${def.dtype}, WebGPU)`], ['モデルのライセンス', `${def.license} — ${def.sourceUrl}`],
    ['著作権', `${APP.copyright} ${APP.rights}`],
    ['サードパーティ', 'Transformers.js (Apache-2.0), ONNX Runtime Web (MIT), LiquidAI LFM2.5 ONNX models (LFM Open License v1.0)。詳細はREADME参照。'],
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
