import re, glob, os

os.chdir(r"C:\Users\gearo\Documents\GAA Stats App Experiment\SidelineGAA-PWA")

html = open('index.html', encoding='utf-8').read()
ids  = set(re.findall(r'id="([^"]+)"', html))

refs = set()
for fn in glob.glob('*.js'):
    src = open(fn, encoding='utf-8').read()
    for m in re.findall(r"\$\('([^']+)'\)", src):
        refs.add(m)
    for m in re.findall(r"getElementById\('([^']+)'\)", src):
        refs.add(m)

# IDs built at runtime or injected via innerHTML — not static elements
dyn = {
    'tiBtn','bScore','bWide','bFree','bTurn','bFoul','depthSeg',
    'panelRows','panelCount',
    # numeric player-pick buttons (p0…p15)
    *[f'p{i}' for i in range(16)],
    # sheet buttons built dynamically
    's0','s1','s2','s3','s4','s5','s6','s7','s8',
    # shotchart canvas / overlay ids built on the fly
    'pitchSvg','fullPitchSvg',
}

missing = sorted(refs - ids - dyn)
print('=== ID cross-check ===')
print(f'HTML ids        : {len(ids)}')
print(f'JS $() refs     : {len(refs)}')
print(f'Missing in HTML : {missing if missing else "none"}')

# --- sw.js check ---
sw = open('sw.js', encoding='utf-8').read()
cache = re.search(r"const CACHE = '([^']+)'", sw)
assets = re.findall(r"'\./([^']+\.js)'", sw)

print('\n=== sw.js ===')
print(f'CACHE  : {cache.group(1) if cache else "NOT FOUND"}')
print(f'JS in ASSETS: {sorted(assets)}')

# Check every .js file at root is listed
root_js = sorted(os.path.basename(f) for f in glob.glob('*.js')
                 if not f.endswith('check_ids.py'))
listed  = set(assets)
unlisted = [f for f in root_js if f not in listed and not f.startswith('test_')]
print(f'Root .js files not in ASSETS: {unlisted if unlisted else "none"}')

# --- script order ---
idx_src = open('index.html', encoding='utf-8').read()
scripts = re.findall(r'<script src="([^"]+)"', idx_src)
print('\n=== Script load order ===')
for s in scripts:
    print(f'  {s}')
app_pos = scripts.index('app.js') if 'app.js' in scripts else -1
bad = [s for s in scripts if scripts.index(s) > app_pos and s != 'app.js']
print(f'Scripts after app.js (should be none): {bad if bad else "none"}')
