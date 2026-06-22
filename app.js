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
const MISS_LABEL  = { wide: 'Wide', short: 'Short', post: 'Off post', saved: 'Saved', blocked: 'Blocked' };
const SOURCE_LABEL = { play: 'Play', free: 'Free', '45': '45', mark: 'Mark', sideline: 'Sideline', pen: 'Penalty' };
const FOUL_LABEL  = { overcarry: 'Overcarry', charge: 'Charge', throwball: 'Throw ball',
  dissent: 'Dissent', square: 'Square ball', hold: 'Hold', tackle: 'Tackle', other: 'Other' };
const TO_LABEL    = { tackle: 'Lost in tackle', kick: 'Bad kick pass', hand: 'Handpass error',
  carry: 'Overcarry', intercept: 'Intercepted', fumble: 'Fumbled' };
const KO_LABEL    = { wonClean: 'Won clean', wonBreak: 'Won break', lostClean: 'Lost clean',
  lostBreak: 'Lost break', outOfPlay: 'Out of play' };

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
function freshMatch(meta, squadA, benchA) {
  const squadB = Array.from({ length: 15 }, (_, i) => ({ n: i + 1, name: '' }));
  return {
    meta, squadA, benchA, squadB,
    phase: 'pregame', period: 'H1', clock: 0, running: false,
    possession: null, possTime: { A: 0, B: 0 },
    score: { A: { g: 0, two: 0, one: 0 }, B: { g: 0, two: 0, one: 0 } },
    events: []
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
  ['setup', 'live', 'summary'].forEach(s =>
    $('screen-' + s).classList.toggle('active', s === name));
  $('appTag').textContent = (name === 'live' && state)
    ? `${state.meta.aName} v ${state.meta.bName}`
    : 'GAA stats · 2026 rules';
}

/* ============================================================
   SETUP SCREEN
   ============================================================ */
function renderSetup() {
  const t = loadTeams();
  $('aName').value = t.aName;
  $('bName').value = t.bName;
  const wrap = $('rosterA'); wrap.innerHTML = '';
  t.squadA.forEach(p => {
    const row = document.createElement('div'); row.className = 'r';
    row.innerHTML = `<span class="num">${p.n}</span>` +
      `<input data-n="${p.n}" value="${escapeHtml(p.name)}" placeholder="Player ${p.n}" maxlength="18">`;
    wrap.appendChild(row);
  });
  [...$('depthSeg').children].forEach(b => b.classList.toggle('on', b.dataset.d === setupDepth));
  // resume banner
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

function readSetupRoster() {
  return [...$('rosterA').querySelectorAll('input')].map(inp => ({
    n: Number(inp.dataset.n), name: inp.value.trim()
  }));
}

function startMatch() {
  const aName = $('aName').value.trim() || 'Your team';
  const bName = $('bName').value.trim() || 'Opposition';
  const half = Math.max(1, Math.min(45, Number($('halfLen').value) || 30));
  const squadA = readSetupRoster();
  const benchA = loadTeams().benchA || [16, 17, 18, 19, 20, 21];
  saveTeams({ aName, bName, squadA, benchA });
  const meta = { aName, bName, half, depth: setupDepth, ourSide: 'A' };
  state = freshMatch(meta, squadA, benchA);
  undoStack = [];
  saveMatch(); bindLive(); showScreen('live'); render(); startTimer();
}

/* ============================================================
   TIMER
   ============================================================ */
function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!state || !state.running || state.phase !== 'live' || sheetOpen) return;
    state.clock++;
    if (state.possession) state.possTime[state.possession]++;
    renderClock(); renderPoss();
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
function pickPlayer(side, title, cb) {
  const body = $('sheetBody'); body.innerHTML = '';
  const h = document.createElement('div'); h.className = 'sh-title'; h.textContent = title; body.appendChild(h);
  const g = document.createElement('div'); g.className = 'pgrid';
  squad(side).forEach(p => {
    const c = document.createElement('div');
    c.className = 'pcell' + (side === 'B' ? ' b' : '');
    c.innerHTML = `<span class="pn">${p.n}</span>` + (side === 'A' && p.name ? `<span class="pnm">${escapeHtml(p.name)}</span>` : '');
    c.onclick = () => cb(p.n);
    g.appendChild(c);
  });
  body.appendChild(g);
  const c = document.createElement('div'); c.className = 'sh-cancel'; c.textContent = 'Cancel'; c.onclick = closeSheet;
  body.appendChild(c);
  sheetOpen = true; $('overlay').classList.add('show');
}
function pickBench(off) {
  const body = $('sheetBody'); body.innerHTML = '';
  const h = document.createElement('div'); h.className = 'sh-title'; h.textContent = 'Bench player coming ON'; body.appendChild(h);
  const g = document.createElement('div'); g.className = 'pgrid';
  state.benchA.forEach(n => {
    const c = document.createElement('div'); c.className = 'pcell';
    c.innerHTML = `<span class="pn">${n}</span>`;
    c.onclick = () => { pushHistory(); addEvent({ kind: 'sub', side: 'A', off, on: n }); closeSheet(); render(); saveMatch(); };
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
    { label: '2-Point<small>2 pts</small>', cls: 'g', onClick: () => scorePlayer(t, 'two') },
    { label: 'Goal<small>3 pts</small>', cls: 'g', onClick: () => scorePlayer(t, 'g') }
  ], 3, '2-pointer is asked explicitly (on/outside the 40m arc).');
}
function scorePlayer(t, kind) {
  pickPlayer(t, t === 'A' ? 'Who scored?' : 'Scorer — jersey #', n => scoreSource(t, kind, n));
}
function scoreSource(t, kind, n) {
  const mk = src => ({ label: SOURCE_LABEL[src], onClick: () => pickLocation(t, loc => commitScore(t, kind, n, src, loc)) });
  openSheet('Source of score?',
    ['play', 'free', '45', 'mark', 'sideline', 'pen'].map(mk), 3);
}
function commitScore(t, kind, n, source, loc) {
  pushHistory();
  state.score[t][kind]++;
  addEvent({ kind: 'score', side: t, scoreType: kind, source, player: n, loc: loc || null });
  closeSheet(); render(); saveMatch();
  kickout(other(t));
}

/* WIDE / MISS */
function onWide() {
  const t = state.possession;
  const mk = m => ({ label: MISS_LABEL[m], onClick: () => wideWho(t, m) });
  openSheet('Shot missed — type?',
    ['wide', 'short', 'post', 'saved', 'blocked'].map(mk), 2);
}
function wideWho(t, m) {
  if (fullDepth(t)) pickPlayer('A', 'Who shot?', n => pickLocation(t, loc => commitWide(t, m, n, loc)));
  else pickLocation(t, loc => commitWide(t, m, null, loc));
}
function commitWide(t, m, n, loc) {
  pushHistory();
  addEvent({ kind: 'wide', side: t, missType: m, player: n, loc: loc || null });
  closeSheet(); render(); saveMatch();
  kickout(other(t));
}

/* FREE WON */
function onFreeWon() {
  const t = state.possession;
  openSheet('Free won — outcome?', [
    { label: 'Point · 1', cls: 'g', onClick: () => freeScore(t, 'one') },
    { label: '2-Point · 2', cls: 'g', onClick: () => freeScore(t, 'two') },
    { label: 'Goal · 3', cls: 'g', onClick: () => freeScore(t, 'g') },
    { label: 'Wide / miss', onClick: () => { pushHistory(); addEvent({ kind: 'wide', side: t, missType: 'wide', player: null, source: 'free' }); closeSheet(); render(); saveMatch(); kickout(other(t)); } },
    { label: 'Tap &amp; go — keep ball', cls: 'go', onClick: () => tapGo(t) }
  ], 2, 'Solo-and-go keeps possession without a stoppage.');
}
function freeScore(t, kind) {
  pickPlayer(t, t === 'A' ? 'Free taken by?' : 'Free taker — jersey #', n => pickLocation(t, loc => commitScore(t, kind, n, 'free', loc)));
}
function tapGo(t) {
  pushHistory(); addEvent({ kind: 'freeWon', side: t }); state.possession = t;
  closeSheet(); render(); saveMatch();
}

/* FOUL COMMITTED */
function onFoul() {
  const t = state.possession;
  const mk = f => ({ label: FOUL_LABEL[f], onClick: () => foulCard(t, f) });
  openSheet(`Foul by ${teamName(t)} — type?`,
    ['overcarry', 'charge', 'throwball', 'dissent', 'square', 'other'].map(mk), 3);
}
function foulCard(t, f) {
  openSheet('Card?', [
    { label: 'None', onClick: () => commitFoul(t, f, '') },
    { label: 'Yellow', cls: 'go', onClick: () => commitFoul(t, f, 'yellow') },
    { label: 'Black', cls: 'grey', onClick: () => commitFoul(t, f, 'black') },
    { label: 'Red', cls: 'b', onClick: () => commitFoul(t, f, 'red') }
  ], 4);
}
function commitFoul(t, f, card) {
  pushHistory();
  addEvent({ kind: 'foul', side: t, foulType: f, card });
  state.possession = other(t);
  closeSheet(); render(); saveMatch();
}

/* TURNOVER */
function onTurnover() {
  const t = state.possession;
  const mk = to => ({ label: TO_LABEL[to], onClick: () => turnWho(t, to) });
  openSheet('Turnover — how was it lost?',
    ['tackle', 'kick', 'hand', 'carry', 'intercept', 'fumble'].map(mk), 2);
}
function turnWho(t, to) {
  if (fullDepth(t)) pickPlayer('A', 'Who lost it?', n => commitTurn(t, to, n));
  else commitTurn(t, to, null);
}
function commitTurn(t, to, n) {
  pushHistory();
  addEvent({ kind: 'turnover', side: t, toType: to, player: n });
  state.possession = other(t);
  closeSheet(); render(); saveMatch();
}

/* KICKOUT */
function kickout(kt) {
  const ot = other(kt);
  openSheet(`${teamName(kt)} kickout — outcome?`, [
    { label: `Won clean<small>${teamName(kt)}</small>`, cls: kt === 'A' ? 'a' : 'b', onClick: () => commitKO(kt, 'wonClean', kt) },
    { label: `Won break<small>${teamName(kt)}</small>`, cls: kt === 'A' ? 'a' : 'b', onClick: () => commitKO(kt, 'wonBreak', kt) },
    { label: `Lost clean<small>${teamName(ot)}</small>`, cls: ot === 'A' ? 'a' : 'b', onClick: () => commitKO(kt, 'lostClean', ot) },
    { label: `Lost break<small>${teamName(ot)}</small>`, cls: ot === 'A' ? 'a' : 'b', onClick: () => commitKO(kt, 'lostBreak', ot) },
    { label: `Out of play → free ${teamName(ot)}`, onClick: () => commitKO(kt, 'outOfPlay', ot) }
  ], 2, 'Kickout must clear the 40m arc (2026 rules). Winner gets possession.');
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
    { label: state.period === 'H1' ? 'Go to half-time' : 'End match (full time)', onClick: endPeriod },
    { label: state.running ? 'Pause clock' : 'Resume clock', onClick: () => { state.running = !state.running; closeSheet(); render(); saveMatch(); } },
    { label: 'New match (discard)', cls: 'b', onClick: () => { closeSheet(); clearMatch(); state = null; undoStack = []; renderSetup(); showScreen('setup'); } }
  ], 1);
}
function endPeriod() {
  pushHistory();
  if (state.period === 'H1') {
    addEvent({ kind: 'period', note: 'Half-time' });
    state.period = 'H2'; state.running = false;
    state.phase = 'pregame'; state.possession = null;   // H2 restarts with a throw-in
    closeSheet(); render(); saveMatch();
  } else {
    state.running = false; state.phase = 'ended';
    addEvent({ kind: 'period', note: 'Full time' });
    closeSheet(); saveMatch(); showSummary();
  }
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
    case 'foul': return (FOUL_LABEL[ev.foulType] || 'Foul') + (ev.card ? ` · ${ev.card.toUpperCase()} card` : '') + ` → free to ${teamName(other(ev.side))}`;
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
  state.events.slice().reverse().forEach(ev => {
    const row = document.createElement('div'); row.className = 'ev';
    row.innerHTML = `<span class="min">${ev.min}'</span>` +
      `<span class="tag ${tagClass(ev.side)}">${tagFor(ev)}</span>` +
      `<span class="tx">${escapeHtml(feedText(ev))}</span>`;
    f.appendChild(row);
  });
}
function render() {
  if (!state) return;
  bindLive(); renderScore(); renderClock(); renderPoss(); renderContext(); renderFeed();
  $('undoBtn').disabled = undoStack.length === 0;
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
  $('resetTeamsBtn').onclick = () => { saveTeams(defaultTeams()); renderSetup(); };
  [...$('depthSeg').children].forEach(b => b.onclick = () => {
    setupDepth = b.dataset.d;
    [...$('depthSeg').children].forEach(x => x.classList.toggle('on', x === b));
  });
  // live listeners
  $('undoBtn').onclick = undo;
  $('moreBtn').onclick = moreMenu;
  $('pauseBtn').onclick = () => { if (state && state.phase === 'live') { state.running = !state.running; render(); saveMatch(); } };
  $('statsBtn').onclick = () => { if (state) showSummary(); };
  $('scrim').onclick = closeSheet;
  // summary listeners
  $('exportBtn').onclick = exportCSV;
  $('backLiveBtn').onclick = () => showScreen('live');
  $('newMatchBtn').onclick = () => { clearMatch(); state = null; undoStack = []; renderSetup(); showScreen('setup'); };

  // route based on saved match
  const m = loadMatch();
  if (m && m.phase === 'live') { state = m; bindLive(); showScreen('live'); render(); startTimer(); }
  else if (m && m.phase === 'ended') { state = m; bindLive(); showSummary(); startTimer(); }
  else { renderSetup(); showScreen('setup'); startTimer(); }
}

document.addEventListener('DOMContentLoaded', init);
