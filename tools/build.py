"""Builds the vpcapps.net static site into the repo root.

  python -I tools/build.py            pages + SEO files (fast)
  python -I tools/build.py --assets   also re-import images, videos, fonts and
                                      the hosted game builds from the APPs repo

Sources: tools/content.py (games, studio facts), the APPs repo
(store listings, screenshots, covers, videos, Phaser builds) and the old site
(legacy privacy / data-deletion pages, the Pop Pairs JS demo). Output pages
are committed: GitHub Pages serves the repo root as is.
"""
import datetime
import html
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from content import GAMES, OLD_SITE, PLAY, SITE, WORLD  # noqa: E402

APPS = os.path.normpath(os.path.join(ROOT, '..', 'APPs'))
OLD = os.path.normpath(os.path.join(ROOT, '..', 'vpconsulting-apps-site'))
MARKETING = os.path.join(APPS, 'docs', 'marketing')
LISTINGS = os.path.join(APPS, 'docs', 'store_listings')
PHASER_WEB = os.path.join(MARKETING, 'phaser', 'website')
TODAY = datetime.date.today().isoformat()
E = html.escape

# ---------------------------------------------------------------- assets ----


def _img(src, dest, size=None, fmt='WEBP', quality=82, crop=None):
    from PIL import Image
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with Image.open(src) as im:
        im = im.convert('RGBA' if fmt == 'PNG' else 'RGB')
        if crop:
            im = _cover(im, crop)
        elif size:
            im.thumbnail(size, Image.LANCZOS)
        kw = dict(quality=quality, method=6) if fmt == 'WEBP' else dict(quality=quality, optimize=True) \
            if fmt == 'JPEG' else dict(optimize=True)
        im.save(dest, fmt, **kw)


def _cover(im, size):
    """Scale + centre-crop [im] to fill [size] exactly."""
    from PIL import Image
    w, h = size
    k = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def _ffmpeg():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    base = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'WinGet', 'Packages')
    for d, _, names in os.walk(base):
        if 'ffmpeg.exe' in names:
            return os.path.join(d, 'ffmpeg.exe')
    raise SystemExit('ffmpeg not found')


def shots(g):
    d = os.path.join(LISTINGS, g['key'])
    return sorted(f for f in os.listdir(d) if re.match(r'\d+_.*\.png$', f))


def import_assets():
    out = os.path.join(ROOT, 'assets', 'img')
    # Brand: logo, default share card, favicons.
    brand = os.path.join(MARKETING, 'branding')
    _img(os.path.join(brand, 'profile_800.png'), os.path.join(out, 'brand', 'vpc-apps-logo-800.png'), fmt='PNG')
    _img(os.path.join(brand, 'profile_800.png'), os.path.join(out, 'brand', 'vpc-apps-logo-320.webp'), (320, 320))
    _img(os.path.join(brand, 'facebook_cover.png'), os.path.join(out, 'brand', 'og-default.jpg'), fmt='JPEG',
         crop=(1200, 630))
    _img(os.path.join(brand, 'facebook_cover.png'), os.path.join(out, 'brand', 'vpc-apps-banner.jpg'), fmt='JPEG',
         quality=88)
    favicons(os.path.join(out, 'brand'))
    for g in GAMES:
        d = os.path.join(out, 'games', g['slug'])
        src = os.path.join(LISTINGS, g['key'])
        _img(os.path.join(src, 'icon_512.png'), os.path.join(d, 'icon-192.webp'), (192, 192))
        _img(os.path.join(src, 'icon_512.png'), os.path.join(d, 'icon-512.png'), fmt='PNG')
        cover = (os.path.join(MARKETING, 'crazygames', 'covers', f'{g["key"]}_landscape_1920x1080.png')
                 if g['cover'] == 'landscape' else os.path.join(src, 'feature_graphic.png'))
        _img(cover, os.path.join(d, 'cover-960.webp'), crop=(960, 540))
        _img(cover, os.path.join(d, 'cover-1600.webp'), crop=(1600, 900), quality=80)
        _img(cover, os.path.join(d, 'og.jpg'), fmt='JPEG', crop=(1200, 630))
        _img(cover, os.path.join(d, 'press-cover.jpg'), fmt='JPEG', quality=90)
        for n, f in enumerate(shots(g), 1):
            _img(os.path.join(src, f), os.path.join(d, f'shot-{n}.webp'), (480, 960))
            _img(os.path.join(src, f), os.path.join(d, f'press-shot-{n}.jpg'), (1080, 2400), fmt='JPEG', quality=86)
        if g.get('video'):
            v = os.path.join(MARKETING, *g['video'].split('/'))
            shutil.copyfile(v, os.path.join(d, 'trailer.mp4'))
            subprocess.run([_ffmpeg(), '-nostdin', '-y', '-loglevel', 'error', '-ss', '4', '-i', v, '-frames:v', '1',
                            '-vf', 'scale=960:-2', '-q:v', '4', os.path.join(d, 'trailer.jpg')], check=True)
    font()
    import_games()


def favicons(d):
    """Gradient rounded square with a white "V" (brand colours)."""
    from PIL import Image, ImageDraw, ImageFont
    big = 512
    grad = Image.new('RGB', (big, big))
    px = grad.load()
    a, b, c = (123, 79, 224), (255, 90, 138), (255, 160, 112)
    for y in range(big):
        for x in range(big):
            t = (x + y) / (2 * big)
            s, e, k = (a, b, t * 2) if t < .5 else (b, c, (t - .5) * 2)
            px[x, y] = tuple(round(s[i] + (e[i] - s[i]) * k) for i in range(3))
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=118, fill=255)
    icon = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask)
    try:
        f = ImageFont.truetype(os.path.join(APPS, 'apps', 'p5_pop_chain', 'assets', 'fonts', 'Fredoka-Variable.ttf'), 380)
        f.set_variation_by_axes([700])
    except Exception:
        f = ImageFont.load_default()
    ImageDraw.Draw(icon).text((big / 2, big / 2 + 14), 'V', font=f, fill='white', anchor='mm')
    icon.resize((180, 180), Image.LANCZOS).save(os.path.join(d, 'apple-touch-icon.png'))
    icon.resize((32, 32), Image.LANCZOS).save(os.path.join(d, 'favicon-32.png'))
    icon.resize((192, 192), Image.LANCZOS).save(os.path.join(d, 'icon-192.png'))
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(d, 'icon-512.png'))
    icon.save(os.path.join(ROOT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])


def font():
    """Fredoka (OFL) subset to Latin, as WOFF: headings only, self-hosted."""
    from fontTools import subset
    src = os.path.join(APPS, 'apps', 'p5_pop_chain', 'assets', 'fonts')
    d = os.path.join(ROOT, 'assets', 'fonts')
    os.makedirs(d, exist_ok=True)
    subset.main([os.path.join(src, 'Fredoka-Variable.ttf'), '--unicodes=U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2022,U+2026,U+00D7,U+00F7,U+2212',
                 '--flavor=woff', '--layout-features=*', f'--output-file={os.path.join(d, "fredoka.woff")}'])
    shutil.copyfile(os.path.join(src, 'Fredoka-OFL.txt'), os.path.join(d, 'Fredoka-OFL.txt'))


# Demo pages may only run on vpcapps.net. Another site that frames them (seen 11-03: a site
# running AdSense around our Balloon Domino demo) gets a card linking to our page instead.
FRAME_GUARD = """<script>(function(){var framed;try{framed=window.top!==window.self;}catch(e){framed=true;}
if(!framed)return;var ok=false;try{ok=/(^|\.)vpcapps\.net$/.test(new URL(document.referrer).hostname);}catch(e){}
if(ok)return;var t=(document.title||'this game').replace(/</g,'&lt;');
document.write('<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#fdf1e7;font:16px system-ui,sans-serif;color:#2b2140;text-align:center;z-index:2147483647">'+
'<div style="padding:24px"><p style="font-size:20px;font-weight:700;margin:0 0 8px">Play '+t+' free on vpcapps.net</p>'+
'<p style="margin:0 0 18px;color:#6b5f80">This game is published by VPC Apps and runs on its own page:<br><b>'+location.host+location.pathname+'</b></p>'+
'<a href="'+location.href.replace(/"/g,'%22')+'" target="_top" rel="noopener" style="display:inline-block;background:#e2495f;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:700">Open the game</a></div></div>'+
'<plaintext style="display:none">');})();</script>"""


def guard_frames(path):
    """Puts FRAME_GUARD first in <head> of a hosted game page (idempotent)."""
    with open(path, encoding='utf-8') as f:
        html = f.read()
    k = html.find('This game is published by VPC Apps')
    if k >= 0:  # replace an older guard
        a = html.rfind('<script>', 0, k); b = html.find('</script>', k) + len('</script>')
        html = html[:a].rstrip('\n') + html[b:]
    i = html.lower().find('<head>')
    if i < 0:
        return
    i += len('<head>')
    m = re.search(r'<title>(.*?)</title>', html, re.S)  # the guard runs before <title> is parsed
    name = (m.group(1).strip() if m else 'this game').replace("'", ' ').replace('<', '')
    html = html[:i] + '\n' + FRAME_GUARD.replace("(document.title||'this game')", "('" + name + "')") + html[i:]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)


def import_games():
    """Hosted builds: Phaser website targets from APPs, the Pop Pairs JS demo from the old site."""
    for g in GAMES:
        if g.get('web') != 'local':
            continue
        dest = os.path.join(ROOT, 'play', g['slug'])
        keep = {}
        for f in ('privacy.html', 'data-deletion.html'):  # rendered pages live next to the game
            p = os.path.join(dest, f)
            if os.path.exists(p):
                keep[f] = open(p, 'rb').read()
        src = os.path.join(PHASER_WEB, f'{g["key"]}_phaser_website')
        if not os.path.isdir(src):
            src = os.path.join(OLD, 'play', g['slug'])
        shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns('privacy.html', 'data-deletion.html'))
        for f, data in keep.items():
            with open(os.path.join(dest, f), 'wb') as fh:
                fh.write(data)
        guard_frames(os.path.join(dest, 'index.html'))
        print(f'game build: {os.path.relpath(src, os.path.dirname(ROOT))} -> play/{g["slug"]}/')


# ---------------------------------------------------------------- store text ----


def store_text(key):
    """(app name, full description as HTML) from the store listing markdown."""
    with open(os.path.join(LISTINGS, f'{key}.md'), encoding='utf-8') as f:
        md = f.read()
    name = re.search(r'## App name[^\n]*\n(.+)', md).group(1).strip()
    body = re.search(r'## Full description[^\n]*\n(.*?)(\n## |\Z)', md, re.S).group(1).strip()
    out, ul, ol = [], [], []

    def flush():
        if ul:
            out.append('<ul>' + ''.join(f'<li>{x}</li>' for x in ul) + '</ul>')
            ul.clear()
        if ol:
            out.append('<ol>' + ''.join(f'<li>{x}</li>' for x in ol) + '</ol>')
            ol.clear()

    for line in body.split('\n'):
        s = line.strip()
        if not s or s.startswith('Made with care') or 'Feedback is welcome' in s:
            flush()
            continue
        if s.startswith('•'):
            ul.append(E(s[1:].strip()))
        elif re.match(r'\d+\. ', s):
            ol.append(E(re.sub(r'^\d+\. ', '', s)))
        elif s.isupper():
            flush()
            out.append(f'<h3>{E(s.capitalize())}</h3>')
        else:
            flush()
            out.append(f'<p>{E(s)}</p>')
    flush()
    return name, '\n'.join(out)


# ---------------------------------------------------------------- layout ----

NAV = [('Games', '/games/'), ('Apps', '/apps/'), ('About', '/about/'), ('Press', '/press/'), ('Contact', '/contact/')]


def page(path, title, desc, body, og_image='/assets/img/brand/og-default.jpg', ld=None, og_type='website',
         active=None, extra_head=''):
    url = SITE['url'] + path
    full = title if title == SITE['name'] else f'{title} · {SITE["name"]}'
    cur = ' aria-current="page"'
    nav = ''.join(f'<li><a href="{h}"{cur if active == h else ""}>{n}</a></li>' for n, h in NAV)
    lds = ''.join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>\n'
                  for x in (ld or []))
    doc = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(full)}</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:site_name" content="{SITE['name']}">
<meta property="og:type" content="{og_type}">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE['url']}{og_image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ff5a8a">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/brand/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/img/brand/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/assets/fonts/fredoka.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css">
<script>try{{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<script src="/assets/js/site.js" defer></script>
{extra_head}{lds}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="/"><img src="/assets/img/brand/icon-192.png" alt="" width="32" height="32"><span>VPC Apps</span></a>
    <nav aria-label="Main"><ul>{nav}</ul></nav>
    <button class="theme" type="button" aria-label="Switch light or dark theme" title="Light / dark"><span aria-hidden="true"></span></button>
  </div>
</header>
<main id="main">
{body}
</main>
<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div><a class="brand" href="/"><img src="/assets/img/brand/icon-192.png" alt="" width="28" height="28"><span>VPC Apps</span></a>
      <p class="muted">{E(SITE['tagline'])}</p></div>
      <ul><li><a href="/games/">Games</a></li><li><a href="/apps/">Apps</a></li><li><a href="/about/">About</a></li><li><a href="/press/">Press kit</a></li></ul>
      <ul><li><a href="/contact/">Contact</a></li><li><a href="/privacy/">Privacy policy</a></li><li><a href="/terms/">Terms of use</a></li></ul>
    </div>
    <p class="muted small">© {datetime.date.today().year} VPC Apps, a brand of Venture Path Consulting (India) · Google Play and the Google Play logo are trademarks of Google LLC.</p>
  </div>
</footer>
</body>
</html>
'''
    write(path, doc)
    PAGES.append(path)


PAGES = []


def write(path, text):
    rel = path.lstrip('/')
    if rel == '' or rel.endswith('/'):
        rel += 'index.html'
    dest = os.path.join(ROOT, *rel.split('/'))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def play_badge(g, cls='btn'):
    if g.get('play_id'):
        return (f'<a class="{cls} play" href="{PLAY}{g["play_id"]}" rel="noopener">'
                f'<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 2.8v18.4c0 .5.5.8.9.6l15.8-9.2c.4-.2.4-.9 0-1.1L4.9 2.2c-.4-.2-.9.1-.9.6z"/></svg>'
                f'Get it on Google Play</a>')
    return f'<span class="chip">{E(g.get("play_note", "Android version coming"))}</span>' if g.get('play_note') else ''


def web_url(g):
    return f'/play/{g["slug"]}/' if g.get('web') == 'local' else g.get('web')


def card(g, big=False):
    tags = []
    if g.get('web'):
        tags.append('<span class="tag web">Play in browser</span>')
    tags.append('<span class="tag android">Android</span>' if g.get('play_id') else '<span class="tag soon">Android soon</span>')
    extra = ''
    if big:
        extra = (f'<p class="more">{E(g["levels"])}. Every balloon fires darts along its arrows; pick the one balloon '
                 f'that sets off a chain big enough to clear the whole sky.</p>' if g['slug'] == 'balloon-domino' else '')
        extra += (f'<p class="cta">' + (f'<a class="btn primary" href="/games/{g["slug"]}/#play">Play now</a>' if g.get('web') else '')
                  + play_badge(g) + '</p>')
    return f'''<article class="card game-card{' big' if big else ''}">
  <a class="cover" href="/games/{g['slug']}/" aria-label="{E(g['title'])}"><img src="/assets/img/games/{g['slug']}/cover-{'1600' if big else '960'}.webp" alt="{E(g['title'])} artwork" width="{1600 if big else 960}" height="{900 if big else 540}" loading="{'eager' if big else 'lazy'}"></a>
  <div class="card-body">
    <img class="icon" src="/assets/img/games/{g['slug']}/icon-192.webp" alt="" width="64" height="64" loading="lazy">
    <div><h3><a href="/games/{g['slug']}/">{E(g['title'])}</a></h3>
    <p>{E(g['tagline'])}</p>
    <p class="tags">{''.join(tags)}</p>{extra}</div>
  </div>
</article>'''


ORG = {'@context': 'https://schema.org', '@type': 'Organization', 'name': SITE['name'], 'legalName': 'Venture Path Consulting', 'url': SITE['url'],
       'logo': SITE['url'] + '/assets/img/brand/icon-512.png', 'email': SITE['email']}

# ---------------------------------------------------------------- pages ----


def home():
    feat = next(g for g in GAMES if g.get('featured'))
    rest = ''.join(card(g) for g in GAMES if g is not feat)
    body = f'''<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">Independent game studio</p>
      <h1>Small puzzles.<br>Big satisfying moments.</h1>
      <p class="lead">{E(SITE['tagline'])} Short levels, no timers, no sign-in. Free to play.</p>
      <p class="cta"><a class="btn primary" href="/games/{feat['slug']}/#play">Play {E(feat['title'])} now</a>
      <a class="btn ghost" href="/games/">See all games</a></p>
    </div>
    <img class="hero-art" src="/assets/img/brand/vpc-apps-logo-320.webp" alt="VPC Apps puzzle game icons" width="320" height="320">
  </div>
</section>
<section class="wrap section">
  <h2>Featured</h2>
  {card(feat, big=True)}
</section>
<section class="wrap section">
  <div class="section-head"><h2>More games</h2><a href="/games/">All games →</a></div>
  <div class="grid">{rest}</div>
</section>
<section class="wrap section split">
  <div><h2>Play anywhere</h2>
  <p>Every game is made for phones first and plays on Android through Google Play. Most also run right here in your browser, on a laptop or a phone, with nothing to install. Your progress is saved in your browser.</p></div>
  <div><h2>A little world</h2><p>{WORLD}</p></div>
</section>
<section class="wrap section">
  <div class="panel"><h2>Apps</h2><p>Games come first, but we are also building small, useful apps. <a href="/apps/">See what's coming →</a></p></div>
</section>'''
    site_ld = {'@context': 'https://schema.org', '@type': 'WebSite', 'name': SITE['name'], 'url': SITE['url']}
    page('/', SITE['name'], SITE['description'], body, ld=[ORG, site_ld])


def games_index():
    body = f'''<section class="wrap section page-head">
  <h1>Games</h1>
  <p class="lead">Puzzle games with short levels and a big payoff. Play the browser demos here, or get the full games on Google Play.</p>
</section>
<section class="wrap section"><div class="grid">{''.join(card(g) for g in GAMES)}</div></section>'''
    items = [{'@type': 'ListItem', 'position': i, 'url': f'{SITE["url"]}/games/{g["slug"]}/'} for i, g in enumerate(GAMES, 1)]
    page('/games/', 'Games', 'All VPC Apps games: Balloon Domino, Shuriken Ricochet, Lantern Chain, Pop Pairs and '
         'Target Tiles. Play in your browser or on Android.', body, active='/games/',
         ld=[{'@context': 'https://schema.org', '@type': 'ItemList', 'itemListElement': items}])


def game_page(g):
    slug = g['slug']
    name, desc_html = store_text(g['key'])
    img = f'/assets/img/games/{slug}'
    n_shots = len(shots(g))
    url = web_url(g)
    play_block = ''
    if url:
        play_block = f'''<section class="wrap section" id="play" aria-label="Play {E(g['title'])}">
  <div class="player {g.get('shape', 'any')}" data-src="{url}" data-title="{E(g['title'])}">
    <img src="{img}/cover-1600.webp" alt="" width="1600" height="900">
    <button class="play-btn" type="button"><span class="tri" aria-hidden="true"></span>Play {E(g['title'])}</button>
    <p class="player-note">{E(g.get('web_label', 'Browser version'))} · runs in your browser, nothing to install</p>
  </div>
  <p class="player-links"><a href="{url}" target="_blank" rel="noopener">Open full screen ↗</a>
  <button class="link fs" type="button" hidden>Full screen</button></p>
  <!-- AD SLOT (game page, below the player). Reserved for AdSense once the account is approved: no ad code until then. -->
  <div class="ad-slot" data-slot="game-below" hidden></div>
</section>'''
    gallery = ''.join(f'<li><img src="{img}/shot-{n}.webp" alt="{E(g["title"])} screenshot {n}" width="480" height="853" '
                      f'loading="lazy"></li>' for n in range(1, n_shots + 1))
    video = ''
    if g.get('video'):
        video = f'''<section class="wrap section"><h2>Watch</h2>
  <video class="trailer" controls muted playsinline preload="none" poster="{img}/trailer.jpg" src="{img}/trailer.mp4">
  Your browser can't play this video.</video></section>'''
    controls = ''.join(f'<tr><th scope="row">{E(k)}</th><td>{E(v)}</td></tr>' for k, v in g['controls'])
    privacy = f'/{slug}/privacy.html'
    facts = [('Genre', ', '.join(g['genre'])), ('Content', g['levels']), ('Price', 'Free (optional ads and in-app purchase on Android)' if g.get('play_id') else 'Free'),
             ('Platforms', ', '.join(x for x in ['Web browser' if url else '', 'Android' if g.get('play_id') else 'Android (coming soon)'] if x)),
             ('Privacy', f'<a href="{privacy}">Privacy policy</a>')]
    facts_html = ''.join(f'<tr><th scope="row">{k}</th><td>{v if k == "Privacy" else E(v)}</td></tr>' for k, v in facts)
    body = f'''<nav class="wrap crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/games/">Games</a> › <span>{E(g['title'])}</span></nav>
<section class="wrap section game-head">
  <img class="icon" src="{img}/icon-192.webp" alt="{E(g['title'])} icon" width="96" height="96">
  <div><h1>{E(g['title'])}</h1><p class="lead">{E(g['tagline'])}</p>
  <p class="cta">{'<a class="btn primary" href="#play">Play now</a>' if url else ''} {play_badge(g)}</p></div>
</section>
{play_block}
<section class="wrap section"><h2>Screenshots</h2><ul class="shots" tabindex="0" aria-label="Screenshots, scroll sideways">{gallery}</ul></section>
{video}
<section class="wrap section split">
  <div class="prose"><h2>About the game</h2>{desc_html}</div>
  <div><h2>Controls</h2><table class="facts">{controls}</table>
  <h2>Details</h2><table class="facts">{facts_html}</table></div>
</section>'''
    ld = {'@context': 'https://schema.org', '@type': 'VideoGame', 'name': g['title'], 'alternateName': name,
          'description': g['tagline'], 'url': f'{SITE["url"]}/games/{slug}/', 'image': SITE['url'] + img + '/og.jpg',
          'genre': g['genre'], 'gamePlatform': [p for p in ['Web browser' if url else None, 'Android'] if p],
          'applicationCategory': 'Game', 'operatingSystem': 'Android, Web',
          'publisher': {'@type': 'Organization', 'name': SITE['name'], 'url': SITE['url']},
          'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
          'screenshot': [SITE['url'] + f'{img}/shot-{n}.webp' for n in range(1, n_shots + 1)]}
    if g.get('play_id'):
        ld['sameAs'] = PLAY + g['play_id']
        ld['installUrl'] = PLAY + g['play_id']
    crumbs = {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': SITE['url'] + '/'},
        {'@type': 'ListItem', 'position': 2, 'name': 'Games', 'item': SITE['url'] + '/games/'},
        {'@type': 'ListItem', 'position': 3, 'name': g['title'], 'item': f'{SITE["url"]}/games/{slug}/'}]}
    desc = f'{g["title"]}: {g["tagline"]} {g["levels"]}. ' + ('Play free in your browser' if url else 'Free on Google Play') + '.'
    page(f'/games/{slug}/', g['title'], desc, body, og_image=f'{img}/og.jpg', ld=[ld, crumbs], active='/games/')


def apps():
    body = '''<section class="wrap section page-head narrow">
  <h1>Apps</h1>
  <p class="lead">Games come first at VPC Apps, but not only games.</p>
  <p>We are working on small, focused apps and tools: the kind that do one job well, open fast, work offline where they can and don't ask for more permissions than they need. They will be listed here, each with its own page and privacy policy, as soon as they are ready.</p>
  <h2>What to expect from our apps</h2>
  <ul class="checks">
    <li>Free to use, with any paid extra clearly marked.</li>
    <li>No account needed unless the app truly needs one.</li>
    <li>Your data stays on your device by default.</li>
    <li>A plain-language privacy policy for every app.</li>
  </ul>
  <p>Want to hear when the first one is out? <a href="/contact/">Drop us a line</a>.</p>
</section>'''
    page('/apps/', 'Apps', 'Small, focused apps and tools from VPC Apps: coming soon, each with a plain-language privacy policy.',
         body, active='/apps/')


def about():
    live = [g for g in GAMES if g.get('play_id')]
    body = f'''<section class="wrap section page-head narrow">
  <h1>About VPC Apps</h1>
  <p class="lead">VPC Apps is a small independent studio making bite-size puzzle games. We started in {SITE['founded']}.</p>
  <p>VPC Apps is a brand of <b>Venture Path Consulting</b>, an independent business registered in India.</p>
  <p>Our first {len(live)} games are live on Google Play: {', '.join(E(g['title']) for g in live)}. Shuriken Ricochet and Lantern Chain are next, and you can already play their demos in your browser.</p>
  <h2>What we care about</h2>
  <ul class="checks">
    <li><b>Fun in the first minute.</b> You land in a level straight away, with a hand showing the first move instead of a wall of text.</li>
    <li><b>Short levels, no pressure.</b> No timers, no energy systems, no sign-in.</li>
    <li><b>Fair ads.</b> Rewarded ads are always your choice. Ads between levels come at natural breaks, never in the middle of a move, and an optional purchase turns them off.</li>
    <li><b>Honest growth.</b> We never buy fake installs or reviews, and we never ask anyone to click ads.</li>
    <li><b>Privacy by default.</b> Your progress stays on your device. Each game has its own privacy policy.</li>
  </ul>
  <h2>Hoshikaze Valley</h2>
  <p>{WORLD}</p>
  <h2>How we make games</h2>
  <p>We design, code and test every game ourselves, and we use AI tools along the way. When a game's art or music was made with the help of AI, its store page says so.</p>
  <p><a class="btn ghost" href="/press/">Press kit</a> <a class="btn ghost" href="/contact/">Contact us</a></p>
</section>'''
    page('/about/', 'About', 'VPC Apps is a small independent studio making bite-size puzzle games for Android and the web.',
         body, active='/about/', ld=[ORG])


def contact():
    e = SITE['email']
    body = f'''<section class="wrap section page-head narrow">
  <h1>Contact</h1>
  <p class="lead">We read every message. Write to <a href="mailto:{e}">{e}</a>.</p>
  <div class="panel"><h2>Found a bug?</h2><p>Tell us the game, your device (phone model or browser) and what happened just before. A screenshot helps a lot.</p></div>
  <div class="panel"><h2>Press, partners and portals</h2><p>Logos, screenshots and a fact sheet are in the <a href="/press/">press kit</a>. For publishing or licensing questions, email us with your company name and the game you're interested in.</p></div>
  <div class="panel"><h2>Privacy requests</h2><p>To ask about or delete data related to one of our apps, see that app's privacy policy (linked from its game page) or email us with the app name.</p></div>
  <p class="muted">We usually answer within two working days.</p>
</section>'''
    page('/contact/', 'Contact', f'Contact VPC Apps: bug reports, press, partnerships and privacy requests at {e}.', body, active='/contact/')


def press():
    rows = []
    for g in GAMES:
        img = f'/assets/img/games/{g["slug"]}'
        sh = ' '.join(f'<a href="{img}/press-shot-{n}.jpg">{n}</a>' for n in range(1, len(shots(g)) + 1))
        rows.append(f'''<article class="card press-card">
  <img class="icon" src="{img}/icon-192.webp" alt="" width="64" height="64" loading="lazy">
  <div><h3><a href="/games/{g['slug']}/">{E(g['title'])}</a></h3><p>{E(g['tagline'])}</p>
  <p class="small">{E(', '.join(g['genre']))} · {E(g['levels'])} · {'Google Play' if g.get('play_id') else 'Android coming soon'}{' · browser demo' if g.get('web') else ''}</p>
  <p class="small downloads">Download: <a href="{img}/icon-512.png">icon (512 px)</a> · <a href="{img}/press-cover.jpg">key art</a> · screenshots {sh}</p></div>
</article>''')
    body = f'''<section class="wrap section page-head">
  <h1>Press kit</h1>
  <p class="lead">Everything you need to write about our games. All images may be used for coverage of VPC Apps games.</p>
</section>
<section class="wrap section split">
  <div><h2>Fact sheet</h2><table class="facts">
    <tr><th scope="row">Studio</th><td>VPC Apps (independent)</td></tr>
    <tr><th scope="row">Founded</th><td>{SITE['founded']}</td></tr>
    <tr><th scope="row">Platforms</th><td>Android (Google Play), web browsers</td></tr>
    <tr><th scope="row">Games</th><td>{len(GAMES)} ({sum(1 for g in GAMES if g.get('play_id'))} on Google Play)</td></tr>
    <tr><th scope="row">Website</th><td><a href="{SITE['url']}">vpcapps.net</a></td></tr>
    <tr><th scope="row">Press contact</th><td><a href="mailto:{SITE['email']}">{SITE['email']}</a></td></tr>
  </table></div>
  <div><h2>Studio logo</h2>
  <p><img src="/assets/img/brand/vpc-apps-logo-320.webp" alt="VPC Apps logo" width="160" height="160" loading="lazy"></p>
  <p class="small downloads">Download: <a href="/assets/img/brand/vpc-apps-logo-800.png">logo (800 px PNG)</a> · <a href="/assets/img/brand/vpc-apps-banner.jpg">banner</a> · <a href="/assets/img/brand/icon-512.png">app mark (512 px)</a></p>
  <h2>Description</h2><p>VPC Apps is a small independent studio making bite-size puzzle games for Android and the web, most of them set in Hoshikaze Valley, a small ninja world.</p></div>
</section>
<section class="wrap section"><h2>Games</h2>{''.join(rows)}</section>'''
    page('/press/', 'Press kit', 'VPC Apps press kit: fact sheet, logos, game icons, key art and screenshots.', body, active='/press/')


def privacy():
    e = SITE['email']
    body = f'''<section class="wrap section page-head narrow prose">
  <h1>Privacy policy</h1>
  <p class="muted">Website privacy policy · last updated {datetime.date.today().strftime('%d %B %Y').lstrip('0')}</p>
  <p>This policy covers the website <b>vpcapps.net</b> and the browser games played on it. Each of our Android apps has its own privacy policy, linked from its game page and its Google Play listing.</p>
  <h2>Summary</h2>
  <ul>
    <li>We don't ask you for any personal information, and there are no accounts.</li>
    <li>The website has no analytics, no advertising and no tracking cookies today.</li>
    <li>Browser games save your progress in your own browser (local storage). It never reaches us.</li>
  </ul>
  <h2>Hosting</h2>
  <p>The site is hosted on GitHub Pages (GitHub, Inc.). Like any web server, GitHub receives your IP address and browser details when you load a page, and may keep them in its logs for security purposes. See <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener">GitHub's privacy statement</a>. Our domain name is registered with Cloudflare, which only answers address lookups for the domain and does not see your visits.</p>
  <h2>Browser games</h2>
  <p>When you play a game on this site, it stores your progress (levels unlocked, stars, settings) in your browser's local storage on your device. You can delete it at any time by clearing your browser's site data. Some game demos are loaded from our older site, vpc-apps.github.io, which is also hosted by GitHub Pages and run by us under the same rules.</p>
  <h2>Videos and images</h2>
  <p>All videos, images and fonts are served from this site. We don't embed third-party players or social media widgets.</p>
  <h2>Advertising</h2>
  <p>This website does not show ads today. If we add ads in the future (for example Google AdSense in or around our browser games), we will update this policy <b>before</b> they go live, explain which provider is used and what it collects, and offer the consent choices required in your region.</p>
  <h2>Email</h2>
  <p>If you email us, we use your message and address only to reply, and we delete the conversation when it is no longer needed.</p>
  <h2>Children</h2>
  <p>Our games are made for a general audience aged 13 and over and are not directed at children under 13. We don't knowingly collect information from children.</p>
  <h2>Changes and contact</h2>
  <p>We'll post any change on this page with a new date. Questions or requests: <a href="mailto:{e}">{e}</a>.</p>
</section>'''
    page('/privacy/', 'Privacy policy', 'How the VPC Apps website and its browser games handle your information: no accounts, no analytics, progress saved in your browser.', body)


def terms():
    e = SITE['email']
    body = f'''<section class="wrap section page-head narrow prose">
  <h1>Terms of use</h1>
  <p class="muted">Last updated {datetime.date.today().strftime('%d %B %Y').lstrip('0')}</p>
  <p>These terms apply to the website vpcapps.net and the browser games on it ("the site"), run by VPC Apps ("we"). By using the site you agree to them. Our Android apps are also covered by the Google Play terms.</p>
  <h2>Using the site and the games</h2>
  <p>You may play the games and read the site for your own personal, non-commercial use. Please don't copy, modify, re-host or sell the games or their content, try to break or overload the site, or use it for anything unlawful.</p>
  <h2>Our content</h2>
  <p>The games, art, music, text and logos on the site belong to VPC Apps or are used under licence (for example open-licence fonts, whose licences ship with the games). The press kit images may be used to write about our games.</p>
  <h2>Links to other services</h2>
  <p>The site links to Google Play and a few other services. Their own terms and privacy policies apply there; we're not responsible for their content.</p>
  <h2>No warranty</h2>
  <p>The site and games are provided free and "as is". We work hard to keep them running and bug-free, but we can't promise they will always be available or error-free, and saved progress in your browser can be lost if site data is cleared.</p>
  <h2>Limitation of liability</h2>
  <p>To the extent the law allows, we are not liable for any indirect or consequential loss arising from using the site or the games.</p>
  <h2>Changes</h2>
  <p>We may update these terms; the date above shows the latest version. Questions: <a href="mailto:{e}">{e}</a>.</p>
</section>'''
    page('/terms/', 'Terms of use', 'Terms of use for the VPC Apps website and its browser games.', body)


def not_found():
    body = '''<section class="wrap section page-head narrow"><h1>Page not found</h1>
  <p class="lead">That page doesn't exist (or it moved). Try the <a href="/games/">games</a> or the <a href="/">home page</a>.</p></section>'''
    page('/404.html', 'Page not found', 'This page does not exist.', body)
    PAGES.remove('/404.html')


def legacy_pages():
    """The old site's per-app privacy and data-deletion pages, same paths, new layout
    (the old site keeps serving the originals that Google Play links to)."""
    for d, _, names in os.walk(OLD):
        rel_d = os.path.relpath(d, OLD).replace(os.sep, '/')
        if rel_d.startswith(('.git', 'img')) or '/assets' in rel_d:
            continue
        for n in names:
            if n not in ('privacy.html', 'data-deletion.html'):
                continue
            with open(os.path.join(d, n), encoding='utf-8') as f:
                src = f.read()
            title = re.search(r'<title>(.*?)</title>', src, re.S).group(1).strip()
            inner = re.search(r'<main>(.*?)</main>', src, re.S).group(1)
            inner = re.sub(r'<footer>.*?</footer>', '', inner, flags=re.S)
            path = '/' + (rel_d + '/' if rel_d != '.' else '') + n
            game = next((g for g in GAMES if g['slug'] in rel_d), None)
            back = f'<p><a href="/games/{game["slug"]}/">← {E(game["title"])}</a></p>' if game else ''
            page(path, title, f'{title} (VPC Apps).', f'<section class="wrap section narrow prose legacy">{back}{inner}</section>')


def seo_files():
    urls = ''.join(f'  <url><loc>{SITE["url"]}{p}</loc><lastmod>{TODAY}</lastmod></url>\n' for p in PAGES)
    write('/sitemap.xml', f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n')
    write('/robots.txt', f'User-agent: *\nAllow: /\n\nSitemap: {SITE["url"]}/sitemap.xml\n')
    # Same AdMob publisher line as the old site (for apps that will list vpcapps.net as their developer website).
    with open(os.path.join(OLD, 'app-ads.txt'), encoding='utf-8') as f:
        write('/app-ads.txt', f.read())
    write('/CNAME', 'vpcapps.net\n')
    write('/.nojekyll', '')
    write('/site.webmanifest', json.dumps({'name': SITE['name'], 'short_name': SITE['name'], 'start_url': '/',
                                           'display': 'standalone', 'background_color': '#fff7f2', 'theme_color': '#ff5a8a',
                                           'icons': [{'src': '/assets/img/brand/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
                                                     {'src': '/assets/img/brand/icon-512.png', 'sizes': '512x512', 'type': 'image/png'}]},
                                          indent=1) + '\n')


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if '--assets' in argv:
        import_assets()
    PAGES.clear()
    home()
    games_index()
    for g in GAMES:
        game_page(g)
    apps()
    about()
    contact()
    press()
    privacy()
    terms()
    legacy_pages()
    not_found()
    seo_files()
    print(f'{len(PAGES)} pages -> {ROOT}')


if __name__ == '__main__':
    main()
