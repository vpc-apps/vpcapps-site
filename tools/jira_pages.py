"""vpcapps.net/jira/ pages for the Go/No-Go Release Scorecard for Jira listing: documentation, privacy policy, security.
Source drafts: APPs/docs/listings/jira_release_readiness/. Updated for app 3.8.0 (production 2.0.0) on 2026-11-08.
Values only the owner can give are marked [USER: ...] and listed in APPs/docs/listings/jira_release_readiness/SUBMIT_TOMORROW.md.
"""

APP = 'Go/No-Go Release Scorecard for Jira'
SHORT = 'Go/No-Go Release Scorecard'
UPDATED_ON = '8 November 2026'
# Owner details (filled from the repo docs where known; the rest stays visibly open until the owner fills it).
TRADE_NAME = 'Venture Path Consulting'
LEGAL_NAME = '[USER: proprietor’s legal name, as on the GST registration]'
ADDRESS = '[USER: business address, as on the GST registration], Visakhapatnam, Andhra Pradesh, India'
REPLY_TIME = '2 business days'

STYLE = ('<style>.doc table{width:100%;border-collapse:collapse;margin:12px 0 20px;font-size:.95em}'
         '.doc th,.doc td{border:1px solid var(--line,#ddd);padding:8px 10px;text-align:left;vertical-align:top}'
         '.doc th{background:var(--soft,#f6f6f8)}.doc .tw{overflow-x:auto}.doc h2{margin-top:32px}.doc .todo{background:#fff3cd;color:#5f3a00;padding:0 4px;border-radius:3px}</style>')


def mark(s):
    """Shows [USER: ...] placeholders highlighted, so nobody can miss them on the live page."""
    import re
    return re.sub(r'\[USER: [^\]]*\]', lambda m: '<span class="todo">' + m.group(0) + '</span>', s)


def table(head, rows):
    return ('<div class="tw"><table><thead><tr>' + ''.join(f'<th>{h}</th>' for h in head) + '</tr></thead><tbody>' +
            ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows) + '</tbody></table></div>')


def docs_body():
    rules = table(['Rule', 'How it is counted', 'GO at or below', 'AT RISK at or below'], [
        ['Open blocker / critical defects', 'Open defects with priority Highest, Blocker, Critical, Urgent, Showstopper or P0', '0', '0'],
        ['Open high-priority defects', 'Open defects with priority High, Major or P1', '2', '5'],
        ['Reopen rate', 'Share of the release’s defects moved from a done status back to a not-done status at least once', '10%', '20%'],
        ['Defects open more than 30 days', 'Open defects created over 30 days ago', '3', '10'],
        ['Created minus resolved, last 14 days', 'Defects in this release created, minus those resolved, in the last 14 days', '0', '5'],
        ['Open defects without steps or attachment', 'Share of open defects with no attachment and no description text such as “steps to reproduce”, “expected result” or “actual result”', '25%', '100%'],
    ])
    templates = table(['Template', 'For', 'In short'], [
        ['Strict', 'Regulated or enterprise releases', 'No open critical or high defects, nothing left open for 30 days, a low reopen rate'],
        ['Standard', 'Most teams', 'The built-in defaults in the table above'],
        ['Fast-moving', 'Startups and internal tools', 'Limits as a share of all defects, more room for open work; only critical defects block'],
    ])
    views = table(['View', 'Shows'], [
        ['Executive', 'The verdict, a card per rule, the comparison with the previous release, the trend and open blocker defects'],
        ['QA lead', 'Everything: all charts and tables'],
        ['Release manager', 'The comparison, priority mix, carried-over defects, defects found after the last release shipped, status by priority, age and assignee'],
    ])
    trouble = table(['You see', 'What to do'], [
        ['No defects are linked to this release (NO DATA)', 'Check the defects use Fix versions with this exact release. In a team-managed space, add the Releases view first'],
        ['This project has no releases yet', 'Add a release, set it as Fix versions on the defects, and come back'],
        ['This project has no issue type named Bug or Defect', 'The app only scores those types. Add one, or rename yours if that suits your project'],
        ['Priority rules show 0 but you have urgent defects', 'Add Priority to the Bug type (above), and check your priority names against the rules table'],
        ['“Found after it shipped” is always empty', 'Set Affects versions on defects, and check the previous release is marked released with a release date. Team-managed spaces do not offer this field'],
        ['No comparison with the previous release', 'Shown only when there is a previous released release with a release date that has defects'],
        ['Partial data', 'The release has over 2,000 defects, so only the first 2,000 were read'],
        ['Could not read this from Jira', 'The message gives the reason. The app sees only what you can see, so ask for access if needed. If Jira is busy, wait a minute and reload'],
        ['Only project admins and Jira admins can change these rules', 'Ask one of them to change the limit'],
        ['The saved go/no-go rules could not be loaded', 'The verdict uses the defaults for now. Reload to try again. Editing is off until they load, so saved limits cannot be overwritten'],
        ['Could not save the rules', 'The app already tried twice. Nothing changed; try again in a moment'],
        ['The licence for this site is not active', 'A Jira admin can renew it under Apps'],
        ['The print comes out blank', 'Use the app’s own Print summary or Print full report button'],
        ['Age numbers look wrong', 'They are based on Jira’s created and resolved dates; imported defects may carry their import date'],
    ])
    return f'''<section class="wrap section narrow doc page-head">
  <p class="eyebrow">Documentation</p>
  <h1>{APP}</h1>
  <p class="lead">Know if this release can ship, with the reasons. The app reads a release’s defects in your Jira project and shows GO, AT RISK, NO-GO or NO DATA. It works on Jira Cloud.</p>
  <p class="muted">Contents: <a href="#setup">Set up</a> · <a href="#team-managed">Team-managed spaces</a> · <a href="#verdicts">How verdicts work</a> · <a href="#rules">Rules, templates and views</a> · <a href="#compare">Compared with the previous release</a> · <a href="#print">Print and share</a> · <a href="#gadget">Dashboard gadget</a> · <a href="#trouble">Troubleshooting</a> · <a href="#data">Your data</a> · <a href="#support">Support</a></p>
</section>
<section class="wrap section narrow doc">
  <h2 id="setup">Set up</h2>
  <ol class="steps">
    <li>A Jira admin installs the app from the Atlassian Marketplace.</li>
    <li>Open your project. <b>{SHORT}</b> appears as a tab in the project’s navigation (in some layouts under <b>Apps</b> or the <b>+</b> next to the tabs).</li>
    <li>Pick a release. The first one offered is the next unreleased release.</li>
  </ol>
  <p>For a useful result, your project needs:</p>
  {table(['Needed', 'Why'], [
      ['An issue type with “Bug” or “Defect” in its name', 'Only these are scored'],
      ['At least one release', 'The picker lists your project’s releases'],
      ['<b>Fix versions</b> set on defects', 'This links a defect to a release'],
      ['<b>Priority</b> on defects', 'The two priority rules read it'],
      ['Affects versions on defects (optional)', 'Used for “found in the last release after it shipped”'],
  ])}
  <p>Company-managed projects usually have Fix versions and Priority on the Bug screen already.</p>

  <h2 id="team-managed">Team-managed spaces</h2>
  <p>A new team-managed space shows neither Fix versions nor Priority on a Bug. Two steps fix this:</p>
  <p><b>Add Fix versions:</b> click the <b>+</b> next to the space tabs, choose <b>Releases</b>, then <b>Add to navigation</b>. The Fix versions field then appears on your work items.</p>
  <p><b>Add Priority:</b> go to <b>Space settings → Work types → Bug</b>, click <b>Priority</b>, then <b>Save changes</b>.</p>
  <p>Team-managed layouts do not offer Affects versions, so “found after it shipped” stays empty there. It is for information and does not change the verdict. In a team-managed space the app shows a short setup box with only the steps your report needs; it is left out of prints and downloads.</p>

  <h2 id="verdicts">How verdicts work</h2>
  <p>Each rule compares a number with two limits: at or below <b>GO</b> it passes; above GO but at or below <b>AT RISK</b> it is at risk; above AT RISK it fails. The overall verdict is the worst result of any rule. If no defects are linked to the release, the verdict is <b>NO DATA</b>, never GO.</p>
  <p>Default limits:</p>
  {rules}
  <ul>
    <li>“Open” means the status is not in Jira’s Done category.</li>
    <li>The four count rules can instead be set as a <b>% of all defects</b> in the release (“Count as” in the rules editor, 0–100). Reopen rate and the evidence rule are always percentages.</li>
    <li>Priorities with other names, such as “P2”, are not counted by the priority rules. Description text is matched in English only.</li>
    <li>The app reads the first 2,000 defects of a release; above that the report says <b>partial data</b>.</li>
  </ul>
  <p>The verdict supports your decision; it does not replace it. It reflects only what is recorded in Jira and does not read test runs or test cases.</p>

  <h2 id="rules">Rules, templates and views</h2>
  <p><b>Changing the limits.</b> Project admins and Jira admins see <b>Edit rules</b>. Change the numbers (whole numbers; each AT RISK limit at or above its GO limit) and click <b>Save rules</b>. Limits are kept per project and apply to everyone viewing that project. The report then says the verdict was recalculated and highlights the checks whose result changed. <b>Use defaults</b> restores the Standard limits. Everyone else sees <b>View rules</b>, read-only. The rules card says whether the report uses limits set for this project or the defaults.</p>
  <p><b>Criteria templates.</b> In the rules editor, start from a template, then adjust; nothing is saved until you click Save rules.</p>
  {templates}
  <p><b>Report views.</b> The <b>View</b> menu chooses which reports you see, print in full and download:</p>
  {views}

  <h2 id="compare">Compared with the previous release</h2>
  <p>When the project has a previous released release (marked released, with a release date) that has defects, the report adds:</p>
  <ul>
    <li>Change cards: defects, highest/critical, high, reopen rate and median days to fix, with green (better) or red (worse) arrows. Lower is better on every card; rate changes are in percentage points.</li>
    <li>Priority mix: this release and the previous one side by side.</li>
    <li>Carried over: defects of this release that are also set to the previous release, or were moved out of it (from the Fix version history). Shown only when there are any.</li>
  </ul>
  <p>With no previous release, or one without defects, the comparison is left out rather than showing empty numbers. It is on screen and in the download, not on the one-page print.</p>

  <h2 id="print">Print and share</h2>
  <ul>
    <li><b>Print summary (1 page)</b>: the verdict, one card per rule and the key charts on one A4 page, readable in black and white.</li>
    <li><b>Print full report</b>: every chart and table of the chosen view, over several pages.</li>
    <li><b>Download shareable report</b>: one HTML file with no scripts, for people without Jira access.</li>
  </ul>
  <p>Use the app’s own buttons. The browser’s Print menu, or Ctrl+P while the focus is on Jira’s page, may come out blank, because the app sits in a frame inside the Jira page. Pressing Ctrl+P after clicking inside the app prints the summary.</p>
  <p>Printed and downloaded reports contain defect keys, summaries, priorities and assignee names. Treat them as you would any Jira export.</p>

  <h2 id="gadget">Dashboard gadget</h2>
  <ol class="steps">
    <li>On a Jira dashboard, choose <b>Add gadget</b> and find <b>{SHORT}</b>.</li>
    <li>In its settings, enter a <b>project key</b>, such as WEB, and optionally a <b>release</b> (empty means the next unreleased one) and a view.</li>
  </ol>

  <h2 id="trouble">Troubleshooting</h2>
  {trouble}

  <h2 id="data">Your data</h2>
  <ul>
    <li>The app reads issues in your browser, with your own Jira permissions, through Atlassian’s platform. Nothing goes to VPC Apps or any other outside service.</li>
    <li>It stores only what an admin sets for a project: the rule limits, how each rule is counted and the template it came from, in Atlassian’s Forge storage for your site. No issue data and no personal data is stored.</li>
    <li>To check who may edit limits, the app asks Jira for the viewer’s own project permissions, on Atlassian’s platform. The answer is not stored.</li>
    <li><b>In-scope End-User Data for data residency:</b> the saved rule settings and the project ID they belong to, in Forge hosted storage, which follows your Jira site’s location. <b>Out of scope:</b> nothing else is stored; issue data is read at viewing time and not kept.</li>
    <li>After you uninstall, Atlassian’s Forge storage keeps the app’s data for 28 days, then removes it.</li>
    <li>This documentation page, like the rest of vpcapps.net, counts anonymous visits with Cloudflare Web Analytics (no cookies). The app inside Jira has no visit counter.</li>
  </ul>
  <p>See the <a href="/jira/privacy/">privacy policy</a> and the <a href="/jira/security/">security policy</a>.</p>
  <p class="muted">Jira is a trademark of Atlassian. VPC Apps is an independent Atlassian Marketplace partner; this app is not made or endorsed by Atlassian.</p>

  <h2 id="support">Support</h2>
  <p>Email <a href="mailto:support@vpcapps.net">support@vpcapps.net</a> with the release name, what you saw, and the build number shown at the bottom of the app. Please do not send customer data or real defect content; a screenshot with details hidden is fine. We reply within {REPLY_TIME}.</p>
</section>'''


def privacy_body():
    return f'''<section class="wrap section narrow doc page-head">
  <p class="eyebrow">Privacy policy</p>
  <h1>Privacy policy: {APP}</h1>
  <p class="muted">Last updated {UPDATED_ON}.</p>
</section>
<section class="wrap section narrow doc">
  <p>This policy covers the app named above (“the app”), offered on the Atlassian Marketplace by VPC Apps, a brand of {TRADE_NAME}, a sole proprietorship of {LEGAL_NAME}, {ADDRESS} (“we”). The website has <a href="/privacy/">its own policy</a>.</p>
  <h2>Summary</h2>
  <ul>
    <li>The app shows you a report built from your Jira data, in your browser.</li>
    <li>That data does not come to us. We have no servers for this app.</li>
    <li>The app saves only your project’s go/no-go rule settings, in Atlassian’s storage for your site.</li>
  </ul>
  <h2>What the app reads</h2>
  <p>When you open the app, your browser reads the following from your Jira site, using your own Jira permissions:</p>
  <ul>
    <li>The project’s name, issue types and releases.</li>
    <li>For the defects in the chosen release, and in the previous release when there is one: key, summary, status, priority, type, assignee display name, dates, releases, attachment list, description and change history.</li>
  </ul>
  <p>The app uses this to calculate the report on screen. It is not saved, logged or sent anywhere. When you close the page, the report is gone unless you have printed or downloaded it.</p>
  <h2>What the app stores</h2>
  <p>If a project admin or Jira admin changes the go/no-go limits, the app saves, under the project’s Jira ID: each rule’s identifier, its two limits, whether it is counted as a number or a percentage, and the criteria template it came from. This is kept in Atlassian Forge hosted storage for your Jira site. It contains no issue content and no personal data, and the app does not record who changed it.</p>
  <p>To decide whether you may change the limits, the app asks Jira about your own permissions on that project each time. This check runs on Atlassian’s platform, and its answer is not saved.</p>
  <h2>Where data is processed</h2>
  <p>The app runs entirely on Atlassian’s platform and in your browser. Atlassian hosts the app and its storage, and stores data in the location of your Jira site. Atlassian’s handling is described in <a href="https://www.atlassian.com/legal/privacy-policy">Atlassian’s privacy policy</a>. We use no other providers for the app, and we do not share your data, because we do not receive it.</p>
  <p>The app’s dashboard-gadget icon is an image file hosted on vpcapps.net. When Jira shows it, your browser fetches it like any image on the web; no Jira data is sent with that request.</p>
  <p>The app has no analytics, tracking, advertising or AI features.</p>
  <h2>Files you create</h2>
  <p><b>Print summary</b>, <b>Print full report</b> and <b>Download shareable report</b> create a file on your device that can include defect keys, summaries, priorities and assignee names. You control that file and who receives it.</p>
  <h2>Purchases</h2>
  <p>If your site pays for the app, you buy through Atlassian, which handles billing. Atlassian may give us business details about the licence, such as the site and the technical and billing contacts named on it, through its partner reports. We use those only to run our business, support you and meet legal duties.</p>
  <h2>Support email</h2>
  <p>If you email support@vpcapps.net, we use your message and address to answer you, and delete the conversation when it is no longer needed. Please do not send customer data or real defect content.</p>
  <h2>Retention and deletion</h2>
  <p>Rule settings stay until you change them or uninstall the app. After uninstalling, Atlassian’s hosted storage keeps the data for 28 days and then removes it. Because we hold no copy, there is nothing further for us to delete, other than support emails.</p>
  <h2>Your rights</h2>
  <p>Depending on where you live (for example under the EU or UK GDPR, California’s CCPA or India’s Digital Personal Data Protection Act), you may have rights to access, correct or delete personal data, or to object to its use. For data in your Jira site, contact your Jira administrator, who controls it. For support emails, write to us at support@vpcapps.net and we will answer within 30 days.</p>
  <h2>Children</h2>
  <p>The app is for business use and is not directed at children.</p>
  <h2>Changes and contact</h2>
  <p>We will post changes on this page with a new date, and update it before the app handles data in any new way. Contact: <a href="mailto:support@vpcapps.net">support@vpcapps.net</a>, or by post to {TRADE_NAME}, {ADDRESS}.</p>
</section>'''


def security_body():
    return f'''<section class="wrap section narrow doc page-head">
  <p class="eyebrow">Security</p>
  <h1>Security: {APP}</h1>
  <p class="muted">Last updated {UPDATED_ON}.</p>
</section>
<section class="wrap section narrow doc">
  <h2>How the app is built</h2>
  <ul>
    <li><b>Atlassian Forge, Runs on Atlassian.</b> The app is hosted entirely on Atlassian’s Forge platform. Atlassian’s deploy check reports it eligible for the Runs on Atlassian program: no remote servers and no outgoing connections to other services.</li>
    <li><b>Read-only access.</b> It asks for two scopes only: <code>read:jira-work</code> (to read projects, releases, issues and your own permissions) and <code>storage:app</code> (to keep the go/no-go limits). It never creates, changes or deletes issues.</li>
    <li><b>Your permissions, nothing more.</b> Reports are calculated in your browser from data Jira returns for you, so a user sees only what their Jira permissions allow.</li>
    <li><b>Data stays in Atlassian.</b> No issue data leaves Atlassian’s platform and your browser. The app stores only rule settings, in Forge hosted storage for your site. See the <a href="/jira/privacy/">privacy policy</a>.</li>
    <li><b>Changes are checked on the server.</b> Saving limits requires Administer Projects on that project or Administer Jira, checked by Atlassian’s platform as the user, and the values are validated strictly.</li>
    <li><b>No credentials.</b> The app handles no passwords, API tokens or shared secrets; Forge authenticates every call.</li>
    <li><b>One outside file.</b> The dashboard-gadget icon is an image hosted on vpcapps.net, fetched by the browser like any web image. No Jira data is sent with it.</li>
    <li><b>Safe output.</b> All Jira text is escaped on screen and in downloads; downloaded reports contain no scripts.</li>
  </ul>
  <h2>Reporting a vulnerability</h2>
  <p>Email <a href="mailto:support@vpcapps.net?subject=Security">support@vpcapps.net</a> with “Security” in the subject. Please include the steps to reproduce, the affected version (the build number at the bottom of the app) and the impact you expect. Do not include real customer data.</p>
  <ul>
    <li>We acknowledge reports within {REPLY_TIME}.</li>
    <li>We fix confirmed vulnerabilities within the timeframes Atlassian sets in its <a href="https://developer.atlassian.com/platform/marketplace/security-requirements/">security requirements for Marketplace apps</a>, and tell the reporter when the fix is live.</li>
    <li>Please give us reasonable time to fix an issue before disclosing it, and do not test against Jira sites you do not own.</li>
  </ul>
  <h2>Contact</h2>
  <p>VPC Apps, a brand of {TRADE_NAME}, {ADDRESS}. <a href="mailto:support@vpcapps.net">support@vpcapps.net</a>.</p>
</section>'''


def build(page, E=None):
    """Called from build.py main(): page(path, title, desc, body, extra_head=...)."""
    page('/jira/', 'Go/No-Go Release Scorecard for Jira: documentation',
         'How to set up and use Go/No-Go Release Scorecard for Jira: verdicts, rules, criteria templates, views, '
         'release comparison, printing and your data.', mark(docs_body()), extra_head=STYLE)
    page('/jira/privacy/', 'Go/No-Go Release Scorecard for Jira: privacy policy',
         'What Go/No-Go Release Scorecard for Jira reads, stores and shares: issue data stays in Atlassian and your browser; '
         'only rule settings are stored.', mark(privacy_body()), extra_head=STYLE)
    page('/jira/security/', 'Go/No-Go Release Scorecard for Jira: security',
         'Security of Go/No-Go Release Scorecard for Jira: Forge-hosted, read-only scopes, no outside servers, and how to '
         'report a vulnerability.', mark(security_body()), extra_head=STYLE)
