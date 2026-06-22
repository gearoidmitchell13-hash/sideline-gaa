"""Python harness for WP-B9, WP-C1 (render), WP-C2 (SVG)."""

# ── shared helpers ────────────────────────────────────────────────────────────

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

# ── WP-B9: playerStats ────────────────────────────────────────────────────────

def player_stats(events, on_field_a, clock, side):
    """Returns map jersey -> stats dict."""
    map_ = {}
    def get(n):
        if n not in map_:
            map_[n] = {'pts': 0, 'shots': 0, 'scores': 0, 'wides': 0,
                       'toLost': 0, 'toWon': 0, 'foulsCommitted': 0,
                       'freesWon': 0, 'oppCreated': 0, 'minutes': 0}
        return map_[n]

    for e in events:
        if e.get('player') is None or e.get('side') != side:
            continue
        p = get(e['player'])
        k = e.get('kind')
        if k == 'score':
            p['shots'] += 1; p['scores'] += 1; p['pts'] += score_val(e)
        elif k == 'wide':
            p['shots'] += 1; p['wides'] += 1
        elif k == 'turnover':
            p['toLost'] += 1
        elif k == 'foul':
            p['foulsCommitted'] += 1

    for p in map_.values():
        p['conv'] = round(p['scores'] / p['shots'] * 100) if p['shots'] else 0

    if side == 'A':
        start_time = {}
        on_field = set(on_field_a or [])
        for n in on_field:
            start_time[n] = 0
            get(n)

        for e in events:
            if e.get('kind') != 'sub' or e.get('side') != 'A':
                continue
            off, on = e.get('off'), e.get('on')
            if off is not None and off in start_time:
                get(off)['minutes'] += (e['clock'] - start_time[off]) / 60
                del start_time[off]
                on_field.discard(off)
            if on is not None:
                start_time[on] = e['clock']
                on_field.add(on)
                get(on)

        for n in on_field:
            if n in start_time:
                get(n)['minutes'] += (clock - start_time[n]) / 60

        for p in map_.values():
            p['minutes'] = round(p['minutes'] * 10) / 10

    return map_

# ── WP-C2: renderScoreTimeline (Python port) ──────────────────────────────────

def score_timeline(events):
    tot = {'A': 0, 'B': 0}
    tl  = []
    for e in events:
        if e.get('kind') != 'score':
            continue
        tot[e['side']] += score_val(e)
        tl.append({'clock': e['clock'], 'min': e.get('min', 0), 'diff': tot['A'] - tot['B']})
    return tl

def render_score_timeline(events, meta_a='A', meta_b='B'):
    """Returns SVG string; always contains <svg> and either <polyline> or no-data text."""
    tl = score_timeline(events)
    W, H, PAD = 320, 120, 14

    if not tl:
        return f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg"><text x="{W//2}" y="{H//2+4}" text-anchor="middle" font-size="11" fill="#999">No scores yet</text></svg>'

    all_clocks = [e['clock'] for e in events if e.get('clock') is not None]
    max_clock = max(all_clocks) if all_clocks else 1
    abs_max = max(1, max(abs(p['diff']) for p in tl))
    iW, iH = W - PAD * 2, H - PAD * 2

    def px(c):
        return f'{PAD + (c / max_clock) * iW:.1f}'
    def py(d):
        return f'{PAD + ((abs_max - d) / (2 * abs_max)) * iH:.1f}'

    zy     = py(0)
    points = ' '.join(f'{px(p["clock"])},{py(p["diff"])}' for p in tl)
    last   = tl[-1]['diff']
    colour = '#1b7a3d' if last >= 0 else '#b23a2e'

    return (f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" '
            f'style="width:100%;height:auto;display:block">\n'
            f'  <line x1="{PAD}" y1="{zy}" x2="{W-PAD}" y2="{zy}" stroke="#ddd" stroke-width="1.5"/>\n'
            f'  <polyline points="{points}" fill="none" stroke="{colour}" '
            f'stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>\n'
            f'  <text x="{PAD}" y="{PAD-2}" font-size="9" fill="#1b7a3d" font-weight="700">▲ Ahead</text>\n'
            f'  <text x="{PAD}" y="{H-2}" font-size="9" fill="#b23a2e" font-weight="700">▼ Behind</text>\n'
            f'</svg>')

# ── WP-C1: showAnalysis HTML output (smoke test via Python render) ─────────────

def mock_show_analysis(events, on_field_a, clock, meta_a='Team A', meta_b='Opp'):
    """Produces the HTML that showAnalysis() would set, for testing."""
    import html as html_mod

    def esc(s):
        return html_mod.escape(str(s))

    def arow(label, a, b):
        return f'<div class="stat-row"><span class="va">{a}</span><span class="lbl">{esc(label)}</span><span class="vb">{b}</span></div>'

    def acard(title, inner):
        return f'<div class="d-card"><div class="d-h">{esc(title)}</div>{inner}</div>'

    def ahead(na, nb):
        return f'<div class="d-cols"><span>{esc(na)}</span><span></span><span>{esc(nb)}</span></div>'

    # --- transition card ---
    def stats_for(side):
        s = {'toWon': 0, 'toLost': 0, 'scores': 0}
        for e in events:
            k = e.get('kind')
            if k == 'score' and e.get('side') == side:
                s['scores'] += 1
            elif k == 'turnover':
                if e.get('side') == side:
                    s['toLost'] += 1
                elif e.get('side') == other(side):
                    s['toWon'] += 1
        return s

    def transition_stats(side):
        opp = other(side)
        to_scores = to_pts = 0
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
        sf = stats_for(side)
        return {
            'toScores': to_scores,
            'toPts': to_pts,
            'toRate': round(to_scores / sf['toWon'] * 100) if sf['toWon'] else 0,
        }

    tA, tB = transition_stats('A'), transition_stats('B')
    trans_card = acard('Transition', ahead(meta_a, meta_b) +
        arow('TO→score', tA['toScores'], tB['toScores']) +
        arow('TO→pts',   tA['toPts'],   tB['toPts']) +
        arow('Rate',     str(tA['toRate']) + '%', str(tB['toRate']) + '%'))

    # --- player card ---
    pm = player_stats(events, on_field_a, clock, 'A')
    rows = sorted(pm.items(), key=lambda kv: (-kv[1]['pts'], -kv[1]['shots']))
    player_rows = ''.join(
        f'<div class="pt-row"><span>#{n}</span><span>{p["pts"]}</span>'
        f'<span>{p["shots"]}</span><span>{p["conv"]}%</span>'
        f'<span>{p["toLost"]}</span><span>{p["foulsCommitted"]}</span>'
        f'<span>{p["minutes"]}</span></div>'
        for n, p in rows
    )
    player_card = acard(f'Per player — {esc(meta_a)}',
                        f'<div class="ptbl">{player_rows}</div>') if rows else ''

    # --- SVG timeline ---
    svg = render_score_timeline(events, meta_a, meta_b)

    return trans_card + player_card + svg


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

def chk_in(label, needle, haystack):
    global passed, failed
    if needle in haystack:
        print(f'PASS  {label}')
        passed += 1
    else:
        print(f'FAIL  {label}  "{needle}" not found in output')
        failed += 1

def chk_close(label, actual, expected, tol=0.2):
    global passed, failed
    if abs(actual - expected) <= tol:
        print(f'PASS  {label}')
        passed += 1
    else:
        print(f'FAIL  {label}  got={actual!r}  want≈{expected!r}')
        failed += 1

# ── WP-B9 tests ───────────────────────────────────────────────────────────────
print('=== WP-B9: playerStats ===')

# Acceptance: player 7 has 1 point + 1 wide → {pts:1, scores:1, shots:2, conv:50}
evs_b9 = [
    {'kind': 'score', 'side': 'A', 'player': 7, 'scoreType': 'one', 'source': 'play', 'clock': 100, 'min': 2},
    {'kind': 'wide',  'side': 'A', 'player': 7, 'missType': 'wide', 'clock': 200, 'min': 4},
    # Player 11: turnover + foul
    {'kind': 'turnover', 'side': 'A', 'player': 11, 'clock': 300},
    {'kind': 'foul',     'side': 'A', 'player': 11, 'clock': 400, 'card': ''},
]
on_field = [7, 11]
pm = player_stats(evs_b9, on_field, 600, 'A')

chk('player 7: pts=1',    pm[7]['pts'],    1)
chk('player 7: scores=1', pm[7]['scores'], 1)
chk('player 7: shots=2',  pm[7]['shots'],  2)
chk('player 7: conv=50',  pm[7]['conv'],   50)
chk('player 7: wides=1',  pm[7]['wides'],  1)
chk('player 11: toLost=1',       pm[11]['toLost'],       1)
chk('player 11: foulsCommitted=1', pm[11]['foulsCommitted'], 1)

# minutes: starters, no subs, clock=600 → minutes ≈ 10.0
chk('player 7: minutes=10.0',  pm[7]['minutes'],  10.0)
chk('player 11: minutes=10.0', pm[11]['minutes'], 10.0)

# Acceptance: starter never subbed → minutes ≈ clock/60
expected_mins = round(600 / 60 * 10) / 10  # = 10.0
chk('starter minutes ≈ clock/60', pm[7]['minutes'], expected_mins)

# Sub scenario: player 7 subs off at 300s, player 9 subs on
evs_sub = evs_b9 + [
    {'kind': 'sub', 'side': 'A', 'off': 7, 'on': 9, 'clock': 300},
]
pm2 = player_stats(evs_sub, [7, 11], 600, 'A')
chk('player 7 subbed at 300 → 5.0 min', pm2[7]['minutes'], 5.0)
chk('player 9 on at 300 → 5.0 min',     pm2[9]['minutes'], 5.0)
chk('player 11 full game → 10.0 min',   pm2[11]['minutes'], 10.0)

# Goal = 3 pts
evs_goal = [{'kind': 'score', 'side': 'A', 'player': 14, 'scoreType': 'g', 'source': 'play', 'clock': 50}]
pm3 = player_stats(evs_goal, [14], 60, 'A')
chk('goal → pts=3', pm3[14]['pts'], 3)

# B-side player: minutes always 0
evs_b = [{'kind': 'score', 'side': 'B', 'player': 3, 'scoreType': 'one', 'source': 'play', 'clock': 50}]
pm4 = player_stats(evs_b, [], 60, 'B')
chk('B player: minutes=0', pm4[3]['minutes'], 0)
chk('B player: pts=1', pm4[3]['pts'], 1)

# ── WP-C1 smoke test ──────────────────────────────────────────────────────────
print('\n=== WP-C1: showAnalysis HTML smoke test ===')

evs_c1 = [
    {'kind': 'throwin',  'side': 'A', 'clock': 0},
    {'kind': 'turnover', 'side': 'B', 'clock': 50},
    {'kind': 'score',    'side': 'A', 'player': 7, 'scoreType': 'one', 'source': 'play', 'clock': 80, 'min': 2},
    {'kind': 'score',    'side': 'B', 'player': 4, 'scoreType': 'one', 'source': 'play', 'clock': 200, 'min': 4},
]
html = mock_show_analysis(evs_c1, [7], 600, 'Clonakilty', 'Erins Own')

chk_in('HTML has d-card',          'd-card',          html)
chk_in('HTML has Transition title', 'Transition',      html)
chk_in('HTML has player table',    'ptbl',            html)
chk_in('HTML has player 7',        '#7',              html)
chk_in('HTML has stat-row',        'stat-row',        html)
chk_in('HTML contains pts value',  '>1<',             html)   # player 7 scored 1 pt

# toScores should be 1 (turnover→score within 60s)
chk_in('TO->score=1 in HTML', '>1<', html)

# ── WP-C2 tests ───────────────────────────────────────────────────────────────
print('\n=== WP-C2: renderScoreTimeline ===')

# Acceptance: returns <svg> with <polyline>
evs_c2 = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 100, 'min': 2},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 200, 'min': 4},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 300, 'min': 6},
]
svg = render_score_timeline(evs_c2)
chk_in('returns <svg>',       '<svg',       svg)
chk_in('has <polyline>',      '<polyline',  svg)
chk_in('has points attribute', 'points=',   svg)
chk_in('has zero <line>',     '<line',      svg)

# No scores → still returns <svg> (no-data message)
svg_empty = render_score_timeline([{'kind': 'throwin', 'side': 'A', 'clock': 0}])
chk_in('empty → still <svg>', '<svg', svg_empty)

# A leading at end → green colour
evs_a_lead = [{'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 100, 'min': 2}]
svg_a = render_score_timeline(evs_a_lead)
chk_in('A ahead → green stroke', '#1b7a3d', svg_a)

# B leading at end → red colour
evs_b_lead = [{'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 100, 'min': 2}]
svg_b = render_score_timeline(evs_b_lead)
chk_in('B ahead → red stroke', '#b23a2e', svg_b)

# 4-score timeline produces 4 points in polyline
evs_4 = [
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 60,  'min': 1},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 120, 'min': 2},
    {'kind': 'score', 'side': 'B', 'scoreType': 'one', 'clock': 180, 'min': 3},
    {'kind': 'score', 'side': 'A', 'scoreType': 'one', 'clock': 240, 'min': 4},
]
svg_4 = render_score_timeline(evs_4)
# polyline points: 4 coordinate pairs → 3 spaces between them
point_count = svg_4[svg_4.index('points="') + 8:].split('"')[0].count(' ') + 1
chk('4 scores → 4 polyline points', point_count, 4)

print(f'\n{passed} passed, {failed} failed')
exit(1 if failed else 0)
