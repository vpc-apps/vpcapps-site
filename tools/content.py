"""Site content: studio facts and the games. Store texts are read from the
APPs repo (docs/store_listings/<key>.md), so the site says what Play says."""

SITE = dict(
    name='VPC Apps',
    url='https://vpcapps.net',
    email='vpconsulting.apps@gmail.com',
    tagline='Bite-size puzzle games for your phone and your browser.',
    description='VPC Apps makes bite-size puzzle games: Balloon Domino, Pop Pairs, Target Tiles, Lantern Chain '
                'and Shuriken Ricochet. Play free in your browser or get them on Google Play.',
    founded='2026',
)

PLAY = 'https://play.google.com/store/apps/details?id='
OLD_SITE = 'https://vpc-apps.github.io'

# web: 'local' = build hosted on this site under /play/<slug>/ (Phaser or JS);
#      a URL = embedded from elsewhere until its Phaser build is ready.
# shape: 'any' (wide + portrait layouts), 'tall' (phone-shaped).
GAMES = [
    dict(slug='balloon-domino', key='balloon_domino', title='Balloon Domino',
         tagline='One tap starts a chain reaction. Clear the whole sky.',
         genre=['Puzzle', 'Casual'], play_id='in.vpconsulting.balloondomino',
         web='local', web_label='Free 10-level browser demo', shape='any', engine='Phaser',
         levels='400 levels + Daily Challenge', featured=True,
         controls=[('Mouse / touch', 'Tap or click a balloon to pop it and start the chain'),
                   ('R', 'Restart the level'), ('H', 'Hint'), ('Enter / Space', 'Next level')],
         cover='landscape', video='crazygames/videos/balloon_domino_preview_landscape_1920x1080.mp4'),
    dict(slug='shuriken-ricochet', key='shuriken_ricochet', title='Shuriken Ricochet',
         tagline='Bank your shuriken off the walls and knock out every guard.',
         genre=['Puzzle', 'Action'], play_id=None, play_note='Coming soon to Google Play',
         web=OLD_SITE + '/play/shuriken-ricochet/', web_label='Free 10-level browser demo', shape='any',
         levels='200 levels + 10 bosses + Daily Challenge',
         controls=[('Mouse / touch', 'Drag from Ren to aim, let go to throw'),
                   ('R', 'Restart the level'), ('H', 'Hint'), ('Enter / Space', 'Next level, skip')],
         cover='landscape', video='crazygames/videos/shuriken_ricochet_preview_landscape_1920x1080.mp4'),
    dict(slug='lantern-chain', key='lantern_chain', title='Lantern Chain',
         tagline='Sort the glowing paper lanterns by colour. Calm and satisfying.',
         genre=['Puzzle', 'Sorting'], play_id=None, play_note='Coming soon to Google Play',
         web='local', web_label='Free browser demo', shape='any',
         levels='200 levels + Daily Challenge',
         controls=[('Mouse / touch', 'Click a string to lift its top lanterns, then click another to hang them'),
                   ('U', 'Undo'), ('H', 'Hint'), ('R', 'Restart'), ('Enter / Space', 'Next level')],
         cover='landscape', video='crazygames/videos/lantern_chain_preview_landscape_1920x1080.mp4'),
    dict(slug='pop-pairs', key='pop_pairs', title='Pop Pairs',
         tagline='Swipe, merge equal tiles and make the target number.',
         genre=['Puzzle', 'Numbers'], play_id='in.vpconsulting.poppairs',
         web='local', web_label='Free browser demo', shape='tall', engine='JavaScript',
         levels='120 levels',
         controls=[('Touch', 'Swipe up, down, left or right: all tiles slide'),
                   ('Keyboard', 'Arrow keys')],
         cover='feature', video='videos/pop_pairs/pop_pairs_store_promo.mp4'),
    dict(slug='target-tiles', key='target_tiles', title='Target Tiles',
         tagline='Flick number tiles together with + − × ÷ to hit the target.',
         genre=['Puzzle', 'Math'], play_id='in.vpconsulting.targettiles',
         web=None, levels='240 levels in 5 modes',
         controls=[('Touch', 'Flick a tile into its neighbour to combine them')],
         cover='feature', video='videos/target_tiles/target_tiles_store_promo.mp4'),
]

WORLD = ('Most of our games live in <b>Hoshikaze Valley</b>, a small ninja world with its own cast: '
         '<b>Ren</b>, the young ninja; <b>Mika</b>, his friend; <b>Pon</b>, a tanuki who hands out hints; '
         'and <b>Lord Onibi</b>, who keeps stealing the valley\'s spirit lanterns.')
