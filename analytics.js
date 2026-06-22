// analytics.js — pure derived-stats module. No DOM, no state mutation, no score/possession changes.
// Everything here takes an events array (or `state`) and RETURNS data. Safe to unit-test in Node.

/* Which team GAINED possession at event `e`, or null.
   Mirrors detail.js `_possGain` but also handles in-play misses (wide.wonBy). */
function possGainTeam(e) {
  if (!e) return null;
  if (e.kind === 'wide' && e.wonBy) return e.wonBy;
  if (e.kind === 'throwin' || e.kind === 'kickout' || e.kind === 'freeWon') return e.side;
  if (e.kind === 'turnover' || e.kind === 'foul') return other(e.side);
  return null;
}

/* Point value of a score event (point=1, two-pointer=2, goal=3). */
function _scoreVal(e) {
  return e.scoreType === 'g' ? 3 : e.scoreType === 'two' ? 2 : 1;
}

/* Walk the event log into possession chains. A new chain opens whenever a team
   GAINS possession (possGainTeam non-null); the prior chain closes at that clock.
   score/wide events have no possGain, so they stay inside the current chain —
   that's what lets turnover→score and kickout→score windows be derived. */
function buildChains(events) {
  const chains = [];
  let cur = null;
  (events || []).forEach((e) => {
    const team = possGainTeam(e);
    if (team != null) {
      if (cur) cur.end = e.clock;
      cur = { team, start: e.clock, startKind: e.kind, end: e.clock, events: [], scored: false, scorePts: 0 };
      chains.push(cur);
    }
    if (!cur) return; // events before the first possession-gain (shouldn't normally happen)
    cur.events.push(e);
    if (e.kind === 'score' && e.side === cur.team) {
      cur.scored = true;
      cur.scorePts += _scoreVal(e);
    }
  });
  return chains;
}

/* How many possession chains a given side owned. */
function possessionCount(events, side) {
  return buildChains(events).filter((c) => c.team === side).length;
}

/* Transition (turnover→attack) stats for one side.
   Returns { toScores, toPts, toRate, vulnRate, transSpeed }.
   Uses state.events and statsFor() — call after a match is loaded. */
function transitionStats(side) {
  const evs = state.events;
  const opp = other(side);

  // Scores by side where the most-recent prior possession-gain was a turnover
  // won by side within 60 s.
  let toScores = 0, toPts = 0;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.kind !== 'score' || e.side !== side) continue;
    for (let j = i - 1; j >= 0; j--) {
      const g = possGainTeam(evs[j]);
      if (g == null) continue;
      if (g === side && evs[j].kind === 'turnover' && (e.clock - evs[j].clock) <= 60) {
        toScores++;
        toPts += _scoreVal(e);
      }
      break;
    }
  }

  // Scores by opp where the most-recent prior possession-gain was a turnover lost by side
  // within 60 s (vulnerability rate).
  let vulnScores = 0;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.kind !== 'score' || e.side !== opp) continue;
    for (let j = i - 1; j >= 0; j--) {
      const g = possGainTeam(evs[j]);
      if (g == null) continue;
      if (g === opp && evs[j].kind === 'turnover' && evs[j].side === side && (e.clock - evs[j].clock) <= 60) {
        vulnScores++;
      }
      break;
    }
  }

  // Mean seconds from each turnover won by side to the next score|wide by side
  // (stops counting if possession is lost before the shot).
  let speedSum = 0, speedCount = 0;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.kind !== 'turnover' || e.side !== opp) continue; // opp lost it → side won it
    for (let j = i + 1; j < evs.length; j++) {
      const f = evs[j];
      if ((f.kind === 'score' || f.kind === 'wide') && f.side === side) {
        speedSum += f.clock - e.clock;
        speedCount++;
        break;
      }
      const g = possGainTeam(f);
      if (g != null && g !== side) break; // possession changed away before a shot
    }
  }

  const sf = statsFor(side);
  return {
    toScores,
    toPts,
    toRate:    sf.toWon  ? Math.round(toScores   / sf.toWon  * 100) : 0,
    vulnRate:  sf.toLost ? Math.round(vulnScores  / sf.toLost * 100) : 0,
    transSpeed: speedCount ? Math.round(speedSum / speedCount) : 0,
  };
}

/* Possession productivity for one side.
   Returns { poss, per10 } — scores per 10 possessions, 1 dp. */
function possessionProductivity(side) {
  const poss   = possessionCount(state.events, side);
  const scores = statsFor(side).scores;
  const per10  = poss ? Math.round(scores / poss * 10 * 10) / 10 : 0;
  return { poss, per10 };
}

/* Kickout analytics for one side.
   Returns { retention, pressWin, koWonToScore, koLostToOppScore } — all as %.
   retention       = own KOs won / own KOs total.
   pressWin        = opp KOs won by side / opp KOs total.
   koWonToScore    = KOs won by side where side scored in that chain (%).
   koLostToOppScore = side's own KOs lost where opp scored in that chain (%). */
function kickoutAnalytics(side) {
  const sf  = statsFor(side);
  const opp = other(side);

  const retention = sf.koOwn ? Math.round(sf.koWon / sf.koOwn * 100) : 0;

  let oppKOTotal = 0, oppKOWon = 0;
  state.events.forEach((e) => {
    if (e.kind !== 'kickout' || e.by !== opp) return;
    oppKOTotal++;
    if (e.side === side) oppKOWon++;
  });
  const pressWin = oppKOTotal ? Math.round(oppKOWon / oppKOTotal * 100) : 0;

  const chains = buildChains(state.events);

  // Chains that started when side won a kickout.
  const koWonChains = chains.filter((c) => c.startKind === 'kickout' && c.team === side);
  const koWonToScore = koWonChains.length
    ? Math.round(koWonChains.filter((c) => c.scored).length / koWonChains.length * 100)
    : 0;

  // Chains that started when opp won a kickout that side had kicked (lost KOs).
  const koLostChains = chains.filter((c) =>
    c.startKind === 'kickout' && c.team === opp &&
    c.events[0] && c.events[0].by === side
  );
  const koLostToOppScore = koLostChains.length
    ? Math.round(koLostChains.filter((c) => c.scored).length / koLostChains.length * 100)
    : 0;

  return { retention, pressWin, koWonToScore, koLostToOppScore };
}

/* Longest unbroken scoring run for each team (no opponent score between).
   Returns { longestA, longestB } where each is { count, pts, start, end }. */
function scoringRuns() {
  const empty = () => ({ count: 0, pts: 0, start: 0, end: 0 });
  const best  = { A: empty(), B: empty() };
  let cur     = null;

  state.events.forEach((e) => {
    if (e.kind !== 'score') return;
    const val = _scoreVal(e);
    if (!cur || cur.team !== e.side) {
      cur = { team: e.side, count: 1, pts: val, start: e.clock, end: e.clock };
    } else {
      cur.count++; cur.pts += val; cur.end = e.clock;
    }
    const b = best[cur.team];
    if (cur.count > b.count || (cur.count === b.count && cur.pts > b.pts)) {
      best[cur.team] = { count: cur.count, pts: cur.pts, start: cur.start, end: cur.end };
    }
  });

  return { longestA: best.A, longestB: best.B };
}

/* Cumulative score differential at every score event (A − B in points).
   Returns [{ clock, min, diff }]. */
function scoreTimeline() {
  const tot = { A: 0, B: 0 };
  const timeline = [];
  state.events.forEach((e) => {
    if (e.kind !== 'score') return;
    tot[e.side] += _scoreVal(e);
    timeline.push({ clock: e.clock, min: e.min, diff: tot.A - tot.B });
  });
  return timeline;
}

/* Points the opposition scored directly from frees conceded by side.
   Counts each score by other(side) whose source is 'free'|'45'|'pen' where
   the most-recent prior possession-gain was a foul by side.
   Returns { frees, pts }. */
function foulCost(side) {
  const evs  = state.events;
  const opp  = other(side);
  const dead = new Set(['free', '45', 'pen']);
  let frees  = 0, pts = 0;

  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.kind !== 'score' || e.side !== opp || !dead.has(e.source)) continue;
    for (let j = i - 1; j >= 0; j--) {
      const g = possGainTeam(evs[j]);
      if (g == null) continue;
      if (evs[j].kind === 'foul' && evs[j].side === side) {
        frees++;
        pts += _scoreVal(e);
      }
      break;
    }
  }
  return { frees, pts };
}

/* Shooting analysis for one side.
   Returns { zones: { in20, mid, beyond }, sourceDist }.
   Each zone: { shots, scores, wides, conv, wideRate } (conv/wideRate as %).
   sourceDist keyed by source string: { shots, scores, conv }. */
function shootingBreakdown(side) {
  const mkz  = () => ({ shots: 0, scores: 0, wides: 0 });
  const zones = { in20: mkz(), mid: mkz(), beyond: mkz() };
  const srcs  = {};

  state.events.forEach((e) => {
    if (e.side !== side || (e.kind !== 'score' && e.kind !== 'wide')) return;

    if (e.loc) {
      const zk = e.loc.y < 0.31 ? 'in20' : e.loc.y < 0.62 ? 'mid' : 'beyond';
      const z  = zones[zk];
      z.shots++;
      if (e.kind === 'score') z.scores++; else z.wides++;
    }

    const src = e.source || 'play';
    if (!srcs[src]) srcs[src] = { shots: 0, scores: 0 };
    srcs[src].shots++;
    if (e.kind === 'score') srcs[src].scores++;
  });

  const pct = (n, d) => d ? Math.round(n / d * 100) : 0;
  const zoneResult = {};
  Object.entries(zones).forEach(([k, z]) => {
    zoneResult[k] = { ...z, conv: pct(z.scores, z.shots), wideRate: pct(z.wides, z.shots) };
  });
  const sourceResult = {};
  Object.entries(srcs).forEach(([k, s]) => {
    sourceResult[k] = { ...s, conv: pct(s.scores, s.shots) };
  });

  return { zones: zoneResult, sourceDist: sourceResult };
}

/* Breaks down turnover-to-score conversions by the turnover's toType.
   Returns an object keyed by toType: { won, scored, rate }.
   won   = total turnovers of that type won by side.
   scored = of those, how many resulted in a score within 60 s. */
function transitionTypes(side) {
  const evs    = state.events;
  const byType = {};

  evs.forEach((e) => {
    if (e.kind !== 'turnover' || other(e.side) !== side) return;
    const t = e.toType || 'unknown';
    if (!byType[t]) byType[t] = { won: 0, scored: 0 };
    byType[t].won++;
  });

  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.kind !== 'score' || e.side !== side) continue;
    for (let j = i - 1; j >= 0; j--) {
      const g = possGainTeam(evs[j]);
      if (g == null) continue;
      if (g === side && evs[j].kind === 'turnover' && (e.clock - evs[j].clock) <= 60) {
        const t = evs[j].toType || 'unknown';
        if (byType[t]) byType[t].scored++;
      }
      break;
    }
  }

  const result = {};
  Object.entries(byType).forEach(([k, v]) => {
    result[k] = { won: v.won, scored: v.scored, rate: Math.round(v.scored / v.won * 100) };
  });
  return result;
}

/* Longest scoring drought (seconds) between consecutive scores per team.
   The first drought is measured from the first event's clock.
   Returns { A, B } in seconds (0 if the team never scored). */
function droughts() {
  const firstClock = state.events.length ? state.events[0].clock : 0;
  const result     = { A: 0, B: 0 };

  ['A', 'B'].forEach((side) => {
    const scores = state.events.filter((e) => e.kind === 'score' && e.side === side);
    if (!scores.length) return;
    let prev = firstClock, max = 0;
    scores.forEach((e) => {
      const gap = e.clock - prev;
      if (gap > max) max = gap;
      prev = e.clock;
    });
    result[side] = max;
  });
  return result;
}

/* Per-player stats for one side.
   Returns map of jersey → { pts, shots, scores, conv, wides, toLost, toWon,
     foulsCommitted, freesWon, oppCreated, minutes }.
   minutes: side A only (uses state.onFieldA + sub events); always 0 for B.
   toWon / freesWon / oppCreated require schema extensions not yet recorded
   per-player — they are included as 0 placeholders. */
function playerStats(side) {
  const map = {};
  const get = (n) => map[n] || (map[n] = {
    pts: 0, shots: 0, scores: 0, wides: 0,
    toLost: 0, toWon: 0, foulsCommitted: 0, freesWon: 0, oppCreated: 0, minutes: 0,
  });

  state.events.forEach((e) => {
    if (e.player == null || e.side !== side) return;
    const p = get(e.player);
    if (e.kind === 'score') {
      p.shots++; p.scores++; p.pts += _scoreVal(e);
    } else if (e.kind === 'wide') {
      p.shots++; p.wides++;
    } else if (e.kind === 'turnover') {
      p.toLost++;
    } else if (e.kind === 'foul') {
      p.foulsCommitted++;
    }
  });

  // conv %
  Object.values(map).forEach((p) => { p.conv = p.shots ? Math.round(p.scores / p.shots * 100) : 0; });

  // minutes — only tracked for team A via onFieldA + sub events
  if (side === 'A') {
    const startTime = {};
    const onField   = new Set(state.onFieldA || []);
    onField.forEach((n) => { startTime[n] = 0; get(n); });

    state.events.forEach((e) => {
      if (e.kind !== 'sub' || e.side !== 'A') return;
      if (e.off != null && startTime[e.off] != null) {
        get(e.off).minutes += (e.clock - startTime[e.off]) / 60;
        delete startTime[e.off];
        onField.delete(e.off);
      }
      if (e.on != null) {
        startTime[e.on] = e.clock;
        onField.add(e.on);
        get(e.on);
      }
    });

    const cap = state.clock || 0;
    onField.forEach((n) => {
      if (startTime[n] != null) get(n).minutes += (cap - startTime[n]) / 60;
    });

    Object.values(map).forEach((p) => { p.minutes = Math.round(p.minutes * 10) / 10; });
  }

  return map;
}

/* Fouls by side grouped into pitch zones using stored loc.
   Returns { in20, mid, beyond, unknown } counts.
   Requires D1: loc stored on foul events by the updated foul-commit flows. */
function foulZones(side) {
  const z = { in20: 0, mid: 0, beyond: 0, unknown: 0 };
  state.events.forEach((e) => {
    if (e.kind !== 'foul' || e.side !== side) return;
    if (!e.loc) { z.unknown++; return; }
    z[e.loc.y < 0.31 ? 'in20' : e.loc.y < 0.62 ? 'mid' : 'beyond']++;
  });
  return z;
}

/* Sideline-ball outcomes derived from outOfPlay kickout events.
   Returns { total, wonByA, wonByB } counting what happened to possession
   after each kickout that went out of play. */
function sidelineStats() {
  const evs = state.events;
  let total = 0, wonByA = 0, wonByB = 0;

  evs.forEach((e, i) => {
    if (e.kind !== 'kickout' || e.outcome !== 'outOfPlay') return;
    total++;
    for (let j = i + 1; j < evs.length; j++) {
      const g = possGainTeam(evs[j]);
      if (g !== null) { if (g === 'A') wonByA++; else wonByB++; break; }
    }
  });
  return { total, wonByA, wonByB };
}

/* Season-level aggregation across all archived matches.
   Temporarily swaps state per match; restores on exit.
   Returns { matches, players: { jersey → { pts, shots, scores, conv, minutes } },
             avgTransitionRate, avgKoRetention, avgPer10 }
   or null if the archive is empty. */
function seasonAnalytics() {
  const archive = (typeof loadArchive === 'function') ? loadArchive() : [];
  if (!archive.length) return null;

  const saved = state;
  const agg   = {
    matches: archive.length,
    players: {},
    _trans: [], _ko: [], _poss: [],
  };

  try {
    archive.forEach((m) => {
      state = m;
      const pm = playerStats('A');
      Object.entries(pm).forEach(([jersey, p]) => {
        const ap = agg.players[jersey] || (agg.players[jersey] = { pts: 0, shots: 0, scores: 0, minutes: 0 });
        ap.pts     += p.pts;
        ap.shots   += p.shots;
        ap.scores  += p.scores;
        ap.minutes += Math.round(p.minutes * 10) / 10;
      });
      agg._trans.push(transitionStats('A').toRate);
      agg._ko.push(kickoutAnalytics('A').retention);
      agg._poss.push(possessionProductivity('A').per10);
    });
  } finally {
    state = saved;
  }

  const avg = (arr) => arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : 0;
  Object.values(agg.players).forEach((p) => {
    p.conv    = p.shots ? Math.round(p.scores / p.shots * 100) : 0;
    p.minutes = Math.round(p.minutes * 10) / 10;
  });
  return {
    matches:          agg.matches,
    players:          agg.players,
    avgTransitionRate: avg(agg._trans),
    avgKoRetention:    avg(agg._ko),
    avgPer10:          avg(agg._poss),
  };
}

/* Seed xP values per zone (can be updated as data accrues). */
const ZONE_XP = { in20: 0.72, mid: 0.52, beyond: 0.28 };

/* Expected points for all located shots by side. */
function expectedPoints(side) {
  let xP = 0;
  state.events.forEach((e) => {
    if (e.side !== side || !e.loc || (e.kind !== 'score' && e.kind !== 'wide')) return;
    const base = ZONE_XP[e.loc.y < 0.31 ? 'in20' : e.loc.y < 0.62 ? 'mid' : 'beyond'] || 0;
    xP += (e.scoreType === 'two') ? base * 2 : base;
  });
  return Math.round(xP * 10) / 10;
}

/* Performance Above Expectation: actual points minus xP.
   Only located shots contribute to xP; unlocated shots are not penalised. */
function PAE(side) {
  let actualPts = 0;
  state.events.forEach((e) => { if (e.kind === 'score' && e.side === side) actualPts += _scoreVal(e); });
  return Math.round((actualPts - expectedPoints(side)) * 10) / 10;
}

/* 2-point scoring Efficiency Index per zone.
   EI = (2-pt conv% × 2) / ZONE_XP.  Conv% uses only 2-pt scores & 2-pt wides
   (wide events with scoreType 'two') as numerator/denominator where available.
   Falls back to all shots in the zone when no explicit 2-pt misses are tagged. */
function twoPtEfficiency(side) {
  const z = { in20: { two: 0, sc: 0 }, mid: { two: 0, sc: 0 }, beyond: { two: 0, sc: 0 } };
  state.events.forEach((e) => {
    if (e.side !== side || !e.loc) return;
    if (e.kind === 'score' && e.scoreType === 'two') {
      const zk = e.loc.y < 0.31 ? 'in20' : e.loc.y < 0.62 ? 'mid' : 'beyond';
      z[zk].two++; z[zk].sc++;
    } else if (e.kind === 'wide' && e.scoreType === 'two') {
      const zk = e.loc.y < 0.31 ? 'in20' : e.loc.y < 0.62 ? 'mid' : 'beyond';
      z[zk].two++;
    }
  });
  const result = {};
  Object.entries(z).forEach(([k, v]) => {
    const conv = v.two ? v.sc / v.two : 0;
    result[k] = { attempts: v.two, scored: v.sc, ei: v.two ? Math.round(conv * 2 / ZONE_XP[k] * 100) / 100 : null };
  });
  return result;
}

/* Scores by side in a clock window (inclusive). */
function scoresInWindow(side, fromClock, toClock) {
  return state.events.filter((e) => e.kind === 'score' && e.side === side && e.clock >= fromClock && e.clock <= toClock);
}

/* Impact of black cards: opposition scoring during each 10-min sin-bin vs their per-10 baseline.
   Returns array of { side (sinned team), player, inWindow, baseline }. */
function blackCardImpact() {
  const bins     = state.sinBins || [];
  const allEvs   = state.events;
  const maxClock = allEvs.length ? allEvs[allEvs.length - 1].clock : 0;

  return bins.map((b) => {
    const opp      = other(b.side);
    const winStart = b.until - 600;
    const inWindow = scoresInWindow(opp, winStart, b.until).length;
    const total    = allEvs.filter((e) => e.kind === 'score' && e.side === opp).length;
    const baseline = maxClock ? Math.round(total / maxClock * 600 * 10) / 10 : 0;
    return { side: b.side, player: b.player, inWindow, baseline };
  });
}

/* Scoring rate (count) 10 min before and after each team-A substitution. */
function subImpact() {
  return state.events
    .filter((e) => e.kind === 'sub' && e.side === 'A')
    .map((s) => ({
      off:         s.off,
      on:          s.on,
      clock:       s.clock,
      scoreBefore: scoresInWindow('A', s.clock - 600, s.clock).length,
      scoreAfter:  scoresInWindow('A', s.clock,       s.clock + 600).length,
    }));
}

/* Scoring rate when trailing by ≥3 pts vs otherwise.
   Returns { pressureScores, normalScores }. */
function pressureRate(side) {
  const tl = scoreTimeline();
  let pressureScores = 0, normalScores = 0;

  state.events.forEach((e) => {
    if (e.kind !== 'score' || e.side !== side) return;
    // Diff just before this score: last timeline entry with clock < e.clock
    const prev = tl.filter((p) => p.clock < e.clock);
    const diff = prev.length ? prev[prev.length - 1].diff : 0;
    const trailing = side === 'A' ? diff <= -3 : diff >= 3;
    if (trailing) pressureScores++; else normalScores++;
  });
  return { pressureScores, normalScores };
}

/* Shooting conversion in the final 10 min of normal time vs full game.
   Uses state.meta.halfLen (minutes) to derive game end; defaults to 60 min. */
function lateGame(side) {
  const halfSecs = ((state.meta && state.meta.halfLen) || 30) * 60;
  const lateStart = halfSecs * 2 - 600;

  let lateShots = 0, lateScores = 0, totalShots = 0, totalScores = 0;
  state.events.forEach((e) => {
    if ((e.kind !== 'score' && e.kind !== 'wide') || e.side !== side) return;
    totalShots++;
    if (e.kind === 'score') totalScores++;
    if (e.clock >= lateStart) { lateShots++; if (e.kind === 'score') lateScores++; }
  });
  return {
    lateShots, lateScores,
    lateConv:  lateShots  ? Math.round(lateScores  / lateShots  * 100) : 0,
    totalConv: totalShots ? Math.round(totalScores / totalShots * 100) : 0,
  };
}

/* Possession split per time block, derived from chain durations.
   Each chain is assigned to the block containing its start time.
   Returns [{ block, aPct, bPct }] sorted by block number. */
function possessionByBlock(blockSecs = 600) {
  const chains = buildChains(state.events);
  const blocks = {}; // blockNum → { A: 0, B: 0 }

  chains.forEach((c) => {
    if (c.end === c.start) return; // zero-duration chain contributes nothing
    const bn = Math.floor(c.start / blockSecs);
    if (!blocks[bn]) blocks[bn] = { A: 0, B: 0 };
    blocks[bn][c.team] += c.end - c.start;
  });

  return Object.keys(blocks).sort((a, b) => a - b).map((k) => {
    const b     = blocks[k];
    const total = b.A + b.B;
    return {
      block: Number(k),
      aPct:  total ? Math.round(b.A / total * 100) : 50,
      bPct:  total ? Math.round(b.B / total * 100) : 50,
    };
  });
}
