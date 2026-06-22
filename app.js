/* ============================================================
   SidelineGAA — GAA stats tracker (PWA)
   Pure vanilla JS. State machine ported from the validated
   Phase 0 prototype, extended with setup, persistence & export.
   ============================================================ */

'use strict';

/* ---------- storage keys ---------- */
const LS_TEAMS = 'sidelinegaa.teams.v1';
const LS_MATCH = 'sidelinegaa.match.v1';

/* ---------- sample squad ---------- */
const SAMPLE_NAMES = ['Cleary','Walsh','Burke','Healy','Lyons','Fox','Daly','Nolan','Power',
  "O'Hara",'McGee','Ryan','Doyle','Quinn','Breen'];

function defaultTeams() {
  return {
    aName: 'Naomh Pádraig',
    bName: 'Erins Own',
    squadA: SAMPLE_NAMES.map((nm, i) => ({ n: i + 1, name: nm })),
    benchA: [16, 17, 18, 19, 20, 21]
  };
}

/* ---------- labels ---------- */
const SCORE_LABEL = { one: 'Point', two: '2-Point', g: 'Goal' };
const SCORE_TAG   = { one: 'PT', two: '2PT', g: 'GL' };
const MISS_LABEL  = { wide: 'Wide', short: 'Dropped short', saved: 'Saved', blocked: 'Blocked' };
const SOURCE_LABEL = { play: 'Play', free: 'Free', '45': '45', mark: 'Mark', sideline: 'Sideline', pen: 'Penalty' };
const FOUL_LABEL  = { overcarry: 'Overcarry', charge: 'Charge', throwball: 'Throw ball',
  dissent: 'Dissent', square: 'Square ball', hold: 'Hold', tackle: 'Tackle', other: 'Other' };
const TO_LABEL    = { tackle: 'Lost in tackle', kick: 'Bad kick pass', hand: 'Handpass error',
  carry: 'Overcarry', intercept: 'Intercepted', fumble: 'Fumbled' };
const KO_LABEL    = { wonClean: 'Won clean', wonBreak: 'Won break', lostClean: 'Lost clean',
  lostBreak: 'Lost break', outOfPlay: 'Out → sideline' };

/* ---------- state ---------- */
let state = null;
let undoStack = [];
let timer = null;
let sheetOpen = false;
let setupDepth = 'standard';

const other = t => (t === 'A' ? 'B' : 'A');
const $ = id => document.getElementById(id);

/* ---------- scoring helpers ---------- */
const ptsVal = s => s.one + 2 * s.two;
const total  = s => s.g * 3 + ptsVal(s);
const gp     = s => `${s.g}-${String(ptsVal(s)).padStart(2, '0')}`;

/* ---------- name helpers ---------- */
function teamName(t) { return t === 'A' ? state.meta.aName : state.meta.bName; }
function squad(t) { return t === 'A' ? state.squadA : state.squadB; }
function playerName(t, n) {
  const p = squad(t).find(p => p.n === n);
  return p && p.name ? p.name : '';
}
function fullDepth(t) { return t === 'A'; }   // our team only

/* ============================================================
   PERSISTENCE
   ============================================================ */
function loadTeams() {
  try { return JSON.parse(localStorage.getItem(LS_TEAMS)) || defaultTeams(); }
  catch { return defaultTeams(); }
}
function saveTeams(t) { try { localStorage.setItem(LS_TEAMS, JSON.stringify(t)); } catch (e) {} }
function saveMatch() { try { localStorage.setItem(LS_MATCH, JSON.stringify(state)); } catch (e) {} }
function loadMatch() {
  try { return JSON.parse(localStorage.getItem(LS_MATCH)); } catch (e) { return null; }
}
function clearMatch() { try { localStorage.removeItem(LS_MATCH); } catch (e) {} }

/* ============================================================
   MATCH LIFECYCLE
   ============================================================ */
function freshMatch(meta, panelA, onFieldA) {
  const squadB = Array.from({ length: 15 }, (_, i) => ({ n: i + 1, name: '' }));
  return {
    meta, squadA: panelA, onFieldA: onFieldA.slice(), squadB,
    phase: 'pregame', period: 'H1', clock: 0, running: false,
    possession: null, possTime: { A: 0, B: 0 },
    score: { A: { g: 0, two: 0, one: 0 }, B: { g: 0, two: 0, one: 0 } },
    events: [], sinBins: []
  };
}

/* ---------- event log + undo ---------- */
function pushHistory() {
  undoStack.push(JSON.stringify({
    score: state.score, possession: state.possession,
    events: state.events, phase: state.phase, period: state.period
  }));
  if (undoStack.length > 60) undoStack.shift();
}
function addEvent(ev) {
  ev.clock = state.clock;
  ev.min = Math.floor(state.clock / 60);
  ev.period = state.period;
  state.events.push(ev);
}
function undo() {
  if (!undoStack.length) return;
  const s = JSON.parse(undoStack.pop());
  state.score = s.score; state.possession = s.possession;
  state.events = s.events; state.phase = s.phase; state.period = s.period;
  closeSheet(); render(); saveMatch();
}

/* ============================================================
   SCREEN ROUTING
   ============================================================ */
function showScreen(name) {
  ['home', 'setup', 'live', 'summary', 'history', 'detail', 'squads', 'analysis'].forEach(s =>
    $('screen-' + s).classList.toggle('active', s === name));
  $('appTag').textContent = (name === 'live' && state)
    ? `${state.meta.aName} v ${state.meta.bName}`
    : 'GAA stats · 2026 rules';
  const hb = $('homeBtn');
  if (hb) hb.style.visibility = (name === 'home' || name === 'live') ? 'hidden' : 'visible';
}

/* ---------- home navigation ---------- */
function goHome() { renderHome(); showScreen('home'); }
function renderHome() {
  const m = loadMatch();
  const r = $('homeResume');
  if (m && m.phase === 'live') {
    r.style.display = 'block';
    r.textContent = `⏯ Resume — ${m.meta.aName} ${gp(m.score.A)}–${gp(m.score.B)} ${m.meta.bName}`;
  } else {
    r.style.display = 'none';
  }
}
function aboutSheet() {
  openSheet('About SidelineGAA', [{ label: 'Done', cls: 'g', onClick: closeSheet }], 1,
    'Live Gaelic football stat tracker, built on the 2026 FRC ruleset (two-pointers, solo-and-go frees, new kickouts). Works offline; your data stays on this device.');
}

/* ============================================================
   SETUP SCREEN
   ============================================================ */
function renderSetup() {
  renderSquadPicker();
  const m = loadMatch();
  const box = $('resumeBox'); box.innerHTML = '';
  if (m && m.phase === 'live') {
    const div = document.createElement('div');
    div.className = 'resume-banner';
    div.innerHTML = `<b>Match in progress</b> — ${escapeHtml(m.meta.aName)} ${gp(m.score.A)} v ` +
      `${gp(m.score.B)} ${escapeHtml(m.meta.bName)} (${m.period} ${fmtClock(m.clock)}).`;
    const r = document.createElement('button'); r.className = 'ghost'; r.textContent = 'Resume match';
    r.style.marginTop = '8px';
    r.onclick = () => { state = m; bindLive(); showScreen('live'); render(); startTimer(); };
    div.appendChild(r);
    box.appendChild(div);
  }
}


function startMatch() {
  const bName = $('bName').value.trim() || 'Opposition';
  const half = Math.max(1, Math.min(45, Number($('halfLen').value) || 30));
  const sq = getMatchSquad();
  const aName = sq.name || 'Your team';
  const competition = ($('compName') ? $('compName').value.trim() : '');
  const level = ($('compLevel') ? $('compLevel').value.trim() : '');
  const meta = { aName, bName, half, depth: setupDepth, ourSide: 'A', competition, level };
  state = freshMatch(meta, sq.panel, sq.onField);
  undoStack = [];
  saveMatch(); bindLive(); showScreen('live'); render(); startTimer();
}

/* ============================================================
   TIMER
   ============================================================ */
function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!state || !state.running || state.phase !== 'live') return;
    state.clock++;                                                 // match clock runs through dead balls
    if (state.possession && !sheetOpen) state.possTime[state.possession]++;  // possession pauses out of play
    renderClock(); renderPoss(); renderSinBins();
    if (state.clock % 3 === 0) saveMatch();
  }, 1000);
}

/* ============================================================
   SHEET SYSTEM
   ============================================================ */
function openSheet(title, items, cols, note) {
  const body = $('sheetBody'); body.innerHTML = '';
  const h = document.createElement('div'); h.className = 'sh-title'; h.textContent = title; body.appendChild(h);
  const g = document.createElement('div'); g.className = 'sh-grid';
  g.style.gridTemplateColumns = `repeat(${cols || 2}, 1fr)`;
  items.forEach(it => {
    const b = document.createElement('button');
    b.className = 'sh-opt ' + (it.cls || '');
    b.innerHTML = it.label;
    b.onclick = it.onClick;
    g.appendChild(b);
  });
  body.appendChild(g);
  if (note) { const n = document.createElement('div'); n.className = 'sh-note'; n.textContent = note; body.appendChild(n); }
  const c = document.createElement('div'); c.className = 'sh-cancel'; c.textContent = 'Cancel'; c.onclick = closeSheet;
  body.appendChild(c);
  sheetOpen = true; $('overlay').classList.add('show');
}
function pickPlayer(side, title, cb, onSkip) {
  const body = $('sheetBody'); body.innerHTML = '';
  const h = document.createElement('div'); h.className = 'sh-title'; h.textContent = title; body.appendChild(h);
  const g = document.createElement('div'); g.className = 'pgrid';
  const list = side === 'A'
    ? state.squadA.filter(p => (state.onFieldA || []).includes(p.n)).sort((a, b) => a.n - b.n)
    : squad('B');
  list.forEach(p => {
    const c = document.createElement('div');
    c.className = 'pcell' + (side === 'B' ? ' b' : '');
    c.innerHTML = `<span class="pn">${p.n}</span>` + (side === 'A' && p.name ? `<span class="pnm">${escapeHtml(p.name)}</span>` : '');
    c.onclick = () => cb(p.n);
    g.appendChild(c);
  });
  body.appendChild(g);
  if (onSkip) {
    const sk = document.createElement('div'); sk.className = 'sh-cancel';
    sk.style.color = 'var(--green-d)'; sk.style.fontWeight = '800';
    sk.textContent = 'Skip — just the team'; sk.onclick = onSkip; body.appendChild(sk);
  }
  const c = document.createElement('div'); c.className = 'sh-cancel'; c.textContent = 'Cancel'; c.onclick = closeSheet;
  body.appendChild(c);
  sheetOpen = true; $('overlay').classList.add('show');
}
function pickBench(off) {
  const body = $('sheetBody'); body.innerHTML = '';
  const h = document.createElement('div'); h.className = 'sh-title'; h.textContent = 'Bench player coming ON'; body.appendChild(h);
  const g = document.createElement('div'); g.className = 'pgrid';
  const bench = state.squadA.filter(p => !(state.onFieldA || []).includes(p.n)).sort((a, b) => a.n - b.n);
  if (!bench.length) { const e = document.createElement('div'); e.className = 'pt-empty'; e.textContent = 'No bench players in this squad'; body.appendChild(e); }
  bench.forEach(p => {
    const c = document.createElement('div'); c.className = 'pcell';
    c.innerHTML = `<span class="pn">${p.n}</span>` + (p.name ? `<span class="pnm">${escapeHtml(p.name)}</span>` : '');
    c.onclick = () => {
      pushHistory();
      state.onFieldA = (state.onFieldA || []).filter(x => x !== off).concat(p.n);
      addEvent({ kind: 'sub', side: 'A', off, on: p.n });
      closeSheet(); render(); saveMatch();
    };
    g.appendChild(c);
  });
  body.appendChild(g);
  const c = document.createElement('div'); c.className = 'sh-cancel'; c.textContent = 'Cancel'; c.onclick = closeSheet;
  body.appendChild(c);
}
function closeSheet() { sheetOpen = false; $('overlay').classList.remove('show'); }

/* ============================================================
   FLOWS
   ============================================================ */
function throwIn() {
  openSheet('Who won the throw-in?', [
    { label: state.meta.aName, cls: 'a', onClick: () => winThrowIn('A') },
    { label: state.meta.bName, cls: 'b', onClick: () => winThrowIn('B') }
  ], 1, 'Midfield throw-in to start the half');
}
function winThrowIn(t) {
  pushHistory(); state.phase = 'live'; state.running = true; state.possession = t;
  addEvent({ kind: 'throwin', side: t }); closeSheet(); render(); saveMatch();
}

/* SCORE */
function onScore() {
  const t = state.possession;
  openSheet('Score — what type?', [
    { label: 'Point<small>1 pt</small>', cls: 'g', onClick: () => scorePlayer(t, 'one') },
    { label: '2-Point<small>2 pts</small>', cls: 'go', onClick: () => scorePlayer(t, 'two') },
    { label: '⚽ GOAL<small>3 pts</small>', cls: 'blue', onClick: () => scorePlayer(t, 'g') }
  ], 3, '2-pointer is asked explicitly (on/outside the 40m arc).');
}
function scorePlayer(t, kind) {
  pickPlayer(t, t === 'A' ? 'Who scored?' : 'Scorer — jersey #', n => scoreSource(t, kind, n));
}
function scoreSource(t, kind, n) {
  const src = s => pickLocation(t, loc => commitScore(t, kind, n, s, loc));
  openSheet('How was it scored?', [
    { label: 'From play', cls: 'g span', onClick: () => src('play') },
    { label: 'Free', cls: 'ghost', onClick: () => src('free') },
    { label: '45', cls: 'ghost', onClick: () => src('45') },
    { label: 'Mark', cls: 'ghost', onClick: () => src('mark') },
    { label: 'Sideline', cls: 'ghost', onClick: () => src('sideline') },
    { label: 'Penalty', cls: 'ghost', onClick: () => src('pen') }
  ], 3, 'Most scores are from play (the big button). Tap a placed-ball source only if needed.');
}
function commitScore(t, kind, n, source, loc) {
  pushHistory();
  state.score[t][kind]++;
  addEvent({ kind: 'score', side: t, scoreType: kind, source, player: n, loc: loc || null });
  closeSheet(); render(); saveMatch();
  kickout(other(t));
}

/* WIDE / MISS */
function onWide() { startMiss(state.possession, null); }

function startMiss(t, source) {
  openSheet('Shot missed — type?', [
    { label: 'Wide', onClick: () => missPlayer(t, 'wide', source) },
    { label: 'Dropped short', onClick: () => missPlayer(t, 'short', source) },
    { label: 'Saved', onClick: () => missPlayer(t, 'saved', source) },
    { label: 'Blocked', onClick: () => missPlayer(t, 'blocked', source) }
  ], 2, 'Wide / over the end line = kickout. Short, saved or blocked stay in play.');
}
function missPlayer(t, m, source) {
  if (fullDepth(t)) pickPlayer(t, 'Who shot?', n => pickLocation(t, loc => missResolve(t, m, source, n, loc)));
  else pickLocation(t, loc => missResolve(t, m, source, null, loc));
}
function missResolve(t, m, source, n, loc) {
  pushHistory();
  const ev = { kind: 'wide', side: t, missType: m, player: n, loc: loc || null };
  if (source) ev.source = source;
  addEvent(ev);
  saveMatch();
  if (m === 'wide') { closeSheet(); render(); kickout(other(t)); }   // dead ball -> kickout
  else if (m === 'blocked') { blockedOutcome(t); }
  else { ballWon(t); }                                               // short / saved stay in play
}
function _setWonBy(team) {
  const e = state.events[state.events.length - 1];
  if (e && e.kind === 'wide') e.wonBy = team;
  state.possession = team;
  closeSheet(); render(); saveMatch();
}
function ballWon(t) {
  const ot = other(t);
  openSheet('Ball stayed in play — who won it?', [
    { label: `${teamName(t)}<small>rebound</small>`, cls: t === 'A' ? 'a' : 'b', onClick: () => _setWonBy(t) },
    { label: `${teamName(ot)}`, cls: ot === 'A' ? 'a' : 'b', onClick: () => _setWonBy(ot) }
  ], 1);
}
function blockedOutcome(t) {
  const ot = other(t);
  openSheet('Blocked — what happened?', [
    { label: `Out for a 45 → ${teamName(t)}`, cls: 'go', onClick: () => _setWonBy(t) },
    { label: `${teamName(t)} won it`, cls: t === 'A' ? 'a' : 'b', onClick: () => _setWonBy(t) },
    { label: `${teamName(ot)} won it`, cls: ot === 'A' ? 'a' : 'b', onClick: () => _setWonBy(ot) }
  ], 1);
}

/* FREE WON */
function onFreeWon() {
  const t = state.possession, ot = other(t);
  const mk = f => ({ label: FOUL_LABEL[f], onClick: () => freeFoulPlayer(t, f) });
  openSheet(`Free to ${teamName(t)} — foul by ${teamName(ot)}?`,
    ['tackle', 'hold', 'overcarry', 'dissent', 'square', 'other'].map(mk), 3,
    'Records the foul against the conceding team, then take the free.');
}
function freeFoulPlayer(t, foulType) {
  const ot = other(t);
  pickPlayer(ot, `Foul by — ${teamName(ot)} jersey?`,
    n => askCard(card => pickLocationFull(ot, loc => freeFoulCommit(t, foulType, n, card, loc))),
    () => askCard(card => pickLocationFull(ot, loc => freeFoulCommit(t, foulType, null, card, loc))));
}
function freeFoulCommit(t, foulType, foulerN, card, loc) {
  pushHistory();
  addEvent({ kind: 'foul', side: other(t), foulType, card, player: foulerN, free: true, loc });
  state.possession = t;
  if (card === 'black') startSinBin(other(t), foulerN);
  saveMatch();
  openSheet('Free won — outcome?', [
    { label: 'Point · 1', cls: 'g', onClick: () => freeScore(t, 'one') },
    { label: '2-Point · 2', cls: 'go', onClick: () => freeScore(t, 'two') },
    { label: '⚽ Goal · 3', cls: 'blue', onClick: () => freeScore(t, 'g') },
    { label: 'Wide / miss', onClick: () => startMiss(t, 'free') },
    { label: 'Tap &amp; go — play on', cls: 'g span', onClick: () => { closeSheet(); render(); } }
  ], 2, 'Shoot the free, or tap &amp; go to keep the ball.');
}
function freeScore(t, kind) {
  pickPlayer(t, t === 'A' ? 'Free taken by?' : 'Free taker — jersey #', n => pickLocation(t, loc => commitScore(t, kind, n, 'free', loc)));
}

/* FOUL COMMITTED */
function onFoul() {
  const t = state.possession;
  const mk = f => ({ label: FOUL_LABEL[f], onClick: () => foulPlayer(t, f) });
  openSheet(`Foul by ${teamName(t)} — type?`,
    ['overcarry', 'charge', 'throwball', 'dissent', 'square', 'other'].map(mk), 3);
}
function foulPlayer(t, f) {
  pickPlayer(t, t === 'A' ? 'Foul by — which player?' : 'Foul by — jersey?',
    n => askCard(card => pickLocationFull(t, loc => commitFoulFull(t, f, n, card, loc))),
    () => askCard(card => pickLocationFull(t, loc => commitFoulFull(t, f, null, card, loc))));
}
function askCard(cb) {
  openSheet('Card?', [
    { label: 'No card', cls: 'g span', onClick: () => cb('') },
    { label: 'Yellow', cls: 'go', onClick: () => cb('yellow') },
    { label: 'Black (10-min)', cls: 'grey', onClick: () => cb('black') },
    { label: 'Red', cls: 'b', onClick: () => cb('red') }
  ], 3, 'Most fouls have no card. Black = 10-minute sin bin.');
}
function commitFoulFull(t, f, player, card, loc) {
  pushHistory();
  addEvent({ kind: 'foul', side: t, foulType: f, card, player, loc });
  state.possession = other(t);
  if (card === 'black') startSinBin(t, player);
  closeSheet(); render(); saveMatch();
}
function startSinBin(side, player) {
  if (player == null) return;
  if (!state.sinBins) state.sinBins = [];
  state.sinBins.push({ side, player, until: state.clock + 600 });   // 10 minutes
}
function renderSinBins() {
  const el = $('sinBins'); if (!el) return;
  const bins = (state.sinBins || []).filter(b => b.until > state.clock);
  if (!bins.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML = bins.map(b => {
    const rem = b.until - state.clock;
    const mmss = `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
    const who = (b.side === 'A' && playerName('A', b.player)) ? `#${b.player} ${playerName('A', b.player)}` : `#${b.player}`;
    return `<span class="sinbin ${b.side}">⬛ ${teamName(b.side)} ${who} · ${mmss} left</span>`;
  }).join('');
}

/* TURNOVER */
function onTurnover() {
  const t = state.possession;
  const mk = to => ({ label: TO_LABEL[to], onClick: () => turnWho(t, to) });
  openSheet('Turnover — how was it lost?',
    ['tackle', 'kick', 'hand', 'carry', 'intercept', 'fumble'].map(mk), 2);
}
function turnWho(t, to) {
  if (fullDepth(t)) pickPlayer('A', 'Who lost it?', n => pickLocationFull(t, loc => commitTurn(t, to, n, loc)));
  else pickLocationFull(t, loc => commitTurn(t, to, null, loc));
}
function commitTurn(t, to, n, loc) {
  pushHistory();
  addEvent({ kind: 'turnover', side: t, toType: to, player: n, loc: loc || null });
  state.possession = other(t);
  closeSheet(); render(); saveMatch();
}

/* KICKOUT */
function kickout(kt) {
  const ot = other(kt);
  openSheet(`${teamName(kt)} kickout — who won it?`, [
    { label: `Won clean<small>${teamName(kt)}</small>`, cls: kt === 'A' ? 'a' : 'b', onClick: () => commitKO(kt, 'wonClean', kt) },
    { label: `Won break<small>${teamName(kt)}</small>`, cls: kt === 'A' ? 'a' : 'b', onClick: () => commitKO(kt, 'wonBreak', kt) },
    { label: `Won clean<small>${teamName(ot)}</small>`, cls: ot === 'A' ? 'a' : 'b', onClick: () => commitKO(kt, 'lostClean', ot) },
    { label: `Won break<small>${teamName(ot)}</small>`, cls: ot === 'A' ? 'a' : 'b', onClick: () => commitKO(kt, 'lostBreak', ot) },
    { label: `Out over line → sideline ${teamName(ot)}`, cls: 'span', onClick: () => commitKO(kt, 'outOfPlay', ot) }
  ], 2, `${teamName(kt)} takes the kickout — tap whichever team won the ball.`);
}
function commitKO(kt, outcome, winner) {
  pushHistory();
  addEvent({ kind: 'kickout', side: winner, by: kt, outcome });
  state.possession = winner;
  closeSheet(); render(); saveMatch();
}

/* MORE */
function moreMenu() {
  openSheet('Match controls', [
    { label: `Substitution (${state.meta.aName})`, onClick: () => pickPlayer('A', 'Player coming OFF', off => pickBench(off)) },
    { label: ({ H1: 'Go to half-time', H2: 'End of normal time…', ET1: 'Go to ET half-time', ET2: 'End match (full time)' }[state.period] || 'End period'), onClick: () => { if (state.period === 'ET2' && typeof confirm === 'function' && !confirm('End the match? It will be saved to history.')) return; endPeriod(); } },
    { label: state.running ? 'Pause clock' : 'Resume clock', onClick: () => { state.running = !state.running; closeSheet(); render(); saveMatch(); } },
    { label: '🏠 Home (match stays saved)', onClick: () => { closeSheet(); goHome(); } },
    { label: 'New match (discard)', cls: 'b', onClick: () => { if (typeof confirm === 'function' && !confirm('Discard the current match? It is not saved to history.')) return; closeSheet(); clearMatch(); state = null; undoStack = []; renderSetup(); showScreen('setup'); } }
  ], 1);
}
function startNextPeriod(toPeriod, note) {
  pushHistory();
  addEvent({ kind: 'period', note });
  state.period = toPeriod; state.running = false; state.phase = 'pregame'; state.possession = null;
  closeSheet(); render(); saveMatch();
}
function endMatch() {
  pushHistory();
  state.running = false; state.phase = 'ended';
  addEvent({ kind: 'period', note: 'Full time' });
  archiveCurrentMatch();
  closeSheet(); saveMatch(); showSummary();
}
function endPeriod() {
  if (state.period === 'H1') { startNextPeriod('H2', 'Half-time'); }
  else if (state.period === 'H2') {
    closeSheet();
    openSheet('End of normal time', [
      { label: 'Full time — end match', cls: 'g span', onClick: endMatch },
      { label: 'Go to extra time', cls: 'go span', onClick: () => startNextPeriod('ET1', 'Full time (normal)') }
    ], 1, 'Extra time is two periods — tap throw-in to restart each.');
  }
  else if (state.period === 'ET1') { startNextPeriod('ET2', 'Extra-time half-time'); }
  else { endMatch(); }
}

/* ============================================================
   RENDER (LIVE)
   ============================================================ */
function bindLive() {
  $('nmA').textContent = state.meta.aName;
  $('nmB').textContent = state.meta.bName;
}
function renderScore() {
  $('scoreA').textContent = gp(state.score.A);
  $('scoreB').textContent = gp(state.score.B);
  const tA = state.score.A, tB = state.score.B;
  $('totA').textContent = `${total(tA)} pts` + (tA.two ? ` · ${tA.two}×2pt` : '');
  $('totB').textContent = `${total(tB)} pts` + (tB.two ? ` · ${tB.two}×2pt` : '');
}
function fmtClock(sec) { return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }
function renderClock() {
  $('clock').textContent = fmtClock(state.clock);
  $('periodLbl').textContent = state.period;
  const rec = $('rec');
  rec.textContent = state.running ? '●' : '❚❚';
  rec.style.color = state.running ? '#ff6b5e' : '#9aa79e';
  $('pauseBtn').textContent = state.running ? '⏸' : '▶';
}
function renderPoss() {
  const tot = state.possTime.A + state.possTime.B;
  const a = tot ? Math.round(state.possTime.A / tot * 100) : 50;
  $('possA').style.width = a + '%';
  $('possB').style.width = (100 - a) + '%';
  $('possLblA').textContent = 'Poss ' + a + '%';
  $('possLblB').textContent = (100 - a) + '%';
}
function renderContext() {
  $('boxA').classList.toggle('live', state.possession === 'A');
  $('boxB').classList.toggle('live', state.possession === 'B');
  const ctx = $('ctx'), area = $('actionArea');

  if (state.phase === 'pregame') {
    ctx.innerHTML = '';
    const note = state.period === 'H2'
      ? 'Second half — tap throw-in to restart.'
      : (state.period === 'ET1' || state.period === 'ET2')
        ? `Extra time (${state.period}) — tap throw-in to restart.`
        : 'Squads loaded. Tap throw-in to begin tracking.';
    area.innerHTML = `<button class="throwin" id="tiBtn">▶  THROW-IN</button>
      <div class="pregame-note">${note}</div>`;
    $('tiBtn').onclick = throwIn;
    return;
  }
  const t = state.possession;
  const col = t === 'A' ? 'var(--teamA)' : 'var(--teamB)';
  const bg = t === 'A' ? 'rgba(27,122,61,.12)' : 'rgba(178,58,46,.12)';
  ctx.innerHTML = `<span class="who" style="background:${bg};color:${col}">
      <span class="dot" style="background:${col}"></span>${teamName(t)} in possession</span>`;
  area.innerHTML = `<div class="actions">
      <button class="act score" id="bScore">SCORE</button>
      <button class="act wide" id="bWide">WIDE / MISS</button>
      <button class="act free" id="bFree">FREE WON</button>
      <button class="act turn" id="bTurn">TURNOVER</button>
      <button class="act foul" id="bFoul">FOUL COMMITTED</button>
    </div>`;
  $('bScore').onclick = onScore; $('bWide').onclick = onWide; $('bFree').onclick = onFreeWon;
  $('bTurn').onclick = onTurnover; $('bFoul').onclick = onFoul;
}
function tagClass(side) { return side === 'A' ? 'A' : side === 'B' ? 'B' : 'N'; }
function tagFor(ev) {
  if (ev.kind === 'score') return SCORE_TAG[ev.scoreType];
  return { throwin: 'TI', wide: 'WIDE', freeWon: 'FW', foul: 'FOUL', turnover: 'TO',
    kickout: 'KO', sub: 'SUB', period: ev.note === 'Full time' ? 'FT' : 'HT' }[ev.kind] || '–';
}
function feedText(ev) {
  const plabel = (side, n) => {
    if (n == null) return '';
    return (side === 'A' && playerName('A', n)) ? `#${n} ${playerName('A', n)} ` : `#${n} `;
  };
  switch (ev.kind) {
    case 'throwin': return 'Won throw-in';
    case 'score': {
      const src = ev.source && ev.source !== 'play' ? ` (${SOURCE_LABEL[ev.source].toLowerCase()})` : '';
      return plabel(ev.side, ev.player) + SCORE_LABEL[ev.scoreType] + src;
    }
    case 'wide': return plabel(ev.side, ev.player) + (MISS_LABEL[ev.missType] || 'miss').toLowerCase() + (ev.source === 'free' ? ' (free)' : '');
    case 'freeWon': return 'Free won — played on';
    case 'foul': return plabel(ev.side, ev.player) + (FOUL_LABEL[ev.foulType] || 'Foul') + (ev.card ? ` · ${ev.card.toUpperCase()} card` : '') + ` → free to ${teamName(other(ev.side))}`;
    case 'turnover': return plabel(ev.side, ev.player) + (TO_LABEL[ev.toType] || 'turnover').toLowerCase() + ` → ${teamName(other(ev.side))} ball`;
    case 'kickout': return `${teamName(ev.by)} kickout ${(KO_LABEL[ev.outcome] || '').toLowerCase()}`;
    case 'sub': return `#${ev.on} on for #${ev.off}` + (playerName('A', ev.off) ? ` ${playerName('A', ev.off)}` : '');
    case 'period': return ev.note;
    default: return '';
  }
}
function renderFeed() {
  const f = $('feedList'); f.innerHTML = '';
  if (!state.events.length) { f.innerHTML = '<div class="pregame-note">No events yet.</div>'; return; }
  const n = state.events.length;
  state.events.slice().reverse().forEach((ev, ri) => {
    const idx = n - 1 - ri;
    const row = document.createElement('div'); row.className = 'ev';
    row.innerHTML = `<span class="min">${ev.min}'</span>` +
      `<span class="tag ${tagClass(ev.side)}">${tagFor(ev)}</span>` +
      `<span class="tx">${escapeHtml(feedText(ev))}</span>` +
      (state.phase !== 'ended' ? `<span class="ev-edit">✎</span>` : '');
    if (state.phase !== 'ended') row.onclick = () => editEvent(idx);
    f.appendChild(row);
  });
}
function render() {
  if (!state) return;
  if (!state.sinBins) state.sinBins = [];
  if (!state.onFieldA) {
    state.onFieldA = (state.squadA || []).map(p => p.n);
    if (state.benchA) state.benchA.forEach(n => { if (!state.squadA.find(p => p.n === n)) state.squadA.push({ n, name: '' }); });
  }
  bindLive(); renderScore(); renderClock(); renderPoss(); renderContext(); renderFeed(); renderSinBins();
  $('undoBtn').disabled = undoStack.length === 0;
  updateWakeLock();
}

/* STATS, SUMMARY & CSV moved to stats.js · SHOT CHART in shotchart.js */

/* ============================================================
   UTIL
   ============================================================ */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  // setup listeners
  $('startBtn').onclick = startMatch;
  { const _seg = $('depthSeg'); if (_seg) [..._seg.children].forEach(b => b.onclick = () => {
    setupDepth = b.dataset.d;
    [..._seg.children].forEach(x => x.classList.toggle('on', x === b));
  }); }
  // live listeners
  $('undoBtn').onclick = undo;
  $('moreBtn').onclick = moreMenu;
  $('pauseBtn').onclick = () => { if (state && state.phase === 'live') { state.running = !state.running; render(); saveMatch(); } };
  $('statsBtn').onclick = () => { if (state) showSummary(); };
  $('scrim').onclick = closeSheet;
  // summary listeners
  $('exportBtn').onclick = exportCSV;
  $('backLiveBtn').onclick = () => showScreen('live');
  $('newMatchBtn').onclick = () => { if (state && state.phase !== 'ended' && typeof confirm === 'function' && !confirm('Discard this match? It is not saved to history.')) return; clearMatch(); state = null; undoStack = []; renderSetup(); showScreen('setup'); };
  $('histBackBtn').onclick = () => goHome();
  $('printBtn').onclick = () => window.print();
  $('detailBtn').onclick = () => showDetail();
  $('detailBackBtn').onclick = () => showScreen('summary');
  $('analysisBtn').onclick = () => showAnalysis();
  $('analysisBackBtn').onclick = () => showScreen('summary');

  // home screen buttons
  $('homeNew').onclick = () => { renderSetup(); showScreen('setup'); };
  $('homeResume').onclick = () => { const m = loadMatch(); if (m) { state = m; bindLive(); showScreen('live'); render(); } };
  $('homeHistory').onclick = () => showHistory();
  $('homeAbout').onclick = () => aboutSheet();
  $('homeBtn').onclick = () => goHome();
  $('homeTeams').onclick = () => showSquads();
  $('squadsBackBtn').onclick = () => goHome();
  $('manageSquadsBtn').onclick = () => showSquads();

  renderSetup();
  renderHome();
  showScreen('home');
  startTimer();
  setTimeout(() => { const sp = $('splash'); if (sp) sp.classList.add('hide'); }, 950);
}

document.addEventListener('DOMContentLoaded', init);
