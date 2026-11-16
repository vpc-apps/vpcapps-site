"""Help pages for the marketplace apps that are not browser tools:

  /tools/sheets-dashboard-report/   Sheet to Dashboard Report (Google Sheets Editor add-on), also its OAuth home page
  /release-readiness-monday/        Release Readiness Scorecard for monday.com (how-to page; monday embeds it in an
                                    iframe, so it is built with the bare layout: no site navigation, no links out)

Sources: APPs/products/sheets_addon (LISTING.md, README.md, src/) and APPs/products/monday_release_readiness
(LISTING.md, README.md, src/, core/). Images: synthetic sample data only, made by those products' local tests
(import_images, run by build.py --assets).
"""
import os

from PIL import Image

E_MAIL = 'support@vpcapps.net'
SHEETS_APP = 'Sheet to Dashboard Report'
MONDAY_APP = 'Release Readiness Scorecard'
SHEETS_PATH = '/tools/sheets-dashboard-report/'
MONDAY_PATH = '/release-readiness-monday/'
IMG = '/assets/img/apps'

STYLE = ('<style>.doc table{width:100%;border-collapse:collapse;margin:12px 0 20px;font-size:.95em}'
         '.doc th,.doc td{border:1px solid var(--line,#ddd);padding:8px 10px;text-align:left;vertical-align:top}'
         '.doc th{background:var(--soft,#f6f6f8)}.doc .tw{overflow-x:auto}.doc h2{margin-top:32px}'
         '.doc .shot{margin:16px 0 24px}.doc .shot img{width:100%;height:auto}'
         '.doc .soon{display:inline-block;background:#fff3cd;color:#5f3a00;padding:2px 8px;border-radius:6px;font-weight:600}'
         '.doc code{overflow-wrap:anywhere}</style>')


def import_images(apps_root, site_root):
    """Copies the synthetic screenshots into the site as WebP (called by build.py --assets)."""
    dest = os.path.join(site_root, 'assets', 'img', 'apps')
    os.makedirs(dest, exist_ok=True)
    sheets = os.path.join(apps_root, 'products', 'sheets_addon', 'store')
    monday = os.path.join(apps_root, 'products', 'monday_release_readiness', 'tests', 'out')
    jobs = [  # (source, crop box or None, output name)
        (os.path.join(sheets, 'screenshot_5_sidebar.png'), None, 'sheets-sidebar.webp'),
        (os.path.join(sheets, 'screenshot_1_generic.png'), None, 'sheets-report-generic.webp'),
        (os.path.join(sheets, 'screenshot_2_jira.png'), None, 'sheets-report-jira.webp'),
        (os.path.join(monday, '03_report_nogo.png'), (0, 0, 1280, 900), 'monday-report.webp'),
        (os.path.join(monday, '02_settings.png'), None, 'monday-settings.webp'),
    ]
    for src, box, name in jobs:
        im = Image.open(src).convert('RGB')
        if box:
            im = im.crop(box)
        im.save(os.path.join(dest, name), 'WEBP', quality=84, method=6)
    print('app help images -> assets/img/apps/')


def table(head, rows):
    return ('<div class="tw"><table><thead><tr>' + ''.join(f'<th>{h}</th>' for h in head) + '</tr></thead><tbody>' +
            ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows) + '</tbody></table></div>')


def shot(name, w, h, alt, cap):
    return (f'<figure class="shot"><img src="{IMG}/{name}" alt="{alt}" width="{w}" height="{h}" loading="lazy">'
            f'<figcaption class="muted small">{cap}</figcaption></figure>')


# ------------------------------------------------------------------ Google Sheets add-on ----

def sheets_body():
    templates = table(['Report type', 'Best for', 'What the report shows'], [
        ['Any table (generic)', 'Sales lists, ticket exports, inventories, survey results',
         'Rows, % of cells filled in, totals of money columns, date range, duplicates, top values per category, rows and totals per day / week / month, number stats, a category-by-category table and a data-quality check'],
        ['Jira issues', 'A Jira issues export pasted or imported into a sheet',
         'Open vs resolved, backlog change over 4 weeks, median time to resolve, age of open issues, open by priority / assignee / component, high-priority issues open more than 30 days, reopened issues'],
        ['Etsy orders / payments statement', 'The Etsy Order Items export, the payments statement, or both (one in another sheet)',
         'Item sales, every Etsy fee by type, ads, refunds, product cost, true profit and margin, by month, best sellers'],
        ['Biometric attendance', 'A punch log or a daily In/Out report from an attendance machine',
         'Attendance rate, late arrivals, early outs, overtime, absences and missing punches, by department and per employee'],
    ])
    perms = table(['What Google shows on the consent screen', 'Why the add-on needs it'], [
        ['<b>See, edit, create and delete only the specific Google Sheets spreadsheets that you use this app with</b><br><code>spreadsheets.currentonly</code>',
         'To read the table you choose in the spreadsheet you have open. It is also used to add one sheet named “Report KPIs” to that same spreadsheet, and only when you click <b>Copy KPIs to a new sheet</b>. It gives no access to your Google Drive or to any other file.'],
        ['<b>Display and run third-party web content in prompts and sidebars inside Google applications</b><br><code>script.container.ui</code>',
         'To show the add-on’s sidebar (the report options) and the report window inside Google Sheets.'],
    ])
    return f'''<nav class="wrap crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/tools/">Tools</a> › <span>{SHEETS_APP}</span></nav>
<section class="wrap section narrow doc page-head">
  <p class="eyebrow">Google Sheets add-on</p>
  <h1>{SHEETS_APP}</h1>
  <p class="lead">Turn the table in your sheet into a dashboard report your team can read in a minute: KPI cards with good / warning / problem colours, charts that explain themselves, key findings in plain English and bordered tables. Free, no sign-up, and your data stays in your spreadsheet.</p>
  <p><span class="soon">Coming soon</span> The add-on is waiting for Google Workspace Marketplace approval. This page will link to the Marketplace listing as soon as it is live.</p>
  <p class="muted">Contents: <a href="#what">What it does</a> · <a href="#install">Install</a> · <a href="#use">How to use it</a> · <a href="#templates">Report types</a> · <a href="#limits">Limits</a> · <a href="#permissions">Permissions</a> · <a href="#privacy">Privacy</a> · <a href="#support">Support</a></p>
</section>
<section class="wrap section narrow doc">
  <h2 id="what">What it does</h2>
  <p>The add-on reads the table in the sheet you have open (or your selection) and builds a dashboard report in a window inside Google Sheets. It recognises Jira, Etsy and attendance exports by their column names and gives them tailored reports; any other table gets a general summary. It uses the same report engine as our free <a href="/tools/">CSV to Dashboard</a> web tool.</p>
  <ul>
    <li><b>Download HTML report</b>: one HTML file with the whole report. It opens in any browser, offline, and contains no scripts, so you can email it or attach it to a ticket.</li>
    <li><b>Copy KPIs to a new sheet</b>: adds a sheet named “Report KPIs” with the report’s headline numbers, as plain values.</li>
  </ul>
  {shot('sheets-report-generic.webp', 1280, 800, 'A dashboard report built from a synthetic sales sheet: KPI cards, key findings and bar charts', 'Example report from a synthetic sales list (invented data).')}

  <h2 id="install">Install</h2>
  <p><span class="soon">Coming soon</span> Once Google approves the add-on:</p>
  <ol class="steps">
    <li>Open a spreadsheet in Google Sheets.</li>
    <li>Choose <b>Extensions → Add-ons → Get add-ons</b> and search for <b>{SHEETS_APP}</b>.</li>
    <li>Click <b>Install</b> and review the two permissions (explained <a href="#permissions">below</a>).</li>
  </ol>
  <p>A Google Workspace administrator can also install it for a whole domain from the Marketplace.</p>

  <h2 id="use">How to use it</h2>
  <ol class="steps">
    <li>Open your sheet. The first row must hold the column names, with one record per row below. The table can start lower down or further right: blank rows and columns are skipped.</li>
    <li>Choose <b>Extensions → {SHEETS_APP} → Open</b>. The sidebar opens on the right.</li>
    <li>Under <b>Data</b>, choose <b>Whole sheet</b> or <b>Current selection</b>. If you change the sheet or the selection while the sidebar is open, click <b>Refresh</b>.</li>
    <li>Leave <b>Report type</b> on <b>Auto-detect from the column names</b>, or pick one.</li>
    <li>Optionally open <b>More options</b>: a report title, a second sheet for Etsy (order items and statement together), the Jira issue type (empty = Bug, <code>*</code> = all types), the Etsy product cost as a % of sales, and the attendance shift start and end, grace minutes and weekly off.</li>
    <li>Click <b>Build report</b>. The report opens in a window; from there you can download it or copy the KPIs.</li>
  </ol>
  {shot('sheets-sidebar.webp', 1280, 800, 'The add-on sidebar next to a sheet: data choice, report type, More options and the Build report button', 'The sidebar (preview with a synthetic sheet).')}

  <h2 id="templates">Report types</h2>
  {templates}
  {shot('sheets-report-jira.webp', 1280, 800, 'A Jira issues report built from a synthetic Jira export', 'Jira report from a synthetic Jira export (invented data).')}

  <h2 id="limits">Limits</h2>
  <ul>
    <li>Free. The report covers the <b>first 5,000 rows</b> of a sheet or selection; the sidebar and the report say so when a table is longer.</li>
    <li>One kind of export per report (two sheets only for Etsy’s order items + statement).</li>
    <li>Dates are read as Sheets stores them, in the spreadsheet’s time zone. Numbers and money keep the format shown in the cells.</li>
  </ul>

  <h2 id="permissions">Permissions, in plain words</h2>
  <p>The add-on asks for two permissions and nothing else:</p>
  {perms}
  <p>It has <b>no</b> Google Drive permission, no permission to connect to outside services, and no access to your email, contacts or other files.</p>

  <h2 id="privacy">Privacy</h2>
  <ul>
    <li>Your data stays in your spreadsheet and the report window. The add-on reads the cells inside Google and builds the report in your browser window. <b>Nothing is sent to VPC Apps</b> or anyone else, and nothing is stored, logged, or used for advertising or AI training.</li>
    <li>The add-on reads only the sheet or selection you choose, only while you use it.</li>
    <li>A downloaded report is a file on your device; where it goes is up to you.</li>
  </ul>
  <p>VPC Apps’ use and transfer of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener">Google API Services User Data Policy</a>, including the Limited Use requirements. Full details: our <a href="/privacy/#sheets-add-on">privacy policy</a> and <a href="/terms/">terms of use</a>.</p>

  <h2 id="support">Support</h2>
  <p>Email <a href="mailto:{E_MAIL}">{E_MAIL}</a> with the report type, what you expected and what you saw. Please do not send real customer or staff data; a screenshot with details hidden, or a few made-up rows with the same columns, is enough.</p>
  <p class="muted">Google Sheets and Google Workspace are trademarks of Google LLC. This add-on is made by VPC Apps and is not made or endorsed by Google.</p>
</section>'''


# ------------------------------------------------------------------ monday.com app ----

def monday_body():
    verdicts = table(['Verdict', 'Means'], [
        ['<b>GO</b>', 'Every rule is at or below its GO limit.'],
        ['<b>AT RISK</b>', 'No rule fails, but at least one is above its GO limit (and at or below its AT RISK limit).'],
        ['<b>NO-GO</b>', 'At least one rule is above its AT RISK limit.'],
        ['<b>NO DATA</b>', 'No defects are linked to this release. An empty release never reads as GO. Check the Release column in Settings, or pick another release.'],
    ])
    mapping = table(['Role', 'Column types', 'If you leave it empty'], [
        ['<b>Status</b> (required)', 'Status', '–'],
        ['Release', 'Board groups, the whole board, or a dropdown / status / text / connected board / mirror / tags column', 'The whole board is one release'],
        ['Priority / severity', 'Status, dropdown, text', 'The two priority rules count nothing (a notice says so)'],
        ['Item type', 'Status, dropdown, text', 'Every item counts as a defect. With it, only items whose type says Bug or Defect are scored; the rest go to the release notes'],
        ['Created date', 'Date, creation log', 'The item’s monday.com creation date (wrong for imported boards)'],
        ['Resolved date', 'Date', 'The last update of done items, as an estimate (a notice says so)'],
        ['Assignee', 'People, text', '“Unassigned”'],
        ['Found in release', 'Dropdown, status, text, connected board, mirror, tags', 'No “found after the previous release shipped” card'],
        ['Description', 'Long text, text', 'Quality checks read the item name only'],
        ['Environment', 'Text, long text, dropdown, status, tags', 'The environment check reads the description only'],
        ['Files / evidence', 'File', 'The evidence check looks for links in the description only'],
        ['Reopen count', 'Numbers (times reopened) or checkbox (reopened once)', 'The reopen-rate rule shows “not measured” and passes (a notice says so)'],
    ])
    rules = table(['Rule', 'GO at or below', 'AT RISK at or below'], [
        ['Open blocker / critical defects', '0', '0'],
        ['Open high-priority defects', '2', '5'],
        ['Reopen rate', '10%', '20%'],
        ['Defects open more than 30 days', '3', '10'],
        ['Created minus resolved, last 14 days', '0', '5'],
        ['Open defects without steps or attachment', '25%', '100%'],
    ])
    templates = table(['Template', 'For', 'In short'], [
        ['Strict', 'Regulated or enterprise releases', 'No open critical or high defects, nothing left open for 30 days, a low reopen rate'],
        ['Standard', 'Most teams', 'The built-in defaults in the table above'],
        ['Fast-moving', 'Startups and internal tools', 'Limits as a share of all defects, more room for open work; only critical defects block'],
    ])
    quality = table(['Check', 'Passes when'], [
        ['Steps to reproduce', 'A “Steps to reproduce” (or STR / Repro) heading, or a numbered list'],
        ['Expected and actual result', 'Both an expected and an actual result are written down'],
        ['Environment stated', 'The Environment column, or browser / OS / device / build words'],
        ['Evidence attached', 'A file in the Files column, or a link to a screenshot, video or log'],
        ['Clear title', 'More than 3 words, and more than “not working”, “issue” or “error”'],
    ])
    return f'''<section class="wrap section narrow doc page-head">
  <p class="eyebrow">How to use</p>
  <h1>{MONDAY_APP} for monday.com</h1>
  <p class="lead">Know if this release can ship, with the reasons. This board view turns your QA or bugs board into a <b>GO / AT RISK / NO-GO</b> verdict for a release, with the checks behind it, charts, a defect report quality check and release notes.</p>
  <p class="muted">On this page: setup, what the verdict means, the six rules and how to change them, quality checks, release notes, printing and sharing, permissions, privacy and support.</p>
</section>
<section class="wrap section narrow doc">
  <h2>Before you start</h2>
  <ul>
    <li>A monday.com board where each item is a defect (or a mix of defects and other work items), with a <b>Status</b> column.</li>
    <li>Somewhere that says which release each item belongs to: board groups, a dropdown, a connected board, or similar. Without it the whole board counts as one release.</li>
    <li>Optional but useful: priority, created and resolved dates, a description, environment, files and a reopen count.</li>
  </ul>

  <h2>Set up</h2>
  <ol class="steps">
    <li>Install <b>{MONDAY_APP}</b> from the monday.com apps marketplace (an account admin may need to approve it).</li>
    <li>On your QA or bugs board, add a view (the <b>+</b> next to the board’s views) and choose <b>{MONDAY_APP}</b>.</li>
    <li>The welcome page explains the app. Click <b>Set up columns</b>.</li>
    <li>In <b>Settings</b>, check the suggested mapping (the app guesses from your column names), tick the status labels that mean <b>done</b>, and click <b>Save settings</b>.</li>
    <li>Pick a <b>Release</b> at the top. The scorecard appears.</li>
  </ol>
  <p>Only <b>Status</b> is required. Everything else is optional, and the report says what is missing in a notice above it, never as a silent zero. One column cannot be used for two roles.</p>
  {mapping}
  <p>Done labels: a status label counts as done when monday.com marks it done (the green “Done” style) or by its name (Done, Fixed, Closed, Verified…). You can change the ticks in Settings.</p>
  <p>Priority labels are read by name: Critical also covers Blocker, Highest, Urgent, P0, S0/S1 and Sev 0/1; High covers Major, P1 and S2. Labels with other names keep their own name and count in neither priority rule.</p>
  <p>Timeline columns are not offered as a release, because a date range is not a release name. Use groups or a dropdown.</p>
  {shot('monday-settings.webp', 1280, 1032, 'The Settings page of the scorecard: one dropdown per role, done labels ticked, Save settings', 'Settings with a suggested mapping (preview with a synthetic board).')}

  <h2>What the verdict means</h2>
  <p>Each rule compares a number with two limits: at or below the <b>GO</b> limit it passes; above GO but at or below <b>AT RISK</b> it is at risk; above AT RISK it fails. The overall verdict is the worst result of any rule.</p>
  {verdicts}
  <p>The verdict supports your release decision; it does not replace it. It reflects only what is recorded on the board.</p>
  {shot('monday-report.webp', 1280, 900, 'A NO-GO scorecard for release 2.4: summary cards per rule and the go/no-go rules table', 'A NO-GO scorecard for a synthetic release (invented data).')}

  <h2>The six rules</h2>
  {rules}
  <ul>
    <li>“Open” means the status is not one of the done labels.</li>
    <li>The four count rules can instead be set as a <b>% of all defects</b> in the release. Reopen rate and the evidence rule are always percentages.</li>
    <li>Without a Reopen count column, the reopen-rate rule is shown as “not measured” and passes.</li>
  </ul>

  <h2>Changing the rules</h2>
  <p>Click <b>Edit rules</b>. Start from a template if you like, change the numbers (whole numbers; each AT RISK limit at or above its GO limit) and click <b>Save rules</b>. <b>Use defaults</b> goes back to the built-in limits. Choosing a template only fills the editor; nothing is saved until you click Save rules.</p>
  {templates}
  <p><b>Who can change them:</b> settings and limits are saved per board and shared by everyone who opens that board’s scorecard. Board viewers and guests see them read-only (<b>View rules</b>). Any board member can change them.</p>

  <h2>Report views</h2>
  <p>The <b>View</b> menu chooses which reports you see, print in full and download: <b>Executive</b> (the verdict, a card per rule, the comparison and blockers), <b>QA lead</b> (everything) or <b>Release manager</b> (comparison, priority mix, defects found after the last release shipped, status by priority, age and assignee). When there is an earlier release with defects, the report compares this release with it.</p>

  <h2>Defect report quality checks</h2>
  <p>Each defect is checked for five things, rule-based (no AI). The checks are advisory: they show which defects are hard to verify.</p>
  {quality}
  <p>The app reads the board’s columns only. <b>Item updates are not read</b>, so put the steps to reproduce in a Description column for the quality check.</p>

  <h2>Release notes</h2>
  <p>The report lists the release’s items grouped as new features, improvements, fixed defects and known issues, with a short summary paragraph. <b>Copy as</b> Text, Markdown or HTML copies every line, ready to paste into a changelog or an email. If the browser blocks copying inside monday.com, the text is selected for you to press Ctrl+C (Cmd+C on a Mac).</p>

  <h2>Print and download</h2>
  <ul>
    <li><b>Print summary (1 page)</b>: the verdict, the summary cards and the key charts on one A4 page.</li>
    <li><b>Print full report</b>: every report in the chosen view, over as many pages as needed.</li>
    <li><b>Download shareable report</b>: one HTML file with no scripts that opens in any browser, for people without monday.com access.</li>
  </ul>
  <p>Use the app’s own buttons. The browser’s Print menu prints the whole monday.com page instead. Printed and downloaded reports contain item names, priorities and assignee names: treat them like any board export.</p>

  <h2>Limits</h2>
  <ul>
    <li>The app reads up to 10,000 items of a board; above that the report says <b>partial data</b>.</li>
    <li>Without a Resolved date column, fix times are estimated from the item’s last update.</li>
  </ul>

  <h2>Permissions</h2>
  <p>The app asks for one permission: <code>boards:read</code>, to read the board’s name, groups, columns and items. It has no write permission, so it <b>never changes your board</b>. It does not read item updates, your account’s users or anything outside the board you open it on. It reads with your own monday.com access, so each person sees only what they are allowed to see.</p>
  <p>The column mapping, done labels and rule limits are saved per board in monday.com’s own app storage. Nothing else is saved: no item content.</p>

  <h2>Privacy</h2>
  <ul>
    <li>The app runs in your browser on monday.com and is hosted by monday.com. VPC Apps has no server for it.</li>
    <li>Board data is read only to build the report on your screen. It is not sent to VPC Apps or anyone else, and it is not stored or logged.</li>
    <li>No AI, no analytics and no advertising inside the app.</li>
    <li>A downloaded or printed report is a file on your device; you control who receives it.</li>
  </ul>
  <p>Full privacy policy: vpcapps.net/privacy (section “Release Readiness Scorecard for monday.com”). Terms of use: vpcapps.net/terms. This help page itself counts anonymous visits with Cloudflare Web Analytics (no cookies); the app inside monday.com does not.</p>

  <h2>Support</h2>
  <p>Email <b>{E_MAIL}</b> with the release name, what you saw, and the build number shown at the bottom of the app. Please do not send real defect content; a screenshot with details hidden is fine. We use your email only to answer you; we do not contact users otherwise.</p>
  <p class="muted">monday.com is a trademark of monday.com Ltd. This app is made by VPC Apps and is not made or endorsed by monday.com.</p>
</section>'''


def build(page, tool_app_ld=None, site_url='https://vpcapps.net'):
    """Called from build.py main()."""
    ld = []
    if tool_app_ld:
        a = tool_app_ld(SHEETS_APP, 'Google Sheets add-on that turns a table into a dashboard report: KPI cards, charts and '
                        'plain-English findings. Templates for Jira, Etsy and attendance exports.', site_url + SHEETS_PATH,
                        site_url + IMG + '/sheets-report-generic.webp')
        a['operatingSystem'] = 'Google Sheets (web)'
        ld.append(a)
        ld.append({'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': site_url + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Tools', 'item': site_url + '/tools/'},
            {'@type': 'ListItem', 'position': 3, 'name': SHEETS_APP, 'item': site_url + SHEETS_PATH}]})
    page(SHEETS_PATH, f'{SHEETS_APP}: Google Sheets add-on',
         'Help for the Sheet to Dashboard Report add-on for Google Sheets: install, how to use it, report types, the '
         '5,000-row limit, the two permissions and privacy. Your data stays in your spreadsheet.',
         sheets_body(), extra_head=STYLE, active='/tools/', ld=ld)
    page(MONDAY_PATH, f'{MONDAY_APP} for monday.com: how to use',
         'How to set up and use Release Readiness Scorecard for monday.com: column mapping, GO / AT RISK / NO-GO / NO DATA, '
         'the six rules, quality checks, release notes, printing, permissions and privacy.',
         monday_body(), extra_head=STYLE, bare=True)
