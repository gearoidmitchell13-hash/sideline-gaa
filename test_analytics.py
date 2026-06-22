"""
Python port of analytics.js harness for WP-A1 + WP-B1.
Mirrors the JS logic exactly so we can validate without Node.
"""

# ── replicate JS helpers ──────────────────────────────────────────────────────

def other(t):
    return 'B' if t == 'A' else 'A'

def score_val(e):
    st = e.get('scoreType', 'one')
    return 3 if st == 'g' else (2 if st == 'two' else 1)

# from analytics.js
def poss_gain_team(e):
    if not e:
        return None
    if e.get('kind') == 'wide' and e.get('wonBy'):
        return e['wonBy']
    if e.get('kind') in ('throwin', 'kickout', 'freeWon'):
        return e['side']
    if e.get('kind') in ('turnover', 'foul'):
        return other(e['side'])
    return None

def build_chains(events):
    chains = []
    cur = None
    for e in (events or []):
        team = poss_gain_team(e)
        if team is not None:
            if cur:
                cur['end'] = e['clock']
            cur = {
                'team': team,
                'start': e['clock'],
                'startKind': e['kind'],
                'end': e['clock'],
                'events': [],
                'scored': False,
                'scorePts': 0,
            }
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

# statsFor — minimal version that computes toWon / toLost (WP-B1 needs these)
def stats_for(events, side):
    s = {'toWon': 0, 'toLost': 0}
    for e in events:
        if e.get('kind') == 'turnover':
            if e.get('side') == side:
                s['toLost'] += 1
            elif e.get('side') == other(side):
                s['toWon'] += 1
    return s

def transition_stats(events, side):
    opp = other(side)
    to_scores = 0
    to_pts = 0

    for i, e in enumerate(events):
        if e.get('kind') != 'score' or e.get('side') != side:
            continue
        for j in range(i - 1, -1, -1):
            g = poss_gain_team(events[j])
            if g is None:
                continue
            if g == side and events[j]['kind'] == 'turnover' and (e['clock'] - events[j]['clock']) <= 60:
                to_scores += 1
                to_pts += score_val(e)
            break

    vuln_scores = 0
    for i, e in enumerate(events):
        if e.get('kind') != 'score' or e.get('side') != opp:
            continue
        for j in range(i - 1, -1, -1):
            g = poss_gain_team(events[j])
            if g is None:
                continue
            if g == opp and events[j]['kind'] == 'turnover' and events[j].get('side') == side and (e['clock'] - events[j]['clock']) <= 60:
                vuln_scores += 1
            break

    speed_sum = 0
    speed_count = 0
    for i, e in enumerate(events):
        if e.get('kind') != 'turnover' or e.get('side') != opp:
            continue
        for j in range(i + 1, len(events)):
            f = events[j]
            if f.get('kind') in ('score', 'wide') and f.get('side') == side:
                speed_sum += f['clock'] - e['clock']
                speed_count += 1
                break
            g = poss_gain_team(f)
            if g is not None and g != side:
                break

    sf = stats_for(events, side)
    to_rate  = round(to_scores   / sf['toWon']  * 100) if sf['toWon']  else 0
    vuln_rate = round(vuln_scores / sf['toLost'] * 100) if sf['toLost'] else 0
    trans_speed = round(speed_sum / speed_count) if speed_count else 0

    return {
        'toScores': to_scores,
        'toPts': to_pts,
        'toRate': to_rate,
        'vulnRate': vuln_rate,
        'transSpeed': trans_speed,
    }


# ── test runner ───────────────────────────────────────────────────────────────

passed = 0
failed = 0

def assert_eq(label, actual, expected):
    global passed, failed
    if actual == expected:
        print(f'PASS  {label}')
        passed += 1
    else:
        print(f'FAIL  {label}  — got {actual!r}, expected {expected!r}')
        failed += 1

def assert_gte(label, actual, expected):
    global passed, failed
    if actual >= expected:
        print(f'PASS  {label}')
        passed += 1
    else:
        print(f'FAIL  {label}  — got {actual!r}, expected >= {expected!r}')
        failed += 1


print('=== WP-A1: possGainTeam ===')
assert_eq('wide.wonBy=B → B',     poss_gain_team({'kind':'wide','side':'A','wonBy':'B'}), 'B')
assert_eq('wide no wonBy → None', poss_gain_team({'kind':'wide','side':'A'}),             None)
assert_eq('throwin → side',       poss_gain_team({'kind':'throwin','side':'A'}),           'A')
assert_eq('turnover → other',     poss_gain_team({'kind':'turnover','side':'B'}),          'A')
assert_eq('foul → other',         poss_gain_team({'kind':'foul','side':'A'}),              'B')

print('\n=== WP-A1: buildChains / possessionCount ===')
evs = [
    {'kind':'throwin',  'side':'A', 'clock':0},
    {'kind':'turnover', 'side':'B', 'clock':20},   # B lost → A gains
    {'kind':'score',    'side':'A', 'scoreType':'one', 'source':'play', 'clock':40},
    {'kind':'kickout',  'by':'A', 'side':'A', 'outcome':'wonClean', 'clock':60},
    {'kind':'score',    'side':'A', 'scoreType':'one', 'source':'play', 'clock':80},
]
chains = build_chains(evs)
assert_gte('buildChains length >= 3', len(chains), 3)
assert_gte('possessionCount A >= 2',  possession_count(evs, 'A'), 2)
assert_gte('at least 1 scored chain', sum(1 for c in chains if c['scored']), 1)

# kickout chain should also be scored
ko_chain = next((c for c in chains if c['startKind'] == 'kickout'), None)
assert_eq('kickout chain scored', ko_chain['scored'] if ko_chain else None, True)

print('\n=== WP-B1: transitionStats — basic ===')
evs2 = [
    {'kind':'throwin',  'side':'A', 'clock':0},
    {'kind':'turnover', 'side':'B', 'clock':100},   # B lost → A won
    {'kind':'score',    'side':'A', 'scoreType':'one', 'source':'play', 'clock':130},
    # kickout → score — NOT a transition score
    {'kind':'kickout',  'by':'B', 'side':'A', 'outcome':'wonClean', 'clock':150},
    {'kind':'score',    'side':'A', 'scoreType':'one', 'source':'play', 'clock':180},
]
t = transition_stats(evs2, 'A')
assert_eq('toScores === 1', t['toScores'], 1)
assert_eq('toPts === 1',    t['toPts'],    1)
assert_eq('toRate === 100', t['toRate'],   100)
assert_eq('vulnRate === 0', t['vulnRate'], 0)
assert_eq('transSpeed === 30 (130-100)', t['transSpeed'], 30)

print('\n=== WP-B1: transitionStats — vulnerability ===')
evs3 = [
    {'kind':'throwin',  'side':'A', 'clock':0},
    {'kind':'turnover', 'side':'A', 'clock':50},   # A lost → B gains
    {'kind':'score',    'side':'B', 'scoreType':'one', 'source':'play', 'clock':90},
]
t3 = transition_stats(evs3, 'A')
assert_eq('vulnRate=100 (B scores off A turnover)', t3['vulnRate'], 100)
assert_eq('toScores=0 (A has no TO scores)',        t3['toScores'], 0)

print('\n=== WP-B1: turnover outside 60s window ===')
evs4 = [
    {'kind':'throwin',  'side':'A', 'clock':0},
    {'kind':'turnover', 'side':'B', 'clock':100},  # A won
    {'kind':'score',    'side':'A', 'scoreType':'one', 'source':'play', 'clock':162},  # 62s later — outside window
]
t4 = transition_stats(evs4, 'A')
assert_eq('toScores=0 (outside 60s)', t4['toScores'], 0)

print(f'\n{passed} passed, {failed} failed')
exit(1 if failed > 0 else 0)
