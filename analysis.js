/* ============================================================
   SidelineGAA — Analysis screen
   Read-only cards that surface the analytics.js metrics.
   ============================================================ */

'use strict';

/* ── helpers (mirror detail.js style) ────────────────────────────────────── */

function _arow(label, a, b) {
  return `<div class="stat-row"><span class="va">${a}</span><span class="lbl">${label}</span><span class="vb">${b}</span></div>`;
}
function _acard(title, inner) {
  return `<div class="d-card"><div class="d-h">${title}</div>${inner}</div>`;
}
function _ahead(nameA, nameB) {
  return `<div class="d-cols"><span>${nameA}</span><span></span><span>${nameB}</span></div>`;
}

/* ── WP-C2: SVG charts ────────────────────────────────────────────────────── */

/* Score differential polyline SVG. Returns an <svg> string.
   Zero line in the middle; your team positive = upward. */
function renderScoreTimeline() {
  const tl  = scoreTimeline();
  const W   = 320, H = 120, PAD = 14;
  const iW  = W - PAD * 2, iH = H - PAD * 2;
  const ns  = 'xmlns="http://www.w3.org/2000/svg"';

  if (!tl.length) {
    return `<svg viewBox="0 0 ${W} ${H}" ${ns}><text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" font-size="11" fill="#999">No scores yet</text></svg>`;
  }

  const maxClock = Math.max(1, ...state.events.filter(e => e.clock != null).map(e => e.clock));
  const absMax   = Math.max(1, ...tl.map(p => Math.abs(p.diff)));

  const px = (c) => (PAD + (c / maxClock) * iW).toFixed(1);
  const py = (d) => (PAD + ((absMax - d) / (2 * absMax)) * iH).toFixed(1);

  const zy     = py(0);
  const points = tl.map(p => `${px(p.clock)},${py(p.diff)}`).join(' ');
  const last   = tl[tl.length - 1].diff;
  const colour = last >= 0 ? '#1b7a3d' : '#b23a2e';

  return `<svg viewBox="0 0 ${W} ${H}" ${ns} style="width:100%;height:auto;display:block">
  <line x1="${PAD}" y1="${zy}" x2="${W - PAD}" y2="${zy}" stroke="#ddd" stroke-width="1.5"/>
  <polyline points="${points}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="${PAD}" y="${PAD - 2}" font-size="9" fill="#1b7a3d" font-weight="700">▲ Ahead</text>
  <text x="${PAD}" y="${H - 2}" font-size="9" fill="#b23a2e" font-weight="700">▼ Behind</text>
</svg>`;
}

/* Horizontal bars showing each team's longest scoring run. */
function renderRunsBar() {
  const { longestA, longestB } = scoringRuns();
  const W = 320, H = 60, PAD = 14, barH = 16, gap = 8;
  const ns     = 'xmlns="http://www.w3.org/2000/svg"';
  const maxRun = Math.max(1, longestA.count, longestB.count);
  const aW     = Math.round((longestA.count / maxRun) * (W - PAD * 2 - 70));
  const bW     = Math.round((longestB.count / maxRun) * (W - PAD * 2 - 70));

  return `<svg viewBox="0 0 ${W} ${H}" ${ns} style="width:100%;height:auto;display:block">
  <rect x="${PAD}" y="${PAD}" width="${Math.max(aW, 2)}" height="${barH}" fill="#1b7a3d" rx="3"/>
  <text x="${PAD + Math.max(aW, 2) + 5}" y="${PAD + barH - 3}" font-size="11" fill="#333">${longestA.count} in a row</text>
  <rect x="${PAD}" y="${PAD + barH + gap}" width="${Math.max(bW, 2)}" height="${barH}" fill="#b23a2e" rx="3"/>
  <text x="${PAD + Math.max(bW, 2) + 5}" y="${PAD + barH + gap + barH - 3}" font-size="11" fill="#333">${longestB.count} in a row</text>
</svg>`;
}

/* ── card builders ────────────────────────────────────────────────────────── */

function _aTransitionCard(nameA, nameB) {
  const tA = transitionStats('A'), tB = transitionStats('B');
  return _acard('Transition', _ahead(nameA, nameB) +
    _arow('TO→score',         tA.toScores,         tB.toScores) +
    _arow('TO→pts',           tA.toPts,            tB.toPts) +
    _arow('Rate (% of TOs)',  tA.toRate + '%',     tB.toRate + '%') +
    _arow('Vuln rate',        tA.vulnRate + '%',   tB.vulnRate + '%') +
    _arow('Trans speed (s)',  tA.transSpeed,       tB.transSpeed));
}

function _aKickoutCard(nameA, nameB) {
  const kA = kickoutAnalytics('A'), kB = kickoutAnalytics('B');
  return _acard('Kickout efficiency', _ahead(nameA, nameB) +
    _arow('Own KO retention',    kA.retention + '%',        kB.retention + '%') +
    _arow('Press win rate',      kA.pressWin + '%',         kB.pressWin + '%') +
    _arow('KO won → score',      kA.koWonToScore + '%',     kB.koWonToScore + '%') +
    _arow('KO lost → opp score', kA.koLostToOppScore + '%', kB.koLostToOppScore + '%'));
}

function _aPossCard(nameA, nameB) {
  const pA = possessionProductivity('A'), pB = possessionProductivity('B');
  return _acard('Possession productivity', _ahead(nameA, nameB) +
    _arow('Possessions',      pA.poss,  pB.poss) +
    _arow('Scores per 10',    pA.per10, pB.per10));
}

function _aDisciplineCard(nameA, nameB) {
  const fA = foulCost('A'), fB = foulCost('B');
  return _acard('Discipline cost', _ahead(nameA, nameB) +
    _arow('Frees conceded→score', fA.frees, fB.frees) +
    _arow('Pts conceded',         fA.pts,   fB.pts));
}

function _aMomentumCard(nameA, nameB) {
  const { longestA, longestB } = scoringRuns();
  const dr = droughts();
  return _acard('Momentum', _ahead(nameA, nameB) +
    _arow('Longest run',       longestA.count, longestB.count) +
    _arow('Run pts',           longestA.pts,   longestB.pts) +
    _arow('Longest drought (s)', dr.A,         dr.B) +
    '<div style="margin:10px 0 4px">' + renderScoreTimeline() + '</div>' +
    renderRunsBar());
}

function _aPlayerCard(nameA) {
  const pm   = playerStats('A');
  const rows = Object.entries(pm).sort(([, a], [, b]) => b.pts - a.pts || b.shots - a.shots);
  if (!rows.length) return '';

  const COL  = '1.8fr .65fr .65fr .75fr .65fr .65fr .9fr';
  const head = `<div class="pt-row pt-head" style="grid-template-columns:${COL}"><span>Player</span><span>Pts</span><span>Sh</span><span>Cv%</span><span>TO</span><span>Fc</span><span>Min</span></div>`;
  const body = rows.map(([n, p]) => {
    const nm = playerName('A', Number(n)) ? `#${n} ${escapeHtml(playerName('A', Number(n)))}` : `#${n}`;
    return `<div class="pt-row" style="grid-template-columns:${COL}">` +
      `<span>${nm}</span><span>${p.pts}</span><span>${p.shots}</span>` +
      `<span>${p.conv}%</span><span>${p.toLost}</span><span>${p.foulsCommitted}</span>` +
      `<span>${p.minutes}</span></div>`;
  }).join('');

  return _acard(`Per player — ${nameA}`, `<div class="ptbl">${head}${body}</div>`);
}

/* ── main entry point ─────────────────────────────────────────────────────── */

function showAnalysis() {
  const body = $('analysisBody');
  if (!state || !state.events || !state.events.length) {
    body.innerHTML = '<p style="text-align:center;color:var(--muted);padding:24px">No match data yet.</p>';
    showScreen('analysis');
    return;
  }

  const nameA = escapeHtml(state.meta.aName);
  const nameB = escapeHtml(state.meta.bName);

  body.innerHTML = [
    _aTransitionCard(nameA, nameB),
    _aKickoutCard(nameA, nameB),
    _aPossCard(nameA, nameB),
    _aDisciplineCard(nameA, nameB),
    _aMomentumCard(nameA, nameB),
    _aPlayerCard(nameA),
  ].join('');

  showScreen('analysis');
}
