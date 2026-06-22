"""Python harness for WP-D1, D2, E1, E2, E3 and WP-F1 structural checks."""
import os, re

PWA = r"C:\Users\gearo\Documents\GAA Stats App Experiment\SidelineGAA-PWA"

# ── shared helpers ────────────────────────────────────────────────────────────

def other(t): return 'B' if t == 'A' else 'A'

def score_val(e):
    st = e.get('scoreType', 'one')
    return 3 if st == 'g' else (2 if st == 'two' else 1)

def poss_gain_team(e):
    if not e: return None
    if e.get('kind') == 'wide' and e.get('wonBy'): return e['wonBy']
    if e.get('kind') in ('throwin', 'kickout', 'freeWon'): return e.get('side')
    if e.get('kind') in ('turnover', 'foul'): return other(e['side'])
    return None

def build_chains(events):
    chains, cur = [], None
    for e in (events or []):
        team = poss_gain_team(e)
        if team is not None:
            if cur: cur['end'] = e['clock']
            cur = {'team': team, 'start': e['clock'], 'startKind': e['kind'],
                   'end': e['clock'], 'events': [], 'scored': False, 'scorePts': 0}
            chains.append(cur)
        if cur is None: continue
        cur['events'].append(e)
        if e.get('kind') == 'score' and e.get('side') == cur['team']:
            cur['scored'] = True; cur['scorePts'] += score_val(e)
    return chains

def possession_count(events, side):
    return sum(1 for c in build_chains(events) if c['team'] == side)

def stats_for(events, side):
    s = {'scores': 0, 'koOwn': 0, 'koWon': 0, 'toWon': 0, 'toLost': 0}
    for e in events:
        k = e.get('kind')
        if k == 'score' and e.get('side') == side: s['scores'] += 1
        elif k == 'kickout' and e.get('by') == side:
            s['koOwn'] += 1
            if e.get('side') == side: s['koWon'] += 1
        elif k == 'turnover':
            if e.get('side') == side: s['toLost'] += 1
            elif e.get('side') == other(side): s['toWon'] += 1
    return s

def score_timeline(events):
    tot = {'A': 0, 'B': 0}; tl = []
    for e in events:
        if e.get('kind') != 'score': continue
        tot[e['side']] += score_val(e)
        tl.append({'clock': e['clock'], 'diff': tot['A'] - tot['B']})
    return tl

# ── WP-D1: foulZones ─────────────────────────────────────────────────────────

def foul_zones(events, side):
    z = {'in20': 0, 'mid': 0, 'beyond': 0, 'unknown': 0}
    for e in events:
        if e.get('kind') != 'foul' or e.get('side') != side: continue
        loc = e.get('loc')
        if not loc: z['unknown'] += 1; continue
        z['in20' if loc['y'] < 0.31 else ('mid' if loc['y'] < 0.62 else 'beyond')] += 1
    return z

# ── WP-D2: sidelineStats ─────────────────────────────────────────────────────

def sideline_stats(events):
    total = won_a = won_b = 0
    for i, e in enumerate(events):
        if e.get('kind') != 'kickout' or e.get('outcome') != 'outOfPlay': continue
        total += 1
        for j in range(i + 1, len(events)):
            g = poss_gain_team(events[j])
            if g is not None:
                if g == 'A': won_a += 1
                else: won_b += 1
                break
    return {'total': total, 'wonByA': won_a, 'wonByB': won_b}

# ── WP-E1: seasonAnalytics (offline simulation) ───────────────────────────────

def player_stats_for_match(m_events, on_field_a, clock):
    map_ = {}
    def get(n):
        if n not in map_:
            map_[n] = {'pts': 0, 'shots': 0, 'scores': 0, 'minutes': 0}
        return map_[n]
    for e in m_events:
        if e.get('player') is None or e.get('side') != 'A': continue
        p = get(e['player'])
        if e['kind'] == 'score': p['shots'] += 1; p['scores'] += 1; p['pts'] += score_val(e)
        elif e['kind'] == 'wide': p['shots'] += 1
    # minutes
    start_time = {n: 0 for n in (on_field_a or [])}
    on_field = set(on_field_a or [])
    for n in on_field: get(n)
    for e in m_events:
        if e.get('kind') != 'sub' or e.get('side') != 'A': continue
        off, on = e.get('off'), e.get('on')
        if off is not None and off in start_time:
            get(off)['minutes'] += (e['clock'] - start_time[off]) / 60
            del start_time[off]; on_field.discard(off)
        if on is not None:
            start_time[on] = e['clock']; on_field.add(on); get(on)
    for n in on_field:
        if n in start_time: get(n)['minutes'] += (clock - start_time[n]) / 60
    for p in map_.values(): p['minutes'] = round(p['minutes'] * 10) / 10
    return map_

def season_analytics(archive):
    if not archive: return None
    agg_players = {}
    for m in archive:
        pm = player_stats_for_match(m['events'], m.get('onFieldA', []), m.get('clock', 0))
        for jersey, p in pm.items():
            ap = agg_players.setdefault(jersey, {'pts': 0, 'shots': 0, 'scores': 0, 'minutes': 0.0})
            ap['pts']     += p['pts']
            ap['shots']   += p['shots']
            ap['scores']  += p['scores']
            ap['minutes'] += p['minutes']
    for p in agg_players.values():
        p['conv'] = round(p['scores'] / p['shots'] * 100) if p['shots'] else 0
        p['minutes'] = round(p['minutes'] * 10) / 10
    return {'matches': len(archive), 'players': agg_players}

# ── WP-E2: expectedPoints / PAE ───────────────────────────────────────────────

ZONE_XP = {'in20': 0.72, 'mid': 0.52, 'beyond': 0.28}

def expected_points(events, side):
    xP = 0.0
    for e in events:
        if e.get('side') != side or not e.get('loc') or e.get('kind') not in ('score', 'wide'): continue
        loc = e['loc']
        zk = 'in20' if loc['y'] < 0.31 else ('mid' if loc['y'] < 0.62 else 'beyond')
        base = ZONE_XP[zk]
        xP += base * 2 if e.get('scoreType') == 'two' else base
    return round(xP * 10) / 10

def pae(events, side):
    actual = sum(score_val(e) for e in events if e.get('kind') == 'score' and e.get('side') == side)
    return round((actual - expected_points(events, side)) * 10) / 10

# ── WP-E3: window metrics ─────────────────────────────────────────────────────

def scores_in_window(events, side, from_clock, to_clock):
    return [e for e in events if e.get('kind') == 'score' and e.get('side') == side
            and e.get('clock', -1) >= from_clock and e.get('clock', -1) <= to_clock]

def black_card_impact(events, sin_bins):
    all_clocks = [e['clock'] for e in events if e.get('clock') is not None]
    max_clock = max(all_clocks) if all_clocks else 0
    result = []
    for b in sin_bins:
        opp = other(b['side'])
        win_start = b['until'] - 600
        in_win = len(scores_in_window(events, opp, win_start, b['until']))
        total  = sum(1 for e in events if e.get('kind') == 'score' and e.get('side') == opp)
        baseline = round(total / max_clock * 600 * 10) / 10 if max_clock else 0
        result.append({'side': b['side'], 'player': b.get('player'), 'inWindow': in_win, 'baseline': baseline})
    return result

def sub_impact(events):
    return [{'off': s.get('off'), 'on': s.get('on'), 'clock': s['clock'],
             'scoreBefore': len(scores_in_window(events, 'A', s['clock'] - 600, s['clock'])),
             'scoreAfter':  len(scores_in_window(events, 'A', s['clock'],       s['clock'] + 600))}
            for s in events if s.get('kind') == 'sub' and s.get('side') == 'A']

def pressure_rate(events, side):
    tl = score_timeline(events)
    pressure, normal = 0, 0
    for e in events:
        if e.get('kind') != 'score' or e.get('side') != side: continue
        prev = [p for p in tl if p['clock'] < e['clock']]
        diff = prev[-1]['diff'] if prev else 0
        trailing = diff <= -3 if side == 'A' else diff >= 3
        if trailing: pressure += 1
        else: normal += 1
    return {'pressureScores': pressure, 'normalScores': normal}

def late_game(events, meta_half_len=30, side='A'):
    half_secs = meta_half_len * 60
    late_start = half_secs * 2 - 600
    late_shots = late_scores = total_shots = total_scores = 0
    for e in events:
        if e.get('kind') not in ('score', 'wide') or e.get('side') != side: continue
        total_shots += 1
        if e['kind'] == 'score': total_scores += 1
        if e.get('clock', 0) >= late_start:
            late_shots += 1
            if e['kind'] == 'score': late_scores += 1
    return {
        'lateShots': late_shots, 'lateScores': late_scores,
        'lateConv':  round(late_scores / late_shots * 100) if late_shots else 0,
        'totalConv': round(total_scores / total_shots * 100) if total_shots else 0,
    }

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

def chk_close(label, actual, expected, tol=0.2):
    global passed, failed
    if abs(actual - expected) <= tol:
        print(f'PASS  {label}')
        passed += 1
    else:
        print(f'FAIL  {label}  got={actual!r}  want≈{expected!r} ±{tol}')
        failed += 1

def chk_sign(label, value, positive):
    global passed, failed
    ok = value > 0 if positive else value < 0
    if ok:
        print(f'PASS  {label}')
        passed += 1
    else:
        print(f'FAIL  {label}  got={value!r}  want {"positive" if positive else "negative"}')
        failed += 1

# ── WP-D1: foulZones ─────────────────────────────────────────────────────────
print('=== WP-D1: foulZones ===')

evs_d1 = [
    {'kind': 'foul', 'side': 'A', 'foulType': 'tackle', 'card': '',
     'loc': {'x': .5, 'y': .15}},   # inside-20 (y<0.31)
    {'kind': 'foul', 'side': 'A', 'foulType': 'hold', 'card': '',
     'loc': {'x': .4, 'y': .45}},   # mid
    {'kind': 'foul', 'side': 'A', 'foulType': 'overcarry', 'card': ''},  # no loc
    {'kind': 'foul', 'side': 'B', 'foulType': 'tackle', 'card': '',
     'loc': {'x': .5, 'y': .7}},    # B's foul — should NOT count for A
]
fz = foul_zones(evs_d1, 'A')
chk('in20 count=1',   fz['in20'],   1)
chk('mid count=1',    fz['mid'],    1)
chk('unknown count=1', fz['unknown'], 1)
chk('beyond count=0', fz['beyond'], 0)

# Acceptance: foul with loc has ev.loc grouped by foulZones
evs_acc = [{'kind': 'foul', 'side': 'A', 'foulType': 'tackle', 'card': '',
             'loc': {'x': .5, 'y': .5}}]
fz_acc = foul_zones(evs_acc, 'A')
chk('acceptance: foul with loc → mid zone', fz_acc['mid'], 1)

# Verify app.js was edited: freeFoulCommit now takes loc parameter
app_txt = open(os.path.join(PWA, 'app.js'), encoding='utf-8').read()
chk('app.js: freeFoulCommit has loc param',
    'function freeFoulCommit(t, foulType, foulerN, card, loc)' in app_txt, True)
chk('app.js: commitFoulFull has loc param',
    'function commitFoulFull(t, f, player, card, loc)' in app_txt, True)
chk('app.js: foulPlayer uses pickLocationFull',
    'pickLocationFull(t, loc => commitFoulFull' in app_txt, True)
chk('app.js: freeFoulPlayer uses pickLocationFull',
    'pickLocationFull(ot, loc => freeFoulCommit' in app_txt, True)
chk('app.js: addEvent foul has loc field',
    '{ kind: \'foul\', side: t, foulType: f, card, player, loc }' in app_txt, True)

# ── WP-D2: sidelineStats ─────────────────────────────────────────────────────
print('\n=== WP-D2: sidelineStats ===')

evs_d2 = [
    {'kind': 'kickout', 'by': 'A', 'side': 'A', 'outcome': 'wonClean', 'clock': 10},
    {'kind': 'kickout', 'by': 'A', 'side': 'B', 'outcome': 'outOfPlay', 'clock': 50},
    {'kind': 'throwin', 'side': 'B', 'clock': 60},   # B gets the sideline
    {'kind': 'kickout', 'by': 'B', 'side': 'A', 'outcome': 'outOfPlay', 'clock': 120},
    {'kind': 'throwin', 'side': 'A', 'clock': 130},  # A gets the sideline
]
ss = sideline_stats(evs_d2)
chk('total outOfPlay=2', ss['total'],  2)
chk('wonByB=1',          ss['wonByB'], 1)
chk('wonByA=1',          ss['wonByA'], 1)

# No outOfPlay kickouts → all zeros
chk('no outOfPlay → total=0', sideline_stats([{'kind': 'kickout', 'by': 'A', 'side': 'A',
    'outcome': 'wonClean', 'clock': 10}])['total'], 0)

# ── WP-E1: seasonAnalytics ───────────────────────────────────────────────────
print('\n=== WP-E1: seasonAnalytics ===')

match1 = {
    'events': [
        {'kind': 'score', 'side': 'A', 'player': 7, 'scoreType': 'one', 'clock': 100},
        {'kind': 'score', 'side': 'A', 'player': 7, 'scoreType': 'g',   'clock': 200},
    ],
    'onFieldA': [7], 'clock': 300,
}
match2 = {
    'events': [
        {'kind': 'score', 'side': 'A', 'player': 7, 'scoreType': 'one', 'clock': 80},
        {'kind': 'wide',  'side': 'A', 'player': 7, 'clock': 150},
    ],
    'onFieldA': [7], 'clock': 250,
}
agg = season_analytics([match1, match2])
chk('matches=2',         agg['matches'],         2)
chk('player7 pts=4+1=5', agg['players'][7]['pts'], 5)   # g(3)+1pt + 1pt = 5
chk('player7 shots=4',   agg['players'][7]['shots'], 4)  # 2 scores (m1) + 1 score + 1 wide (m2)
chk('player7 scores=3',  agg['players'][7]['scores'], 3) # 3 score events across both matches
chk('player7 conv=75',   agg['players'][7]['conv'],  75)  # 3/4
chk_gte('player7 minutes>0', agg['players'][7]['minutes'], 0.1)

# Null on empty archive
chk('empty archive → None', season_analytics([]), None)

# ── WP-E2: expectedPoints / PAE ───────────────────────────────────────────────
print('\n=== WP-E2: expectedPoints / PAE ===')

# inside-20 shot xP=0.72; mid shot xP=0.52
evs_e2 = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one',
     'loc': {'x': .5, 'y': .1}, 'clock': 50},   # in20: xP=0.72, scored 1
    {'kind': 'wide',  'side': 'A',
     'loc': {'x': .5, 'y': .5}, 'clock': 100},  # mid: xP=0.52, missed
]
xp = expected_points(evs_e2, 'A')
chk_close('xP = 0.72+0.52 = 1.2', xp, 1.2, tol=0.05)

# PAE: scored 1 actual point vs 1.2 xP → PAE negative
p = pae(evs_e2, 'A')
chk_sign('PAE negative when underperforming', p, positive=False)

# PAE: goal (3pts) from in20 (xP=0.72) → positive
evs_goal = [{'kind': 'score', 'side': 'A', 'scoreType': 'g',
              'loc': {'x': .5, 'y': .1}, 'clock': 50}]
chk_sign('PAE positive for goal from in20', pae(evs_goal, 'A'), positive=True)

# 2-pt shot: base xP doubled
evs_two = [{'kind': 'score', 'side': 'A', 'scoreType': 'two',
             'loc': {'x': .5, 'y': .5}, 'clock': 50}]
xp_two = expected_points(evs_two, 'A')
chk_close('2-pt in mid: xP = 0.52*2 = 1.04', xp_two, 1.04, tol=0.05)

# No loc → not counted
evs_noloc = [{'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 50}]
chk('no-loc shot: xP=0', expected_points(evs_noloc, 'A'), 0)

# ── WP-E3: window metrics ─────────────────────────────────────────────────────
print('\n=== WP-E3: scoresInWindow ===')

evs_win = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 100},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 300},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 500},
]
chk('window [0,200] → 1 score',   len(scores_in_window(evs_win, 'A', 0,   200)), 1)
chk('window [200,600] → 2 scores', len(scores_in_window(evs_win, 'A', 200, 600)), 2)
chk('window [0,600] → 3 scores',  len(scores_in_window(evs_win, 'A', 0,   600)), 3)
chk('B gets 0 scores',            len(scores_in_window(evs_win, 'B', 0,   600)), 0)

print('\n=== WP-E3: blackCardImpact ===')

evs_bc = [
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 100},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 200},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 300},  # in window
]
# A player sinned at clock=50 → window [50, 650]
sins = [{'side': 'A', 'player': 9, 'until': 650}]
bci = black_card_impact(evs_bc, sins)
chk('1 entry returned', len(bci), 1)
chk('inWindow=3 (all B scores in window)', bci[0]['inWindow'], 3)
chk_gte('baseline > 0', bci[0]['baseline'], 0.0)

print('\n=== WP-E3: subImpact ===')

evs_sub = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 100},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 200},
    {'kind': 'sub',   'side': 'A', 'off': 7, 'on': 9, 'clock': 300},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 400},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 500},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 600},
]
si = sub_impact(evs_sub)
chk('1 sub recorded',       len(si), 1)
chk('scoreBefore=2 (100,200)', si[0]['scoreBefore'], 2)
chk('scoreAfter=3 (400,500,600)', si[0]['scoreAfter'], 3)
chk('off=7, on=9', (si[0]['off'], si[0]['on']), (7, 9))

print('\n=== WP-E3: pressureRate ===')

# Build a scenario: A is trailing by 3 before scoring a "pressure" goal
# Timeline events: B scores 3 points first, then A scores a point and then a goal
evs_pr = [
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 60},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 120},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 180},
    # diff is now -3 (A trailing by 3)
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 240},  # pressure score
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 300},  # diff -1, normal
]
pr = pressure_rate(evs_pr, 'A')
chk('pressureScores=1 (while trailing -3)', pr['pressureScores'], 1)
chk('normalScores=1 (after partial recovery)', pr['normalScores'], 1)

print('\n=== WP-E3: lateGame ===')

# halfLen=30min → game=60min=3600s; late=last 600s = [3000, 3600]
evs_lg = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 1000},   # not late
    {'kind': 'wide',  'side': 'A', 'clock': 1500},                        # not late
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 3100},   # late
    {'kind': 'wide',  'side': 'A', 'clock': 3200},                        # late miss
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 3400},   # late
]
lg = late_game(evs_lg, meta_half_len=30, side='A')
chk('lateShots=3',   lg['lateShots'],  3)
chk('lateScores=2',  lg['lateScores'], 2)
chk('lateConv=67',   lg['lateConv'],  67)   # 2/3 * 100 = 66.7 → 67
chk('totalConv=60',  lg['totalConv'], 60)   # 3 scores / 5 shots

# ── WP-F1: structural checks ──────────────────────────────────────────────────
print('\n=== WP-F1: structural integrity ===')

idx  = open(os.path.join(PWA, 'index.html'), encoding='utf-8').read()
sw   = open(os.path.join(PWA, 'sw.js'),     encoding='utf-8').read()

# Script order: all new scripts before app.js
scripts = re.findall(r'<script src="([^"]+)"', idx)
app_pos = scripts.index('app.js') if 'app.js' in scripts else -1
for s in ['analytics.js', 'analysis.js']:
    pos = scripts.index(s) if s in scripts else -1
    chk(f'{s} script before app.js', pos != -1 and pos < app_pos, True)

# New IDs in index.html
for id_ in ['analysisBtn', 'analysisBackBtn', 'screen-analysis', 'analysisBody']:
    chk(f'id={id_!r} in index.html', f'id="{id_}"' in idx or f"id='{id_}'" in idx, True)

# sw.js ASSETS list
for f in ['analytics.js', 'analysis.js']:
    chk(f'sw.js ASSETS has ./{f}', f'./{f}' in sw, True)

# sw.js CACHE bumped beyond v12
cache_match = re.search(r"const CACHE = 'sidelinegaa-v(\d+)'", sw)
version = int(cache_match.group(1)) if cache_match else 0
chk_gte('sw.js CACHE version >= 13', version, 13)

# analytics.js has all WP-D/E functions
an = open(os.path.join(PWA, 'analytics.js'), encoding='utf-8').read()
for fn in ['foulZones', 'sidelineStats', 'seasonAnalytics', 'expectedPoints', 'PAE',
           'twoPtEfficiency', 'scoresInWindow', 'blackCardImpact', 'subImpact',
           'pressureRate', 'lateGame']:
    chk(f'analytics.js has {fn}', f'function {fn}(' in an, True)

print(f'\n{passed} passed, {failed} failed')
exit(1 if failed else 0)
