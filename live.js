/* ============================================================
   SidelineGAA — live-use hardening
   Screen Wake Lock + edit/delete any logged event (with a full
   re-derivation of score & possession from the event log).
   Shares global scope with app.js / stats.js / history.js.
   ============================================================ */

'use strict';

/* ---------- keep the screen awake during a live match ---------- */
let _wakeLock = null;

async function updateWakeLock() {
  try {
    const want = !!(state && state.running && state.phase === 'live');
    const supported = (typeof navigator !== 'undefined') && ('wakeLock' in navigator);
    if (want && !_wakeLock && supported) {
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    } else if (!want && _wakeLock) {
      const w = _wakeLock; _wakeLock = null;
      await w.release();
    }
  } catch (e) {
    _wakeLock = null;   // iOS drops the lock when backgrounded; re-acquired on return
  }
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateWakeLock();
  });
}

/* ---------- re-derive score + possession from the event log ----------
   Lets us safely delete/insert events anywhere in the timeline. */
function recompute() {
  const score = { A: { g: 0, two: 0, one: 0 }, B: { g: 0, two: 0, one: 0 } };
  let possession = null;
  for (const ev of state.events) {
    switch (ev.kind) {
      case 'throwin':  possession = ev.side; break;
      case 'score':    score[ev.side][ev.scoreType]++; break;   // kickout that follows sets possession
      case 'wide':     if (ev.wonBy) possession = ev.wonBy; break; // short/saved/blocked stayed in play
      case 'freeWon':  possession = ev.side; break;
      case 'foul':     possession = other(ev.side); break;
      case 'turnover': possession = other(ev.side); break;
      case 'kickout':  possession = ev.side; break;             // ev.side = winner
      default: break;                                           // wide / sub / period: no effect
    }
  }
  state.score = score;
  if (possession) state.possession = possession;
}

/* ---------- tap a feed row to correct or delete it ---------- */
function editEvent(idx) {
  const ev = state.events[idx];
  if (!ev || state.phase === 'ended') return;

  const canPlayer = (ev.kind === 'score')
    || ((ev.kind === 'wide' || ev.kind === 'turnover') && ev.side === 'A');

  const items = [];
  if (canPlayer) {
    items.push({
      label: ev.kind === 'score' ? 'Change scorer' : 'Change player',
      onClick: () => {
        const title = ev.side === 'A' ? 'Correct player' : 'Correct jersey #';
        pickPlayer(ev.side, title, n => {
          pushHistory();
          ev.player = n;
          saveMatch(); render(); closeSheet();
        });
      }
    });
  }
  items.push({
    label: 'Delete this event',
    cls: 'b',
    onClick: () => {
      pushHistory();
      state.events.splice(idx, 1);
      recompute();
      saveMatch(); render(); closeSheet();
    }
  });

  const desc = feedText(ev).replace(/<[^>]+>/g, '');
  openSheet('Edit event', items, 1, `${ev.min}' · ${tagFor(ev)} — ${desc}`);
}
