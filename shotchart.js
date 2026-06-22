/* ============================================================
   SidelineGAA — shot location capture + shot chart
   Pitch model: attacking half, goal at the TOP.
   loc = { x: 0..1 (left→right), y: 0..1 (goal-line→halfway) }
   ============================================================ */

'use strict';

function pitchMarkings() {
  return `
    <rect x="1.5" y="1.5" width="97" height="127" rx="3" fill="#2f7d4d" stroke="#cfe3d6" stroke-width="0.7"/>
    <line x1="44" y1="2.5" x2="56" y2="2.5" stroke="#ffffff" stroke-width="1.8"/>
    <rect x="42" y="2.5" width="16" height="8.5" fill="none" stroke="#cfe3d6" stroke-width="0.5"/>
    <rect x="30" y="2.5" width="40" height="15" fill="none" stroke="#cfe3d6" stroke-width="0.5"/>
    <line x1="1.5" y1="26" x2="98.5" y2="26" stroke="#cfe3d6" stroke-width="0.45" stroke-dasharray="2 2"/>
    <line x1="1.5" y1="39" x2="98.5" y2="39" stroke="#cfe3d6" stroke-width="0.45"/>
    <path d="M 8 76 Q 50 98 92 76" fill="none" stroke="#f2b705" stroke-width="0.9" stroke-dasharray="2.5 1.8"/>
    <text x="50" y="72" fill="#f2b705" font-size="4.4" text-anchor="middle" font-weight="bold">40m arc · 2-pt</text>
    <line x1="1.5" y1="100" x2="98.5" y2="100" stroke="#cfe3d6" stroke-width="0.45" stroke-dasharray="2 2"/>
  `;
}

function pickLocation(side, cb) {
  const body = document.getElementById('sheetBody');
  body.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'sh-title';
  h.textContent = 'Where was the shot? (tap the pitch)';
  body.appendChild(h);

  const wrap = document.createElement('div');
  wrap.className = 'pitch-pick';
  wrap.innerHTML = `<svg viewBox="0 0 100 130" class="pitch-svg">${pitchMarkings()}</svg>`;
  wrap.onclick = ev => {
    const r = wrap.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    cb({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  };
  body.appendChild(wrap);

  const skip = document.createElement('div');
  skip.className = 'sh-cancel';
  skip.textContent = 'Skip location';
  skip.onclick = () => cb(null);
  body.appendChild(skip);

  sheetOpen = true;
  document.getElementById('overlay').classList.add('show');
}

/* High-contrast markers so every shot reads clearly on the green pitch. */
function renderShotChart(side) {
  const shots = state.events.filter(e =>
    e.loc && e.side === side && (e.kind === 'score' || e.kind === 'wide'));

  const dots = shots.map(e => {
    const cx = (2 + e.loc.x * 96).toFixed(1);
    const cy = (3 + e.loc.y * 124).toFixed(1);
    if (e.kind === 'wide') {
      return `<circle cx="${cx}" cy="${cy}" r="2.4" fill="rgba(255,255,255,.4)"/>` +
             `<circle cx="${cx}" cy="${cy}" r="2.4" fill="none" stroke="#b23a2e" stroke-width="1.2"/>`;
    }
    if (e.scoreType === 'g') {
      return `<circle cx="${cx}" cy="${cy}" r="3.6" fill="#2563eb" stroke="#ffffff" stroke-width="1.4"/>` +
             `<circle cx="${cx}" cy="${cy}" r="1.2" fill="#ffffff"/>`;
    }
    if (e.scoreType === 'two') {
      return `<circle cx="${cx}" cy="${cy}" r="2.9" fill="#f2b705" stroke="#5e4900" stroke-width="0.8"/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="2.6" fill="#1b7a3d" stroke="#ffffff" stroke-width="1.2"/>`;
  }).join('');

  const empty = shots.length === 0
    ? `<text x="50" y="64" fill="#dceee2" font-size="5" text-anchor="middle">No located shots</text>`
    : '';

  return `<svg viewBox="0 0 100 130" class="pitch-svg">${pitchMarkings()}${dots}${empty}</svg>`;
}

/* ============================================================
   Full-pitch picker + turnover map (turnovers happen anywhere)
   ============================================================ */
function fullPitchMarkings() {
  return `
    <rect x="1.5" y="1.5" width="97" height="157" rx="3" fill="#2f7d4d" stroke="#cfe3d6" stroke-width="0.7"/>
    <line x1="1.5" y1="80" x2="98.5" y2="80" stroke="#cfe3d6" stroke-width="0.6"/>
    <circle cx="50" cy="80" r="7" fill="none" stroke="#cfe3d6" stroke-width="0.5"/>
    <line x1="44" y1="2.4" x2="56" y2="2.4" stroke="#ffffff" stroke-width="1.6"/>
    <rect x="30" y="2.4" width="40" height="12" fill="none" stroke="#cfe3d6" stroke-width="0.5"/>
    <path d="M 12 48 Q 50 64 88 48" fill="none" stroke="#f2b705" stroke-width="0.7" stroke-dasharray="2 1.5"/>
    <text x="50" y="20" fill="#dceee2" font-size="3.8" text-anchor="middle">attacking</text>
    <line x1="44" y1="157.6" x2="56" y2="157.6" stroke="#ffffff" stroke-width="1.6"/>
    <rect x="30" y="145.6" width="40" height="12" fill="none" stroke="#cfe3d6" stroke-width="0.5"/>
    <path d="M 12 112 Q 50 96 88 112" fill="none" stroke="#cfe3d6" stroke-width="0.6" stroke-dasharray="2 1.5"/>
  `;
}

function pickLocationFull(side, cb) {
  const body = document.getElementById('sheetBody');
  body.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'sh-title';
  h.textContent = 'Where on the pitch? (tap)';
  body.appendChild(h);

  const wrap = document.createElement('div');
  wrap.className = 'pitch-pick';
  wrap.innerHTML = `<svg viewBox="0 0 100 160" class="pitch-svg">${fullPitchMarkings()}</svg>`;
  wrap.onclick = ev => {
    const r = wrap.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    cb({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  };
  body.appendChild(wrap);

  const note = document.createElement('div');
  note.className = 'sh-note';
  note.textContent = 'Top is the goal you are attacking.';
  body.appendChild(note);

  const skip = document.createElement('div');
  skip.className = 'sh-cancel';
  skip.textContent = 'Skip location';
  skip.onclick = () => cb(null);
  body.appendChild(skip);

  sheetOpen = true;
  document.getElementById('overlay').classList.add('show');
}

/* Turnover map for one side: green = won, red = conceded. */
function renderTurnoverMap(side) {
  const evs = state.events.filter(e => e.kind === 'turnover' && e.loc);
  const dots = evs.map(e => {
    const cx = (2 + e.loc.x * 96).toFixed(1);
    const cy = (2 + e.loc.y * 156).toFixed(1);
    const won = e.side === other(side);   // side regained the ball
    const col = won ? '#1b7a3d' : '#b23a2e';
    return `<circle cx="${cx}" cy="${cy}" r="2.2" fill="${col}" stroke="#ffffff" stroke-width="0.9"/>`;
  }).join('');
  const empty = evs.length ? '' : `<text x="50" y="80" fill="#dceee2" font-size="5" text-anchor="middle">No located turnovers</text>`;
  return `<svg viewBox="0 0 100 160" class="pitch-svg">${fullPitchMarkings()}${dots}${empty}</svg>`;
}
