"""Python harness for WP-B2, WP-B3, WP-B4 — mirrors analytics.js logic."""

# ── JS helpers ────────────────────────────────────────────────────────────────

def other(t):
    return 'B' if t == 'A' else 'A'

def score_val(e):
    st = e.get('scoreType', 'one')
    return 3 if st == 'g' else (2 if st == 'two' else 1)

def poss_gain_team(e):
    if not e:
        return None
    if e.get('kind') == 'wide' and e.get('wonBy'):
        return e['wonBy']
    if e.get('kind') in ('throwin', 'kickout', 'freeWon'):
        return e.get('side')
    if e.get('kind') in ('turnover', 'foul'):
        return other(e['side'])
    return None

def build_chains(events):
    chains, cur = [], None
    for e in (events or []):
        team = poss_gain_team(e)
        if team is not None:
            if cur:
                cur['end'] = e['clock']
            cur = {'team': team, 'start': e['clock'], 'startKind': e['kind'],
                   'end': e['clock'], 'events': [], 'scored': False, 'scorePts': 0}
            chains.append(cur)
        if cur is None:
            continue
        cur['events'].append(e)
        if e.get('kind') == 'score' and e.get('side') == cur['team']:
            cur['scored'] = True
            cur['scorePts'] += score_val(e)
    return chains

def possession_count(events, side):
    return sum(1 for c in build_chains(events) if c['team'] == side)

def stats_for(events, side):
    """Minimal statsFor: scores, koOwn, koWon, toWon, toLost."""
    s = {'scores': 0, 'koOwn': 0, 'koWon': 0, 'toWon': 0, 'toLost': 0}
    opp = other(side)
    for e in events:
        k = e.get('kind')
        if k == 'score' and e.get('side') == side:
            s['scores'] += 1
        elif k == 'kickout' and e.get('by') == side:
            s['koOwn'] += 1
            if e.get('side') == side:
                s['koWon'] += 1
        elif k == 'turnover':
            if e.get('side') == side:
                s['toLost'] += 1
            elif e.get('side') == opp:
                s['toWon'] += 1
    return s

# ── WP-B2 ─────────────────────────────────────────────────────────────────────

def possession_productivity(events, side):
    poss   = possession_count(events, side)
    scores = stats_for(events, side)['scores']
    per10  = round(scores / poss * 10, 1) if poss else 0.0
    return {'poss': poss, 'per10': per10}

# ── WP-B3 ─────────────────────────────────────────────────────────────────────

def kickout_analytics(events, side):
    sf  = stats_for(events, side)
    opp = other(side)

    retention = round(sf['koWon'] / sf['koOwn'] * 100) if sf['koOwn'] else 0

    opp_ko_total = opp_ko_won = 0
    for e in events:
        if e.get('kind') == 'kickout' and e.get('by') == opp:
            opp_ko_total += 1
            if e.get('side') == side:
                opp_ko_won += 1
    press_win = round(opp_ko_won / opp_ko_total * 100) if opp_ko_total else 0

    chains = build_chains(events)

    ko_won_chains  = [c for c in chains if c['startKind'] == 'kickout' and c['team'] == side]
    ko_won_to_score = (round(sum(1 for c in ko_won_chains if c['scored']) / len(ko_won_chains) * 100)
                       if ko_won_chains else 0)

    ko_lost_chains = [c for c in chains
                      if c['startKind'] == 'kickout' and c['team'] == opp
                      and c['events'] and c['events'][0].get('by') == side]
    ko_lost_to_opp_score = (round(sum(1 for c in ko_lost_chains if c['scored']) / len(ko_lost_chains) * 100)
                             if ko_lost_chains else 0)

    return {'retention': retention, 'pressWin': press_win,
            'koWonToScore': ko_won_to_score, 'koLostToOppScore': ko_lost_to_opp_score}

# ── WP-B4 ─────────────────────────────────────────────────────────────────────

def scoring_runs(events):
    empty = lambda: {'count': 0, 'pts': 0, 'start': 0, 'end': 0}
    best  = {'A': empty(), 'B': empty()}
    cur   = None
    for e in events:
        if e.get('kind') != 'score':
            continue
        val = score_val(e)
        t   = e['side']
        if cur is None or cur['team'] != t:
            cur = {'team': t, 'count': 1, 'pts': val, 'start': e['clock'], 'end': e['clock']}
        else:
            cur['count'] += 1; cur['pts'] += val; cur['end'] = e['clock']
        b = best[t]
        if cur['count'] > b['count'] or (cur['count'] == b['count'] and cur['pts'] > b['pts']):
            best[t] = {'count': cur['count'], 'pts': cur['pts'],
                       'start': cur['start'], 'end': cur['end']}
    return {'longestA': best['A'], 'longestB': best['B']}

def score_timeline(events):
    tot = {'A': 0, 'B': 0}
    tl  = []
    for e in events:
        if e.get('kind') != 'score':
            continue
        tot[e['side']] += score_val(e)
        tl.append({'clock': e['clock'], 'min': e.get('min', 0), 'diff': tot['A'] - tot['B']})
    return tl

# ── test runner ───────────────────────────────────────────────────────────────

passed = failed = 0

def chk(label, actual, expected):
    global passed, failed
    if actual == expected:
        print(f'PASS  {label}')
        passed += 1
    else:
        print(f'FAIL  {label}  got={actual!r}  want={expected!r}')
        failed += 1

def chk_gte(label, actual, floor):
    global passed, failed
    if actual >= floor:
        print(f'PASS  {label}')
        passed += 1
    else:
        print(f'FAIL  {label}  got={actual!r}  want>={floor!r}')
        failed += 1

# ── WP-B2 tests ───────────────────────────────────────────────────────────────
print('=== WP-B2: possessionProductivity ===')

# 6 possession chains for A, 3 scores → per10 = 3/6*10 = 5.0
# Build: 6 throwin events for A (each starts a new chain), with 3 scores peppered in
evs_b2 = []
clock = 0
for i in range(6):
    evs_b2.append({'kind': 'throwin', 'side': 'A', 'clock': clock}); clock += 10
    if i < 3:
        evs_b2.append({'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': clock}); clock += 5

res = possession_productivity(evs_b2, 'A')
chk('poss === 6', res['poss'], 6)
chk('per10 === 5.0', res['per10'], 5.0)

# Guard /0
res0 = possession_productivity([], 'A')
chk('per10 === 0.0 when no possessions', res0['per10'], 0.0)

# 1 possession, 1 score → per10 = 10.0
evs_b2b = [
    {'kind': 'throwin', 'side': 'A', 'clock': 0},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 10},
]
chk('per10 === 10.0 (1/1*10)', possession_productivity(evs_b2b, 'A')['per10'], 10.0)

# ── WP-B3 tests ───────────────────────────────────────────────────────────────
print('\n=== WP-B3: kickoutAnalytics ===')

# Fixture: A kicks off → A wins (retention). A kicks off again → B wins (lost KO) + B scores.
# B kicks → A wins (pressWin).
evs_b3 = [
    # Own KO won by A — A scores in same chain
    {'kind': 'kickout', 'by': 'A', 'side': 'A', 'outcome': 'wonClean', 'clock': 10},
    {'kind': 'score',   'side': 'A', 'scoreType': 'one', 'clock': 20},
    # Own KO lost by A — B wins and scores (vulnerable)
    {'kind': 'kickout', 'by': 'A', 'side': 'B', 'outcome': 'wonClean', 'clock': 30},
    {'kind': 'score',   'side': 'B', 'scoreType': 'one', 'clock': 40},
    # B's KO — A wins (pressure win)
    {'kind': 'kickout', 'by': 'B', 'side': 'A', 'outcome': 'wonClean', 'clock': 50},
]
ka = kickout_analytics(evs_b3, 'A')
chk('retention === 50 (1 won out of 2 own)', ka['retention'], 50)
chk('pressWin === 100 (1/1 opp KOs won)',    ka['pressWin'], 100)
# A won 2 KOs total (own retain + press win); 1 of 2 scored → 50%
chk('koWonToScore === 50 (1 of 2 KO wins scored)', ka['koWonToScore'], 50)
chk('koLostToOppScore === 100 (1 lost, B scored)', ka['koLostToOppScore'], 100)

# Acceptance: single KO won by A + score in same chain → koWonToScore === 100
evs_b3_acc = [
    {'kind': 'kickout', 'by': 'B', 'side': 'A', 'outcome': 'wonClean', 'clock': 10},
    {'kind': 'score',   'side': 'A', 'scoreType': 'one', 'clock': 20},
]
chk('koWonToScore === 100 (acceptance: 1 won, scored)', kickout_analytics(evs_b3_acc, 'A')['koWonToScore'], 100)

# No KOs at all — all zeros
ka0 = kickout_analytics([], 'A')
chk('retention=0 when no KOs', ka0['retention'], 0)
chk('pressWin=0 when no KOs',  ka0['pressWin'],  0)
chk('koWonToScore=0',          ka0['koWonToScore'], 0)
chk('koLostToOppScore=0',      ka0['koLostToOppScore'], 0)

# Won KO but no score in chain → koWonToScore === 0
evs_b3b = [
    {'kind': 'kickout', 'by': 'B', 'side': 'A', 'outcome': 'wonClean', 'clock': 10},
    # possession changes to B before A scores
    {'kind': 'turnover', 'side': 'A', 'clock': 20},  # A loses it
]
ka2 = kickout_analytics(evs_b3b, 'A')
chk('koWonToScore=0 when no score after KO win', ka2['koWonToScore'], 0)

# ── WP-B4 tests ───────────────────────────────────────────────────────────────
print('\n=== WP-B4: scoringRuns ===')

# Acceptance: [score A, score A, score B, score A] → longestA.count=2
evs_b4 = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 10, 'min': 1},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 20, 'min': 2},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 30, 'min': 3},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 40, 'min': 4},
]
runs = scoring_runs(evs_b4)
chk('longestA.count === 2 (first two)',  runs['longestA']['count'], 2)
chk('longestB.count === 1',              runs['longestB']['count'], 1)
chk('longestA.pts === 2',               runs['longestA']['pts'], 2)

# A run of 3 beats earlier run of 2
evs_b4b = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 10, 'min': 1},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 20, 'min': 2},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 30, 'min': 3},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 40, 'min': 4},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 50, 'min': 5},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 60, 'min': 6},
]
runs2 = scoring_runs(evs_b4b)
chk('longestA.count === 3 (second run)', runs2['longestA']['count'], 3)

# Goal counts more pts — tie on count but goal run wins on pts
evs_b4c = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 10, 'min': 1},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 20, 'min': 2},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 30, 'min': 3},
    {'kind': 'score', 'side': 'A', 'scoreType': 'g',   'clock': 40, 'min': 4},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 50, 'min': 5},
]
runs3 = scoring_runs(evs_b4c)
chk('longestA.count=2 (tied runs)', runs3['longestA']['count'], 2)
chk('longestA.pts=4 (goal+point wins tie)', runs3['longestA']['pts'], 4)

print('\n=== WP-B4: scoreTimeline ===')

tl = score_timeline(evs_b4)
chk('timeline length === 4', len(tl), 4)
chk('timeline[0].diff === 1  (A leads 1-0)', tl[0]['diff'], 1)
chk('timeline[1].diff === 2  (A leads 2-0)', tl[1]['diff'], 2)
chk('timeline[2].diff === 1  (A leads 2-1)', tl[2]['diff'], 1)
chk('timeline[3].diff === 2  (A 3 - B 1)',   tl[3]['diff'], 2)

# Goal in timeline
tl_g = score_timeline([
    {'kind': 'score', 'side': 'A', 'scoreType': 'g',   'clock': 5,  'min': 1},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 10, 'min': 2},
])
chk('goal worth 3 in diff', tl_g[0]['diff'], 3)
chk('B point brings diff to 2', tl_g[1]['diff'], 2)

# Non-score events are ignored
tl_mixed = score_timeline([
    {'kind': 'throwin', 'side': 'A', 'clock': 1, 'min': 0},
    {'kind': 'score',   'side': 'A', 'scoreType': 'one', 'clock': 5, 'min': 1},
    {'kind': 'wide',    'side': 'B', 'clock': 8, 'min': 1},
])
chk('non-score events ignored (length=1)', len(tl_mixed), 1)

print(f'\n{passed} passed, {failed} failed')
exit(1 if failed else 0)
