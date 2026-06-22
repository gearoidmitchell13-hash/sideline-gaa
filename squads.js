/* ============================================================
   SidelineGAA — multi-squad management
   Save full player panels per club (Junior A, Junior C, …),
   manage them, and pick one + a starting 15 on match day.
   Shares global scope with app.js.
   ============================================================ */

'use strict';

const LS_SQUADS = 'sidelinegaa.squads.v1';

function seedSquads() {
  const players = SAMPLE_NAMES.map((nm, i) => ({ n: i + 1, name: nm, pos: '' }))
    .concat([16, 17, 18, 19, 20, 21, 22, 23, 24].map(n => ({ n, name: '', pos: 'Sub' })));
  return [{ id: 'sq_sample', name: 'Naomh Pádraig', players }];
}
function loadSquads() {
  try { const a = JSON.parse(localStorage.getItem(LS_SQUADS)); if (a && a.length) return a; } catch (e) {}
  const s = seedSquads(); saveSquads(s); return s;
}
function saveSquads(a) { try { localStorage.setItem(LS_SQUADS, JSON.stringify(a)); } catch (e) {} }
function getSquad(id) { return loadSquads().find(s => s.id === id); }
function newSquadId() { return 'sq_' + Date.now(); }

/* ---------- management screen ---------- */
function showSquads() {
  const sqs = loadSquads();
  const body = document.getElementById('squadsBody');
  body.innerHTML =
    `<button class="primary" id="newSquadBtn">＋ New squad</button>` +
    `<div class="hint" style="margin:10px 2px">Save a panel per team (e.g. Junior A, Junior C). Reuse it any match.</div>` +
    sqs.map(s => `<div class="squad-row">
        <div class="sq-main" data-edit="${s.id}"><div class="sq-name">${escapeHtml(s.name)}</div><div class="sq-sub">${s.players.length} players</div></div>
        <button class="sq-del" data-del="${s.id}" aria-label="delete">✕</button>
      </div>`).join('');
  body.querySelector('#newSquadBtn').onclick = () => editSquad(null);
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSquad(b.dataset.edit));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (typeof confirm === 'function' && !confirm('Delete this squad?')) return;
    saveSquads(loadSquads().filter(x => x.id !== b.dataset.del)); showSquads();
  });
  showScreen('squads');
}

let _edit = null;
function editSquad(id) {
  _edit = id ? JSON.parse(JSON.stringify(getSquad(id))) : { id: newSquadId(), name: '', players: [{ n: 1, name: '', pos: '' }] };
  const body = document.getElementById('squadsBody');
  body.innerHTML = `
    <div class="field"><label>Squad name</label><input id="sqNameInput" value="${escapeHtml(_edit.name)}" placeholder="e.g. Naomh Pádraig Junior A" maxlength="30"></div>
    <h2 class="hist-h">Player panel <span class="muted-count" id="panelCount"></span></h2>
    <div id="panelRows"></div>
    <button class="ghost" id="addPlayerBtn">＋ Add player</button>
    <button class="primary" id="saveSquadBtn">Save squad</button>
    <button class="ghost" id="cancelSquadBtn">Cancel</button>`;
  body.querySelector('#sqNameInput').oninput = e => { _edit.name = e.target.value; };
  body.querySelector('#addPlayerBtn').onclick = () => {
    const nextN = (_edit.players.reduce((m, p) => Math.max(m, p.n), 0) || 0) + 1;
    _edit.players.push({ n: nextN, name: '', pos: '' }); renderPanelRows();
  };
  body.querySelector('#saveSquadBtn').onclick = saveEditSquad;
  body.querySelector('#cancelSquadBtn').onclick = () => showSquads();
  renderPanelRows();
}
function renderPanelRows() {
  const wrap = document.getElementById('panelRows'); wrap.innerHTML = '';
  _edit.players.sort((a, b) => a.n - b.n).forEach(p => {
    const row = document.createElement('div'); row.className = 'panel-row';
    row.innerHTML =
      `<input class="pr-num" type="number" inputmode="numeric" value="${p.n}" min="1" max="40">` +
      `<input class="pr-name" value="${escapeHtml(p.name)}" placeholder="Name" maxlength="18">` +
      `<input class="pr-pos" value="${escapeHtml(p.pos || '')}" placeholder="Pos" maxlength="4">` +
      `<button class="pr-del" aria-label="remove">✕</button>`;
    row.querySelector('.pr-num').onchange = e => { p.n = Number(e.target.value) || p.n; };
    row.querySelector('.pr-name').oninput = e => { p.name = e.target.value; };
    row.querySelector('.pr-pos').oninput = e => { p.pos = e.target.value; };
    row.querySelector('.pr-del').onclick = () => { _edit.players = _edit.players.filter(x => x !== p); renderPanelRows(); };
    wrap.appendChild(row);
  });
  const c = document.getElementById('panelCount'); if (c) c.textContent = `${_edit.players.length} players`;
}
function saveEditSquad() {
  _edit.name = (_edit.name || '').trim() || 'Unnamed squad';
  const sqs = loadSquads();
  const idx = sqs.findIndex(s => s.id === _edit.id);
  if (idx >= 0) sqs[idx] = _edit; else sqs.push(_edit);
  saveSquads(sqs); showSquads();
}

/* ---------- match-setup squad picker + starting 15 ---------- */
let _setupSquadId = null;
let _starters = new Set();

function renderSquadPicker() {
  const sqs = loadSquads();
  const sel = document.getElementById('squadSel'); if (!sel) return;
  if (!_setupSquadId || !sqs.find(s => s.id === _setupSquadId)) _setupSquadId = sqs[0] && sqs[0].id;
  sel.innerHTML = sqs.map(s => `<option value="${s.id}"${s.id === _setupSquadId ? ' selected' : ''}>${escapeHtml(s.name)} (${s.players.length})</option>`).join('');
  sel.onchange = () => { _setupSquadId = sel.value; resetStarters(); renderStartersSel(); };
  resetStarters();
  renderStartersSel();
}
function resetStarters() {
  const sq = getSquad(_setupSquadId);
  _starters = new Set((sq ? sq.players : []).slice(0, 15).map(p => p.n));
}
function renderStartersSel() {
  const sq = getSquad(_setupSquadId);
  const wrap = document.getElementById('startersSel'); if (!wrap) return;
  if (!sq) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = sq.players.slice().sort((a, b) => a.n - b.n).map(p => {
    const on = _starters.has(p.n);
    return `<button class="starter ${on ? 'on' : ''}" data-n="${p.n}">${p.n}${p.name ? ' ' + escapeHtml(p.name) : ''}</button>`;
  }).join('');
  wrap.querySelectorAll('.starter').forEach(b => b.onclick = () => {
    const n = Number(b.dataset.n);
    if (_starters.has(n)) _starters.delete(n);
    else if (_starters.size < 15) _starters.add(n);
    renderStartersSel();
  });
  const c = document.getElementById('starterCount'); if (c) c.textContent = `${_starters.size}/15`;
}
function getMatchSquad() {
  const sq = getSquad(_setupSquadId) || { name: 'Your team', players: [] };
  let onField = [..._starters];
  if (!onField.length) onField = sq.players.slice(0, 15).map(p => p.n);
  return { name: sq.name, panel: sq.players.map(p => ({ n: p.n, name: p.name, pos: p.pos || '' })), onField };
}
