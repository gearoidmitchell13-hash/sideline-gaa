/* ============================================================
   SidelineGAA — stats, summary screen & CSV export
   Shares the global scope with app.js / shotchart.js / history.js.
   ============================================================ */

'use strict';

let _chartSide = 'A';

/* ---------- derived stats for one side ---------- */
function statsFor(side) {
  const s = {
    poss: 0, shots: 0, scores: 0, wides: 0, conv: 0, twos: state.score[side].two,
    koOwn: 0, koWon: 0, koPct: 0, toWon: 0, toLost: 0, fw: 0, fc: 0,
    y: 0, bl: 0, rd: 0, scorers: {}
  };
  const tot = state.possTime.A + state.possTime.B;
  s.poss = tot ? Math.round(state.possTime[side] / tot * 100) : 50;
  state.events.forEach(ev => {
    if (ev.kind === 'score' && ev.side === side) {
      s.shots++; s.scores++;
      if (ev.player != null) s.scorers[ev.player] = (s.scorers[ev.player] || 0) + (ev.scoreType === 'g' ? 3 : ev.scoreType === 'two' ? 2 : 1);
    } else if (ev.kind === 'wide' && ev.side === side) {
      s.shots++; s.wides++;
    } else if (ev.kind === 'kickout' && ev.by === side) {
      s.koOwn++; if (ev.outcome === 'wonClean' || ev.outcome === 'wonBreak') s.koWon++;
    } else if (ev.kind === 'turnover') {
      if (ev.side === side) s.toLost++; else if (ev.side === other(side)) s.toWon++;
    } else if (ev.kind === 'freeWon' && ev.side === side) {
      s.fw++;                                    // legacy event
    } else if (ev.kind === 'foul') {
      if (ev.side === side) {
        s.fc++;
        if (ev.card === 'yellow') s.y++; else if (ev.card === 'black') s.bl++; else if (ev.card === 'red') s.rd++;
      } else if (ev.side === other(side)) {
        s.fw++;                                  // opponent fouled = we won a free
      }
    }
  });
  s.conv = s.shots ? Math.round(s.scores / s.shots * 100) : 0;
  s.koPct = s.koOwn ? Math.round(s.koWon / s.koOwn * 100) : 0;
  return s;
}
function topScorer(side) {
  const sc = statsFor(side).scorers;
  let best = null;
  Object.keys(sc).forEach(n => { if (!best || sc[n] > best.pts) best = { n: Number(n), pts: sc[n] }; });
  return best;
}

/* ---------- summary screen ----------
   backTo: 'history' when viewing a saved match (Back returns to history). */
function showSummary(backTo) {
  _chartSide = 'A';   // always default the shot map to your team
  const A = statsFor('A'), B = statsFor('B');
  const win = total(state.score.A) === total(state.score.B) ? 'Draw'
    : (total(state.score.A) > total(state.score.B) ? state.meta.aName + ' win' : state.meta.bName + ' win');

  // print-only report header
  const _comp = [state.meta.competition, state.meta.level].filter(Boolean).join(' · ');
  document.getElementById('reportHead').innerHTML =
    `<div class="rep-title">${escapeHtml(state.meta.aName)} vs ${escapeHtml(state.meta.bName)}</div>` +
    `<div class="rep-meta">${_comp ? escapeHtml(_comp) + ' · ' : ''}${new Date(state.savedAt || Date.now()).toLocaleDateString()}</div>`;

  document.getElementById('sumScore').innerHTML =
    `<div class="team A"><div class="nm">${escapeHtml(state.meta.aName)}</div><div class="sc">${gp(state.score.A)}</div><div class="tot">${total(state.score.A)} pts</div></div>` +
    `<div class="team B"><div class="nm">${escapeHtml(state.meta.bName)}</div><div class="sc">${gp(state.score.B)}</div><div class="tot">${total(state.score.B)} pts</div></div>`;
  document.getElementById('sumResult').textContent = `${state.phase === 'ended' ? 'Full time' : 'Live snapshot'} · ${win}`;

  // back button: to history (archived view) or to live match
  const back = document.getElementById('backLiveBtn');
  if (backTo === 'history') {
    back.style.display = 'block';
    back.textContent = '← Back to history';
    back.onclick = () => showHistory();
  } else {
    back.textContent = '← Back to match';
    back.onclick = () => showScreen('live');
    back.style.display = state.phase === 'ended' ? 'none' : 'block';
  }

  // chart toggle wiring
  document.getElementById('chartA').textContent = state.meta.aName;
  document.getElementById('chartB').textContent = state.meta.bName;
  document.getElementById('chartA').onclick = () => { _chartSide = 'A'; renderChartInto(); };
  document.getElementById('chartB').onclick = () => { _chartSide = 'B'; renderChartInto(); };
  renderChartInto();

  const tsA = topScorer('A'), tsB = topScorer('B');
  const rows = [
    ['Possession', A.poss + '%', B.poss + '%'],
    ['Total points', total(state.score.A), total(state.score.B)],
    ['Two-pointers', A.twos, B.twos],
    ['Shots', A.shots, B.shots],
    ['Conversion', A.conv + '%', B.conv + '%'],
    ['Wides', A.wides, B.wides],
    ['Own KO win %', A.koPct + '%', B.koPct + '%'],
    ['Turnovers won', A.toWon, B.toWon],
    ['Frees won', A.fw, B.fw],
    ['Cards Y/B/R', `${A.y}/${A.bl}/${A.rd}`, `${B.y}/${B.bl}/${B.rd}`],
    ['Top scorer', tsA ? `#${tsA.n} (${tsA.pts})` : '—', tsB ? `#${tsB.n} (${tsB.pts})` : '—']
  ];
  document.getElementById('sumTable').innerHTML = rows.map(r =>
    `<div class="stat-row"><span class="va">${r[1]}</span><span class="lbl">${r[0]}</span><span class="vb">${r[2]}</span></div>`).join('');
  showScreen('summary');
}

function renderChartInto() {
  document.getElementById('sumChart').innerHTML = renderShotChart(_chartSide);
  document.getElementById('chartA').classList.toggle('on', _chartSide === 'A');
  document.getElementById('chartB').classList.toggle('on', _chartSide === 'B');
}

/* ---------- CSV export ---------- */
function exportCSV() {
  const rows = [['Min', 'Period', 'Team', 'Event', 'Detail', 'Player', 'ShotX', 'ShotY']];
  state.events.forEach(ev => {
    const team = ev.side ? teamName(ev.side) : '';
    const player = ev.player != null ? (ev.side === 'A' && playerName('A', ev.player) ? `#${ev.player} ${playerName('A', ev.player)}` : `#${ev.player}`) : '';
    const x = ev.loc ? ev.loc.x : '';
    const y = ev.loc ? ev.loc.y : '';
    rows.push([ev.min, ev.period, team, tagFor(ev), feedText(ev).replace(/<[^>]+>/g, ''), player, x, y]);
  });
  rows.push([]);
  const A = statsFor('A'), B = statsFor('B');
  rows.push(['SUMMARY', state.meta.aName, state.meta.bName]);
  rows.push(['Score', gp(state.score.A) + ` (${total(state.score.A)})`, gp(state.score.B) + ` (${total(state.score.B)})`]);
  [['Possession %', A.poss, B.poss], ['Two-pointers', A.twos, B.twos], ['Shots', A.shots, B.shots],
   ['Conversion %', A.conv, B.conv], ['Wides', A.wides, B.wides], ['Own KO win %', A.koPct, B.koPct],
   ['Turnovers won', A.toWon, B.toWon], ['Frees won', A.fw, B.fw]]
    .forEach(r => rows.push(r));

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SidelineGAA_${state.meta.aName}_v_${state.meta.bName}.csv`.replace(/\s+/g, '_');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- half-time / full-time brief ----------
   Renders matchBrief() into the bottom sheet. If onContinue is given, a primary
   action button advances the game (used at half-time); otherwise it's read-only. */
function showBrief(continueLabel, onContinue) {
  const items = (typeof matchBrief === 'function') ? matchBrief() : [];
  const body = document.getElementById('sheetBody');
  body.innerHTML = '';

  const h = document.createElement('div');
  h.className = 'sh-title';
  h.textContent = state.phase === 'ended' ? '🧠 Full-time brief' : '🧠 Half-time brief';
  body.appendChild(h);

  const sub = document.createElement('div');
  sub.className = 'sh-note';
  sub.style.margin = '-4px 0 10px';
  sub.textContent = `${state.meta.aName} ${gp(state.score.A)} – ${gp(state.score.B)} ${state.meta.bName}`;
  body.appendChild(sub);

  const list = document.createElement('div');
  list.className = 'brief-list';
  if (!items.length) {
    list.innerHTML = '<div class="brief-empty">Not enough has happened yet for talking points.</div>';
  } else {
    items.forEach(it => {
      const r = document.createElement('div');
      r.className = 'brief-row ' + it.tone;
      r.innerHTML = `<span class="brief-dot"></span><span class="brief-tx">${escapeHtml(it.text)}</span>`;
      list.appendChild(r);
    });
  }
  body.appendChild(list);

  if (onContinue) {
    const cont = document.createElement('button');
    cont.className = 'sh-opt g span';
    cont.style.marginTop = '12px';
    cont.innerHTML = continueLabel;
    cont.onclick = onContinue;
    body.appendChild(cont);
  }

  const c = document.createElement('div');
  c.className = 'sh-cancel';
  c.textContent = onContinue ? 'Not yet' : 'Close';
  c.onclick = closeSheet;
  body.appendChild(c);

  sheetOpen = true;
  document.getElementById('overlay').classList.add('show');
}

/* ---------- share as image ----------
   Renders a square stats card on a canvas and shares it via the Web Share API
   (files), falling back to a PNG download. No DOM screenshot, no dependencies. */
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
/* Shrink font until `text` fits within maxW; returns the chosen px size. */
function _fitFont(ctx, text, weight, maxPx, maxW) {
  let px = maxPx;
  do {
    ctx.font = `${weight} ${px}px -apple-system,"Segoe UI",Roboto,Arial,sans-serif`;
    if (ctx.measureText(text).width <= maxW) break;
    px -= 2;
  } while (px > 16);
  return px;
}

function buildSummaryCanvas() {
  const W = 1080, H = 1080;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const GREEN = '#1b7a3d', GREEN_D = '#125c2d', GOLD = '#f2b705',
        INK = '#16241c', RED = '#b23a2e', MUTED = '#6b7a70', LINE = '#e2e7e0';

  // background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // header band (green gradient)
  const HEAD = 430;
  const grad = ctx.createLinearGradient(0, 0, 0, HEAD);
  grad.addColorStop(0, GREEN); grad.addColorStop(1, GREEN_D);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, HEAD);

  const cx = W / 2;
  ctx.textBaseline = 'alphabetic';

  // brand + meta line
  ctx.textAlign = 'left';
  ctx.fillStyle = GOLD;
  ctx.font = '800 30px -apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  ctx.fillText('SidelineGAA', 56, 64);

  const meta = [state.meta.competition, state.meta.level].filter(Boolean).join(' · ');
  const dateStr = new Date(state.savedAt || Date.now()).toLocaleDateString();
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 26px -apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  ctx.fillText(meta ? `${meta} · ${dateStr}` : dateStr, W - 56, 64);

  // team names
  const nameMaxW = W / 2 - 110;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  const nA = state.meta.aName, nB = state.meta.bName;
  const fA = _fitFont(ctx, nA, '800', 46, nameMaxW);
  ctx.font = `800 ${fA}px -apple-system,"Segoe UI",Roboto,Arial,sans-serif`;
  ctx.fillText(nA, W * 0.27, 175);
  const fB = _fitFont(ctx, nB, '800', 46, nameMaxW);
  ctx.font = `800 ${fB}px -apple-system,"Segoe UI",Roboto,Arial,sans-serif`;
  ctx.fillText(nB, W * 0.73, 175);

  // scorelines (goals-points)
  ctx.fillStyle = '#fff';
  ctx.font = '900 96px -apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  ctx.fillText(gp(state.score.A), W * 0.27, 285);
  ctx.fillText(gp(state.score.B), W * 0.73, 285);

  // total points under each score
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '700 32px -apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  ctx.fillText(`${total(state.score.A)} pts`, W * 0.27, 330);
  ctx.fillText(`${total(state.score.B)} pts`, W * 0.73, 330);

  // separating dash
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '900 70px -apple-system,Arial,sans-serif';
  ctx.fillText('–', cx, 270);

  // result chip
  const tA = total(state.score.A), tB = total(state.score.B);
  const result = tA === tB ? 'Draw'
    : `${tA > tB ? nA : nB} win by ${Math.abs(tA - tB)}`;
  const phase = state.phase === 'ended' ? 'FULL TIME' : 'LIVE';
  ctx.font = '800 28px -apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  const chipText = `${phase} · ${result}`;
  const chipW = ctx.measureText(chipText).width + 56;
  ctx.fillStyle = GOLD;
  _roundRect(ctx, cx - chipW / 2, 368, chipW, 46, 23);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(chipText, cx, 392);
  ctx.textBaseline = 'alphabetic';

  // ---- comparison rows ----
  const A = statsFor('A'), B = statsFor('B');
  const tsA = topScorer('A'), tsB = topScorer('B');
  const rows = [
    ['Possession', A.poss + '%', B.poss + '%'],
    ['Shots', A.shots, B.shots],
    ['Conversion', A.conv + '%', B.conv + '%'],
    ['Two-pointers', A.twos, B.twos],
    ['Turnovers won', A.toWon, B.toWon],
    ['Frees won', A.fw, B.fw],
    ['Top scorer', tsA ? `#${tsA.n} (${tsA.pts})` : '—', tsB ? `#${tsB.n} (${tsB.pts})` : '—'],
  ];

  const top = HEAD + 60, rowH = 78;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    // divider
    ctx.strokeStyle = LINE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(56, y + rowH - 18); ctx.lineTo(W - 56, y + rowH - 18); ctx.stroke();
    // label
    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    ctx.font = '700 27px -apple-system,"Segoe UI",Roboto,Arial,sans-serif';
    ctx.fillText(String(r[0]), cx, y + 34);
    // values
    ctx.font = '800 38px -apple-system,"Segoe UI",Roboto,Arial,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = GREEN;
    ctx.fillText(String(r[1]), 56, y + 40);
    ctx.textAlign = 'right';
    ctx.fillStyle = RED;
    ctx.fillText(String(r[2]), W - 56, y + 40);
  });

  // footer
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = '600 24px -apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  ctx.fillText('Tracked live with SidelineGAA · 2026 GAA rules', cx, H - 36);

  return cv;
}

/* Turn a finished canvas into a share/download. Filename + title captured by caller. */
function _shareCanvas(cv, fileName, title) {
  cv.toBlob(async (blob) => {
    if (!blob) { alert('Could not build the image.'); return; }
    const file = new File([blob], fileName, { type: 'image/png' });

    // Web Share API (iOS Safari) — share the file directly to WhatsApp etc.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title, text: title }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }   // user cancelled
    }

    // Fallback — download the PNG
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

function _shareFileName(m) {
  return `SidelineGAA_${m.meta.aName}_v_${m.meta.bName}.png`.replace(/\s+/g, '_');
}
function _shareTitle(m) {
  return `${m.meta.aName} ${gp(m.score.A)} – ${gp(m.score.B)} ${m.meta.bName}`;
}

/* Share the currently-loaded match (summary screen button). */
function shareSummaryImage() {
  let cv;
  try { cv = buildSummaryCanvas(); }
  catch (e) { alert('Could not build the image.'); return; }
  _shareCanvas(cv, _shareFileName(state), _shareTitle(state));
}

/* Share an archived match directly from the history list, without navigating.
   The canvas is drawn synchronously while state is swapped, then state restored
   before the async share — so the swap never overlaps user interaction. */
function shareMatchRecord(rec) {
  const saved = state;
  let cv, fileName, title;
  try {
    state = rec;
    cv = buildSummaryCanvas();
    fileName = _shareFileName(rec);
    title = _shareTitle(rec);
  } catch (e) {
    state = saved;
    alert('Could not build the image.');
    return;
  }
  state = saved;
  _shareCanvas(cv, fileName, title);
}
