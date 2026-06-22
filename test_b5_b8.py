"""Python harness for WP-B5 through WP-B8."""

# ── shared helpers (mirrors analytics.js) ────────────────────────────────────

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

# ── WP-B5: foulCost ───────────────────────────────────────────────────────────

DEAD_SOURCES = {'free', '45', 'pen'}

def foul_cost(events, side):
    opp = other(side)
    frees = pts = 0
    for i, e in enumerate(events):
        if e.get('kind') != 'score' or e.get('side') != opp or e.get('source') not in DEAD_SOURCES:
            continue
        for j in range(i - 1, -1, -1):
            g = poss_gain_team(events[j])
            if g is None:
                continue
            if events[j].get('kind') == 'foul' and events[j].get('side') == side:
                frees += 1
                pts += score_val(e)
            break
    return {'frees': frees, 'pts': pts}

# ── WP-B6: shootingBreakdown ──────────────────────────────────────────────────

def shooting_breakdown(events, side):
    zones  = {k: {'shots': 0, 'scores': 0, 'wides': 0} for k in ('in20', 'mid', 'beyond')}
    srcs   = {}

    for e in events:
        if e.get('side') != side or e.get('kind') not in ('score', 'wide'):
            continue
        loc = e.get('loc')
        if loc:
            zk = 'in20' if loc['y'] < 0.31 else ('mid' if loc['y'] < 0.62 else 'beyond')
            z  = zones[zk]
            z['shots'] += 1
            if e['kind'] == 'score':
                z['scores'] += 1
            else:
                z['wides'] += 1

        src = e.get('source') or 'play'
        if src not in srcs:
            srcs[src] = {'shots': 0, 'scores': 0}
        srcs[src]['shots'] += 1
        if e['kind'] == 'score':
            srcs[src]['scores'] += 1

    def pct(n, d):
        return round(n / d * 100) if d else 0

    zone_result = {}
    for k, z in zones.items():
        zone_result[k] = {**z, 'conv': pct(z['scores'], z['shots']),
                           'wideRate': pct(z['wides'],  z['shots'])}
    src_result = {}
    for k, s in srcs.items():
        src_result[k] = {**s, 'conv': pct(s['scores'], s['shots'])}

    return {'zones': zone_result, 'sourceDist': src_result}

# ── WP-B7: transitionTypes ────────────────────────────────────────────────────

def transition_types(events, side):
    by_type = {}

    for e in events:
        if e.get('kind') != 'turnover' or other(e.get('side', '')) != side:
            continue
        t = e.get('toType') or 'unknown'
        if t not in by_type:
            by_type[t] = {'won': 0, 'scored': 0}
        by_type[t]['won'] += 1

    for i, e in enumerate(events):
        if e.get('kind') != 'score' or e.get('side') != side:
            continue
        for j in range(i - 1, -1, -1):
            g = poss_gain_team(events[j])
            if g is None:
                continue
            if (g == side and events[j].get('kind') == 'turnover'
                    and (e['clock'] - events[j]['clock']) <= 60):
                t = events[j].get('toType') or 'unknown'
                if t in by_type:
                    by_type[t]['scored'] += 1
            break

    return {k: {'won': v['won'], 'scored': v['scored'],
                'rate': round(v['scored'] / v['won'] * 100)}
            for k, v in by_type.items()}

# ── WP-B8: droughts + possessionByBlock ───────────────────────────────────────

def droughts(events):
    first_clock = events[0]['clock'] if events else 0
    result = {'A': 0, 'B': 0}
    for side in ('A', 'B'):
        scores = [e for e in events if e.get('kind') == 'score' and e.get('side') == side]
        if not scores:
            continue
        prev, max_gap = first_clock, 0
        for e in scores:
            gap = e['clock'] - prev
            if gap > max_gap:
                max_gap = gap
            prev = e['clock']
        result[side] = max_gap
    return result

def possession_by_block(events, block_secs=600):
    chains = build_chains(events)
    blocks = {}
    for c in chains:
        if c['end'] == c['start']:  # zero-duration chain contributes nothing
            continue
        bn = int(c['start'] // block_secs)
        if bn not in blocks:
            blocks[bn] = {'A': 0, 'B': 0}
        blocks[bn][c['team']] += c['end'] - c['start']

    result = []
    for bn in sorted(blocks):
        b     = blocks[bn]
        total = b['A'] + b['B']
        result.append({
            'block': bn,
            'aPct':  round(b['A'] / total * 100) if total else 50,
            'bPct':  round(b['B'] / total * 100) if total else 50,
        })
    return result

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

def chk_between(label, actual, lo, hi):
    global passed, failed
    if lo <= actual <= hi:
        print(f'PASS  {label}')
        passed += 1
    else:
        print(f'FAIL  {label}  got={actual!r}  want in [{lo},{hi}]')
        failed += 1

# ── WP-B5 ─────────────────────────────────────────────────────────────────────
print('=== WP-B5: foulCost ===')

# Acceptance: foul by A → B scores the free → foulCost('A').pts >= 1
evs_b5 = [
    {'kind': 'throwin', 'side': 'A', 'clock': 0},
    {'kind': 'foul',    'side': 'A', 'clock': 20, 'card': ''},   # A fouled → B wins free
    {'kind': 'score',   'side': 'B', 'scoreType': 'one', 'source': 'free', 'clock': 40},
]
fc = foul_cost(evs_b5, 'A')
chk_gte('acceptance: pts >= 1', fc['pts'], 1)
chk('frees === 1', fc['frees'], 1)
chk('pts === 1',   fc['pts'],   1)

# Goal from a penalty (pen source)
evs_b5b = [
    {'kind': 'foul',  'side': 'A', 'clock': 5,  'card': ''},
    {'kind': 'score', 'side': 'B', 'scoreType': 'g', 'source': 'pen', 'clock': 30},
]
fc2 = foul_cost(evs_b5b, 'A')
chk('penalty goal: frees=1, pts=3', fc2['pts'], 3)

# Score from play — NOT a foul cost
evs_b5c = [
    {'kind': 'foul',  'side': 'A', 'clock': 5,  'card': ''},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'source': 'play', 'clock': 30},
]
chk('play score not counted', foul_cost(evs_b5c, 'A')['frees'], 0)

# 45 is also a dead-ball source
evs_b5d = [
    {'kind': 'foul',  'side': 'A', 'clock': 5,  'card': ''},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'source': '45', 'clock': 30},
]
chk('45 counts as foul cost', foul_cost(evs_b5d, 'A')['frees'], 1)

# B's foul, B's free — not A's cost
evs_b5e = [
    {'kind': 'foul',  'side': 'B', 'clock': 5,  'card': ''},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'source': 'free', 'clock': 30},
]
chk("B's foul: foulCost('A').frees=0", foul_cost(evs_b5e, 'A')['frees'], 0)

# Intervening possession-gain breaks the chain
evs_b5f = [
    {'kind': 'foul',    'side': 'A', 'clock': 5,  'card': ''},
    {'kind': 'throwin', 'side': 'B', 'clock': 15},  # interrupts chain
    {'kind': 'score',   'side': 'B', 'scoreType': 'one', 'source': 'free', 'clock': 30},
]
chk('intervening throwin breaks chain', foul_cost(evs_b5f, 'A')['frees'], 0)

# ── WP-B6 ─────────────────────────────────────────────────────────────────────
print('\n=== WP-B6: shootingBreakdown ===')

# Acceptance: 2 located shots inside-20 (1 score, 1 wide) → conv=50, wideRate=50
evs_b6 = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'source': 'play',
     'loc': {'x': .5, 'y': .1}, 'clock': 10},
    {'kind': 'wide',  'side': 'A', 'missType': 'wide', 'source': 'play',
     'loc': {'x': .6, 'y': .2}, 'clock': 20},
    # mid-range shot — different zone
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'source': 'free',
     'loc': {'x': .5, 'y': .5}, 'clock': 30},
]
sb = shooting_breakdown(evs_b6, 'A')
chk('in20.shots === 2',    sb['zones']['in20']['shots'],    2)
chk('in20.scores === 1',   sb['zones']['in20']['scores'],   1)
chk('in20.wides === 1',    sb['zones']['in20']['wides'],    1)
chk('in20.conv === 50',    sb['zones']['in20']['conv'],     50)
chk('in20.wideRate === 50',sb['zones']['in20']['wideRate'], 50)
chk('mid.shots === 1',     sb['zones']['mid']['shots'],     1)
chk('mid.conv === 100',    sb['zones']['mid']['conv'],      100)

# Source distribution
chk('play: shots=2, scores=1', sb['sourceDist']['play']['shots'], 2)
chk('play: conv=50',           sb['sourceDist']['play']['conv'],  50)
chk('free: shots=1, conv=100', sb['sourceDist']['free']['conv'],  100)

# Shot with no loc — excluded from zones, still counted in sourceDist
evs_b6b = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'source': 'free', 'clock': 10},
]
sb2 = shooting_breakdown(evs_b6b, 'A')
chk('no-loc shot not in zones (in20 shots=0)', sb2['zones']['in20']['shots'], 0)
chk('no-loc shot counted in sourceDist',        sb2['sourceDist']['free']['shots'], 1)

# Beyond-40 threshold (y >= 0.62)
evs_b6c = [
    {'kind': 'wide', 'side': 'A', 'missType': 'wide', 'source': 'play',
     'loc': {'x': .5, 'y': .8}, 'clock': 10},
]
sb3 = shooting_breakdown(evs_b6c, 'A')
chk('y=0.8 goes to beyond zone', sb3['zones']['beyond']['shots'], 1)
chk('beyond wideRate=100',        sb3['zones']['beyond']['wideRate'], 100)

# ── WP-B7 ─────────────────────────────────────────────────────────────────────
print('\n=== WP-B7: transitionTypes ===')

# Acceptance: 2 tackles won, 1 led to a score → tackle {won:2, scored:1, rate:50}
evs_b7 = [
    {'kind': 'throwin',  'side': 'A', 'clock': 0},
    {'kind': 'turnover', 'side': 'B', 'toType': 'tackle', 'clock': 50},    # A wins
    {'kind': 'score',    'side': 'A', 'scoreType': 'one', 'source': 'play', 'clock': 80},  # within 60s
    {'kind': 'kickout',  'by': 'A',   'side': 'A', 'outcome': 'wonClean', 'clock': 100},
    {'kind': 'turnover', 'side': 'B', 'toType': 'tackle', 'clock': 200},   # A wins, no score
    {'kind': 'kickout',  'by': 'B',   'side': 'B', 'outcome': 'wonClean', 'clock': 300},  # B regains
]
tt = transition_types(evs_b7, 'A')
chk('tackle won === 2',    tt.get('tackle', {}).get('won',    -1), 2)
chk('tackle scored === 1', tt.get('tackle', {}).get('scored', -1), 1)
chk('tackle rate === 50',  tt.get('tackle', {}).get('rate',   -1), 50)

# Second type — kick turnover, no score
evs_b7b = evs_b7 + [
    {'kind': 'turnover', 'side': 'B', 'toType': 'kick', 'clock': 400},    # A wins
    {'kind': 'score',    'side': 'A', 'scoreType': 'one', 'source': 'play', 'clock': 500},  # > 60s later
]
tt2 = transition_types(evs_b7b, 'A')
chk('kick won=1, scored=0 (>60s gap)', tt2.get('kick', {}).get('scored', -1), 0)
chk('kick rate=0',                     tt2.get('kick', {}).get('rate',   -1), 0)

# ── WP-B8 ─────────────────────────────────────────────────────────────────────
print('\n=== WP-B8: droughts ===')

# Single team: 3 scores at 100, 300, 700s; first event at 0
# gaps: 100 (0→100), 200 (100→300), 400 (300→700) → max=400
evs_b8a = [
    {'kind': 'throwin', 'side': 'A', 'clock': 0},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 100, 'min': 2},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 300, 'min': 5},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 700, 'min': 12},
]
dr = droughts(evs_b8a)
chk('A drought === 400', dr['A'], 400)
chk('B drought === 0 (no scores)', dr['B'], 0)

# Both teams
evs_b8b = [
    {'kind': 'throwin', 'side': 'A', 'clock': 0},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 60,  'min': 1},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 120, 'min': 2},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 360, 'min': 6},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 600, 'min': 10},
]
dr2 = droughts(evs_b8b)
chk('A drought: max(60,300)=300', dr2['A'], 300)
chk('B drought: max(120,480)=480', dr2['B'], 480)

print('\n=== WP-B8: possessionByBlock ===')

# Build chains spanning 0-600 and 600-1200 roughly equally
# A owns 0-200, B owns 200-400, A owns 400-600 → block0: A=400, B=200, aPct≈67
# A owns 600-800, B owns 800-1200            → block1: A=200, B=400, aPct≈33
evs_b8c = [
    {'kind': 'throwin', 'side': 'A', 'clock': 0},
    {'kind': 'turnover','side': 'A', 'clock': 200},  # B gains
    {'kind': 'turnover','side': 'B', 'clock': 400},  # A gains
    {'kind': 'kickout', 'by': 'A', 'side': 'A', 'outcome': 'wonClean', 'clock': 600},  # A (new chain)
    {'kind': 'turnover','side': 'A', 'clock': 800},  # B gains
    {'kind': 'throwin', 'side': 'A', 'clock': 1200}, # A gains (closes B's chain)
]
pbb = possession_by_block(evs_b8c, 600)
chk('2 blocks returned', len(pbb), 2)
chk('block 0 index', pbb[0]['block'], 0)
chk('block 1 index', pbb[1]['block'], 1)
chk_between('block0 aPct sane (>50%)', pbb[0]['aPct'], 51, 100)
chk_between('block1 bPct sane (>50%)', pbb[1]['bPct'], 51, 100)
chk('aPct+bPct=100 block0', pbb[0]['aPct'] + pbb[0]['bPct'], 100)
chk('aPct+bPct=100 block1', pbb[1]['aPct'] + pbb[1]['bPct'], 100)

# Empty events → empty list
chk('empty events → []', possession_by_block([], 600), [])

print(f'\n{passed} passed, {failed} failed')
exit(1 if failed else 0)
