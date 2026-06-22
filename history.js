/* ============================================================
   SidelineGAA — saved matches + season history
   Shares global scope with app.js / stats.js / shotchart.js.
   ============================================================ */

'use strict';

const LS_ARCHIVE = 'sidelinegaa.archive.v1';

function loadArchive() {
  try { return JSON.parse(localStorage.getItem(LS_ARCHIVE)) || []; } catch (e) { return []; }
}
function saveArchiveList(a) {
  try { localStorage.setItem(LS_ARCHIVE, JSON.stringify(a)); } catch (e) {}
}

/* Save the just-finished match into the season archive (once). */
function archiveCurrentMatch() {
  if (state.archivedId) return;
  const rec = JSON.parse(JSON.stringify(state));
  rec.id = 'm' + Date.now();
  rec.savedAt = Date.now();
  const a = loadArchive();
  a.push(rec);
  saveArchiveList(a);
  state.archivedId = rec.id;
}

function deleteArchived(id) {
  if (typeof confirm === 'function' && !confirm('Delete this saved match?')) return;
  saveArchiveList(loadArchive().filter(m => m.id !== id));
  showHistory();
}

function matchResultA(m) {
  const a = total(m.score.A), b = total(m.score.B);
  return a > b ? 'W' : a < b ? 'L' : 'D';
}
function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString(); } catch (e) { return ''; }
}

/* Aggregate season totals for your team (side A) across all saved matches. */
function aggregateSeason(list) {
  const agg = { played: list.length, w: 0, d: 0, l: 0, pf: 0, pa: 0, scorers: {} };
  list.forEach(m => {
    const r = matchResultA(m);
    agg[r === 'W' ? 'w' : r === 'L' ? 'l' : 'd']++;
    agg.pf += total(m.score.A);
    agg.pa += total(m.score.B);
    m.events.forEach(ev => {
      if (ev.kind === 'score' && ev.side === 'A' && ev.player != null) {
        const p = (m.squadA || []).find(x => x.n === ev.player);
        const key = p && p.name ? `#${ev.player} ${p.name}` : `#${ev.player}`;
        agg.scorers[key] = (agg.scorers[key] || 0) + (ev.scoreType === 'g' ? 3 : ev.scoreType === 'two' ? 2 : 1);
      }
    });
  });
  return agg;
}

function showHistory() {
  const list = loadArchive().slice().sort((a, b) => b.savedAt - a.savedAt);
  const season = document.getElementById('histSeason');
  const wrap = document.getElementById('histList');

  if (!list.length) {
    season.innerHTML = `<div class="empty">No saved matches yet.<br>Finish a match (⋯ → End match) and it’s saved here automatically.</div>`;
    wrap.innerHTML = '';
    showScreen('history');
    return;
  }

  const agg = aggregateSeason(list);
  const tops = Object.entries(agg.scorers).sort((a, b) => b[1] - a[1]).slice(0, 5);
  season.innerHTML = `
    <div class="season-card">
      <div class="season-h">Season so far</div>
      <div class="season-row"><span>Played</span><b>${agg.played}</b></div>
      <div class="season-row"><span>Record (W-D-L)</span><b>${agg.w}-${agg.d}-${agg.l}</b></div>
      <div class="season-row"><span>Points for / against</span><b>${agg.pf} / ${agg.pa}</b></div>
    </div>
    ${tops.length ? `<div class="season-card"><div class="season-h">Top scorers (season)</div>${
      tops.map(t => `<div class="season-row"><span>${escapeHtml(t[0])}</span><b>${t[1]} pts</b></div>`).join('')
    }</div>` : ''}`;

  wrap.innerHTML = '';
  list.forEach(m => {
    const res = matchResultA(m);
    const row = document.createElement('div');
    row.className = 'hist-item';
    row.innerHTML = `
      <div class="hi-main">
        <div class="hi-teams">${escapeHtml(m.meta.aName)} <b>${gp(m.score.A)}</b> – <b>${gp(m.score.B)}</b> ${escapeHtml(m.meta.bName)}</div>
        <div class="hi-sub">${m.meta.competition ? escapeHtml(m.meta.competition) + ' · ' : ''}${fmtDate(m.savedAt)} · ${total(m.score.A)}–${total(m.score.B)} <span class="res ${res}">${res}</span></div>
      </div>
      <button class="hi-del" aria-label="delete">✕</button>`;
    row.querySelector('.hi-main').onclick = () => viewArchivedMatch(m.id);
    row.querySelector('.hi-del').onclick = (e) => { e.stopPropagation(); deleteArchived(m.id); };
    wrap.appendChild(row);
  });
  showScreen('history');
}

/* Open a saved match read-only in the summary screen. */
function viewArchivedMatch(id) {
  const rec = loadArchive().find(m => m.id === id);
  if (!rec) return;
  state = JSON.parse(JSON.stringify(rec));
  showSummary('history');
}
