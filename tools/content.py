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

# Cloudflare Web Analytics (approved 2026-11-07): cookie-free visit counter, manual snippet, placed before
# </body> on every page the build renders and on /tools/app/ (never in the Chrome extension, which is
# built from APPs/products/e8_dashboard). The token is a public site ID.
ANALYTICS = '<!-- Cloudflare Web Analytics --><script type=\'module\' src=\'https://static.cloudflareinsights.com/beacon.min.js\' data-cf-beacon=\'{"token": "a470f94b795a45578b8f87cbfcca8c9d"}\'></script><!-- End Cloudflare Web Analytics -->'

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

# Export to Dashboard tool (E8, built in APPs/products/e8_dashboard, served from /tools/app/).
# One landing page per template; copy aims at the search terms in
# APPs/docs/research/e8_export_dashboard_demand_2026-11-02.md. Steps and FAQ answers are HTML.
TOOL = dict(name='Export to Dashboard', free_rows='5,000')
TOOLS = [
    dict(t='jira', slug='jira-csv-dashboard', short='Jira CSV to dashboard',
         title='Jira CSV export to dashboard and executive summary',
         h1='Turn a Jira CSV export into a QA dashboard',
         lead='Export your issues from Jira, drop the CSV here and get a bug and QA status dashboard in seconds: '
              'open vs resolved trend, ageing, priorities, assignees and components, with plain-English findings '
              'and a summary you can send to your manager.',
         desc='Free Jira CSV to dashboard: drop a Jira issues export, get a QA and bug dashboard and an '
              'executive summary. Your file never leaves your device.',
         card='Bug trend, ageing, priorities and an executive summary from any Jira issues export.',
         gets=['Six headline numbers: issues, open, resolved, median time to resolve, high-priority issues open over 30 days, unassigned open issues.',
               'Findings written out for you: whether the backlog grew in the last 4 weeks, old high-priority bugs, and whether one person holds too many open issues.',
               'Charts: created vs resolved per week, age of open issues, open by priority, assignee, component and status, issues by fix version.',
               'Filters for issue type (Bugs by default) and project, plus a breakdown by one of your custom fields such as Severity or Root cause.',
               'A one-file HTML summary (no scripts, opens anywhere, easy to email) and a print-ready PDF layout.'],
         steps=['In Jira Cloud open <b>Filters → View all issues</b> (or run a search with the JQL you need) and switch to the <b>list view</b>.',
                'Choose <b>Export → Export CSV (all fields)</b> or <b>(current fields)</b>. Current fields is faster; make sure Status, Priority, Created, Resolved and Assignee are visible.',
                'Jira Server or Data Center: <b>Issues → Search for issues → Export → CSV</b>.',
                'Drop the file above. Jira Cloud exports up to 10,000 issues per file.'],
         faqs=[('Is my Jira data uploaded anywhere?', 'No. The CSV is read and analysed by JavaScript in your own browser tab. Nothing from the file is sent to us or to any server, so it suits confidential projects, and it keeps working offline after your first visit.'),
               ('Which Jira exports work?', 'Jira Cloud, Server and Data Center issue exports in CSV, with all fields or current fields. Columns are found by their names, so the order doesn\'t matter, and multi-value fields like Labels, Sprint and Comment that Jira repeats in several columns are merged.'),
               ('How many issues can I analyse?', 'The tool reads the first 5,000 rows of each file. Jira Cloud exports up to 10,000 issues at a time; for bigger projects, export one file per quarter or per project.'),
               ('Can I break the numbers down by a custom field?', 'Yes. Custom fields appear in the export as "Custom field (Name)". Pick one, such as Severity, Root cause or Environment, under "Extra breakdown" to see open issues by that field.'),
               ('How do I share the report?', 'Use "Download summary (HTML)" for a single file you can attach to an email, or "Print / PDF" and save as PDF. Reports end with a small "made with" line.')],
         extra='<div class="panel"><h2>Coming next: inside Jira</h2><p>We\'re building a Jira Cloud app that shows a release-readiness scorecard and this summary live inside Jira, with no export needed. <a href="/contact/">Email us</a> if you\'d like to hear when it\'s out.</p></div>'),
    dict(t='etsy', slug='etsy-profit-dashboard', short='Etsy profit dashboard',
         title='Etsy profit calculator from your Etsy CSV files',
         h1='See your true Etsy profit from your own CSV files',
         lead='Download your Etsy Order Items CSV and your monthly payments statement CSV, drop them here and see what '
              'you really keep after transaction, processing, listing and ad fees, refunds and shipping labels, '
              'plus your best sellers and sales by month. No spreadsheet formulas, no account linking.',
         desc='Free Etsy profit calculator: drop your Order Items and statement CSVs to see true profit after every '
              'Etsy fee, ads and refunds. Files never leave your device.',
         card='True profit after every Etsy fee, ads and refunds, from your Order Items and statement CSVs.',
         gets=['True profit after Etsy fees, Etsy Ads, refunds, shipping labels and your own product cost (enter it once as a % of sales).',
               '"Where the money goes": sales split into fees, ads, shipping, refunds, product cost and what you keep.',
               'Etsy fees and costs by type, so you can see what transaction, processing and listing fees really cost you.',
               'Best-selling items, sales by month and sales by buyer country (from the Order Items CSV).',
               'Works with either file alone; both together give the full picture. A one-file HTML summary or PDF to keep with your records.'],
         steps=['Order Items: in <b>Shop Manager → Settings → Options → Download Data</b>, choose <b>Orders: Order Items</b>, pick the month or year and <b>Download CSV</b>.',
                'Payments statement: in <b>Shop Manager → Finances → Monthly statements</b>, choose a month and <b>Download CSV</b>.',
                'Drop one or both files above (or add the second one later with "Add the other Etsy file").',
                'Type your average product cost as a % of sales to see profit after materials.'],
         faqs=[('Which Etsy files do I need?', 'The Order Items CSV (what you sold) and the monthly payments statement CSV (what Etsy charged and paid). Either one works alone; with both you get sales, fees and profit together.'),
               ('How is true profit calculated?', 'Sales, minus every fee and cost line in your Etsy statement (transaction, processing, listing and other Etsy fees, Etsy Ads, shipping labels, refunds), minus the product cost you enter as a % of sales.'),
               ('Do I have to connect my Etsy shop?', 'No. There is no login and no shop connection. You download the CSVs from Etsy yourself and the numbers are worked out in your browser. Nothing is uploaded.'),
               ('Does it work for any country and currency?', 'Yes. It uses the amounts in your files as they are, so the fees match what Etsy actually charged your shop, whatever your country.'),
               ('Is there a limit?', 'The tool reads the first 5,000 rows of each file, which covers a year of orders for most small shops.')],
         extra=''),
    dict(t='attendance', slug='attendance-report-analyzer', short='Attendance report analyzer',
         title='Biometric attendance report analyzer: late, overtime, absences',
         h1='Analyse a biometric attendance report in seconds',
         lead='Drop the attendance export from your biometric machine (eSSL eTimeTrackLite, ZKTeco, BioTime) and get '
              'late arrivals, early exits, overtime, absences and missing punches per employee, with your own shift '
              'times and grace minutes. No manual Excel clean-up every month.',
         desc='Free attendance report analyzer: drop an eSSL, ZKTeco or BioTime export, get late arrivals, overtime, '
              'absences and missing punches. Nothing is uploaded.',
         card='Late arrivals, overtime, absences and missing punches from eSSL, ZKTeco or BioTime exports.',
         gets=['Attendance rate, late arrivals, average hours per day, overtime hours and missing punches for the whole team.',
               'Your rules: shift start and end, grace minutes and weekly off days (Sunday, Saturday + Sunday, Friday or none).',
               'Charts: people present per working day, arrival times in 15-minute slots, late arrivals by weekday.',
               'Top 10 for late arrivals and overtime, and an employee table sorted by most late and absent.',
               'Reads a punch log (one row per punch) or a daily In/Out report. A one-file HTML summary or PDF for HR and payroll.'],
         steps=['eSSL eTimeTrackLite: <b>Reports → Daily Attendance</b> (or <b>Monthly In/Out</b>) → <b>Export to Excel</b>, then in Excel <b>File → Save As → CSV</b>.',
                'ZKTeco / BioTime: <b>Attendance → Transactions</b>, pick the date range, then <b>Export → CSV</b>.',
                'Other devices: any export with an employee ID or name, a date and punch times (or In/Out columns) usually works.',
                'Drop the file above, then set your shift times, grace minutes and weekly off.'],
         faqs=[('Which machines and software are supported?', 'Exports from eSSL eTimeTrackLite (daily and monthly In/Out reports) and ZKTeco / BioTime transaction logs. Columns are found by their names, so most other devices that export a punch log or an In/Out report also work.'),
               ('How are late arrivals counted?', 'An employee is late when their first punch of a working day is after shift start plus your grace minutes. Change the shift or the grace and every number updates at once.'),
               ('How is overtime calculated?', 'Time between the first and last punch of the day, beyond the length of your shift; anything up to 30 minutes over is not counted. Days with only an in or only an out punch are shown as missing punches instead of being guessed.'),
               ('Is employee data uploaded?', 'No. The file is processed in your browser and never leaves your computer, which matters for staff data. There is no account and no server.'),
               ('My export is in Excel (.xlsx). What do I do?', 'Open it in Excel and use File → Save As → CSV, then drop the CSV here.')],
         extra=''),
]
