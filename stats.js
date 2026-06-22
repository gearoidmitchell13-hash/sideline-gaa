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
