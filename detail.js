/* ============================================================
   SidelineGAA — detailed stats screen
   Scoring breakdown, kickout breakdown, per-player table,
   shot conversion by zone. Shares global scope with app.js etc.
   ============================================================ */

'use strict';

function _scoreBreakdown(side) {
  const b = { play: { n: 0, p: 0 }, free: { n: 0, p: 0 }, dead: { n: 0, p: 0 }, pt: 0, two: 0, goal: 0 };
  state.events.forEach(ev => {
    if (ev.kind !== 'score' || ev.side !== side) return;
    const val = ev.scoreType === 'g' ? 3 : ev.scoreType === 'two' ? 2 : 1;
    if (ev.source === 'play') { b.play.n++; b.play.p += val; }
    else if (ev.source === 'free') { b.free.n++; b.free.p += val; }
    else { b.dead.n++; b.dead.p += val; }            // 45 / mark / sideline / penalty
    if (ev.scoreType === 'g') b.goal++; else if (ev.scoreType === 'two') b.two++; else b.pt++;
  });
  return b;
}

function _koBreakdown(side) {
  const o = { total: 0, wc: 0, wb: 0, lc: 0, lb: 0, oop: 0 };
  const map = { wonClean: 'wc', wonBreak: 'wb', lostClean: 'lc', lostBreak: 'lb', outOfPlay: 'oop' };
  state.events.forEach(ev => {
    if (ev.kind !== 'kickout' || ev.by !== side) return;
    o.total++; o[map[ev.outcome]]++;
  });
  o.won = o.wc + o.wb;
  o.pct = o.total ? Math.round(o.won / o.total * 100) : 0;
  return o;
}

function _playerRows(side) {
  const map = {};
  const g = n => map[n] || (map[n] = { n, pts: 0, scores: 0, shots: 0, wides: 0, to: 0 });
  state.events.forEach(ev => {
    if (ev.side !== side || ev.player == null) return;
    if (ev.kind === 'score') { const r = g(ev.player); r.pts += ev.scoreType === 'g' ? 3 : ev.scoreType === 'two' ? 2 : 1; r.scores++; r.shots++; }
    else if (ev.kind === 'wide') { const r = g(ev.player); r.shots++; r.wides++; }
    else if (ev.kind === 'turnover') { const r = g(ev.player); r.to++; }
  });
  return Object.values(map).sort((a, b) => b.pts - a.pts || b.shots - a.shots);
}

function _zones(side) {
  const z = { in20: { s: 0, sc: 0 }, mid: { s: 0, sc: 0 }, far: { s: 0, sc: 0 } };
  state.events.forEach(ev => {
    if (ev.side !== side || !ev.loc || (ev.kind !== 'score' && ev.kind !== 'wide')) return;
    const k = ev.loc.y < 0.31 ? 'in20' : ev.loc.y < 0.62 ? 'mid' : 'far';
    z[k].s++; if (ev.kind === 'score') z[k].sc++;
  });
  return z;
}

function _drow(label, a, b) {
  return `<div class="stat-row"><span class="va">${a}</span><span class="lbl">${label}</span><span class="vb">${b}</span></div>`;
}
function _dcard(title, inner) {
  return `<div class="d-card"><div class="d-h">${title}</div>${inner}</div>`;
}

function showDetail() {
  const A = _scoreBreakdown('A'), B = _scoreBreakdown('B');
  const kA = _koBreakdown('A'), kB = _koBreakdown('B');
  const nameA = escapeHtml(state.meta.aName), nameB = escapeHtml(state.meta.bName);
  const header = `<div class="d-cols"><span>${nameA}</span><span></span><span>${nameB}</span></div>`;

  const scoring = _dcard('Scoring breakdown', header +
    _drow('From play', `${A.play.n} (${A.play.p})`, `${B.play.n} (${B.play.p})`) +
    _drow('From frees', `${A.free.n} (${A.free.p})`, `${B.free.n} (${B.free.p})`) +
    _drow('Dead balls', `${A.dead.n} (${A.dead.p})`, `${B.dead.n} (${B.dead.p})`) +
    _drow('Points (1pt)', A.pt, B.pt) +
    _drow('2-pointers', A.two, B.two) +
    _drow('Goals', A.goal, B.goal));

  const ko = _dcard('Kickouts (own)', header +
    _drow('Total', kA.total, kB.total) +
    _drow('Won clean', kA.wc, kB.wc) +
    _drow('Won break', kA.wb, kB.wb) +
    _drow('Lost', kA.lc + kA.lb, kB.lc + kB.lb) +
    _drow('Out of play', kA.oop, kB.oop) +
    _drow('Win %', kA.pct + '%', kB.pct + '%'));

  const rows = _playerRows('A');
  let ptbl = `<div class="ptbl"><div class="pt-row pt-head"><span>Player</span><span>Pts</span><span>Sh</span><span>Cv%</span><span>TO</span></div>`;
  if (rows.length) {
    rows.forEach(r => {
      const nm = playerName('A', r.n) ? `#${r.n} ${escapeHtml(playerName('A', r.n))}` : `#${r.n}`;
      const cv = r.shots ? Math.round(r.scores / r.shots * 100) + '%' : '—';
      ptbl += `<div class="pt-row"><span>${nm}</span><span>${r.pts}</span><span>${r.shots}</span><span>${cv}</span><span>${r.to}</span></div>`;
    });
  } else { ptbl += `<div class="pt-empty">No player events yet</div>`; }
  ptbl += `</div>`;
  const players = _dcard(`Per player — ${nameA}`, ptbl);

  const z = _zones('A');
  const zrow = (lbl, o) => _drow(lbl, `${o.sc}/${o.s}`, o.s ? Math.round(o.sc / o.s * 100) + '%' : '—');
  const zones = _dcard(`Shot conversion by zone — ${nameA}`,
    `<div class="d-cols"><span>scored/shots</span><span></span><span>conv</span></div>` +
    zrow('Inside 20m', z.in20) + zrow('20–40m', z.mid) + zrow('Beyond 40m (2pt)', z.far));

  document.getElementById('detailBody').innerHTML = scoring + ko + players + zones;
  showScreen('detail');
}
