// E8 template: Jira issues export (CSV, all fields or current fields).
// Reads the standard columns by name, ignores the many "Custom field (…)"
// columns except one the user may pick for a breakdown, merges repeated
// columns (Labels, Sprint, Component/s, Comment) and computes QA/bug KPIs.
'use strict';

var E8 = window.E8 || (window.E8 = {});

E8.Jira = (function () {
  var Eng = E8.Engine;
  var DONE = /^(done|closed|resolved|released|fixed|verified|complete|completed|cancelled|canceled|won't (do|fix)|rejected|duplicate)$/i;
  var HIGH = /^(highest|high|critical|blocker|urgent|p0|p1|p2|showstopper|major)$/i;
  var DAY = 864e5;
  var PRIO = ['blocker', 'highest', 'critical', 'urgent', 'p0', 'p1', 'high', 'major', 'p2', 'medium', 'normal', 'p3', 'minor', 'low', 'p4', 'lowest', 'trivial'];
  function prank(p) { var i = PRIO.indexOf(String(p).toLowerCase()); return p === '(none)' ? 999 : i < 0 ? 500 : i; }
  var AGE_COLORS = ['#2f9e6e', '#c9a227', '#e0742c', '#b3261e'];

  var template = {
    id: 'jira',
    name: 'Jira issues export',
    fingerprint: ['Issue key', 'Summary', 'Status', 'Issue Type', 'Created', 'Priority'],
    help: 'In Jira: Filters → View all issues (or Search) → list view → Export → CSV (current fields or all fields).',
  };

  function list(v) { return Array.isArray(v) ? v : (v ? v.split(/\s*,\s*/) : []); }

  /** Columns worth offering as an extra breakdown: custom fields with 2–25 distinct values. */
  function breakdownCandidates(data) {
    return data.unique.filter(function (h) {
      if (!/^Custom field \(/.test(h) || data.multi[h]) return false;
      var seen = {}, n = 0;
      for (var i = 0; i < data.records.length && n <= 25; i++) {
        var v = data.records[i][h];
        if (v && !seen[v]) { seen[v] = 1; n++; }
      }
      return n >= 2 && n <= 25;
    });
  }

  /** Builds the model: issues with parsed dates and status, plus every KPI the views need. */
  function analyse(data, opt) {
    opt = opt || {};
    var recs = data.records;
    var dateCols = ['Created', 'Resolved', 'Updated'];
    var sample = [];
    recs.slice(0, 300).forEach(function (r) { dateCols.forEach(function (c) { if (r[c]) sample.push(r[c]); }); });
    var dayFirst = Eng.guessDayFirst(sample);
    var issues = recs.map(function (r) {
      var created = Eng.parseDate(r['Created'], dayFirst);
      var resolved = Eng.parseDate(r['Resolved'], dayFirst);
      var updated = Eng.parseDate(r['Updated'], dayFirst);
      var status = r['Status'] || '';
      return {
        key: r['Issue key'], summary: r['Summary'] || '', type: r['Issue Type'] || '(none)',
        status: status, priority: r['Priority'] || '(none)', assignee: r['Assignee'] || 'Unassigned',
        project: r['Project name'] || r['Project key'] || '', resolution: r['Resolution'] || '',
        components: list(r['Component/s']), labels: list(r['Labels']), fixVersions: list(r['Fix Version/s']),
        sprints: list(r['Sprint']), created: created, resolved: resolved, updated: updated,
        done: !!resolved || DONE.test(status), extra: opt.breakdown ? (r[opt.breakdown] || '(none)') : null,
      };
    }).filter(function (i) { return i.key && i.created; });
    if (opt.type && opt.type !== '*') issues = issues.filter(function (i) { return i.type === opt.type; });
    if (opt.project && opt.project !== '*') issues = issues.filter(function (i) { return i.project === opt.project; });

    // "As of" = the newest date in the file, so an old export reads correctly.
    var asOf = new Date(Math.max.apply(null, issues.map(function (i) {
      return Math.max(i.created.getTime(), i.resolved ? i.resolved.getTime() : 0, i.updated ? i.updated.getTime() : 0);
    }).concat([0])));
    var open = issues.filter(function (i) { return !i.done; });
    var closed = issues.filter(function (i) { return i.done && i.resolved; });
    var ageDays = function (i) { return (asOf - i.created) / DAY; };
    var resDays = closed.map(function (i) { return Math.max(0, (i.resolved - i.created) / DAY); });
    var recentRes = closed.filter(function (i) { return asOf - i.resolved <= 30 * DAY; })
      .map(function (i) { return Math.max(0, (i.resolved - i.created) / DAY); });

    // Weekly created vs resolved, last 12 weeks.
    var weeks = [];
    for (var w = 11; w >= 0; w--) weeks.push(Eng.weekKey(new Date(asOf.getTime() - w * 7 * DAY)));
    var cw = {}, rw = {};
    issues.forEach(function (i) {
      var k = Eng.weekKey(i.created); cw[k] = (cw[k] || 0) + 1;
      if (i.resolved) { var k2 = Eng.weekKey(i.resolved); rw[k2] = (rw[k2] || 0) + 1; }
    });
    var createdW = weeks.map(function (k) { return cw[k] || 0; });
    var resolvedW = weeks.map(function (k) { return rw[k] || 0; });

    var buckets = [['< 7 days', 0], ['7–30 days', 0], ['30–90 days', 0], ['> 90 days', 0]];
    open.forEach(function (i) {
      var a = ageDays(i);
      buckets[a < 7 ? 0 : a < 30 ? 1 : a < 90 ? 2 : 3][1]++;
    });
    var stale = open.filter(function (i) { return HIGH.test(i.priority) && ageDays(i) > 30; })
      .sort(function (a, b) { return a.created - b.created; });

    // Priorities in their usual order (unknown names after, "(none)" last).
    var seenP = {};
    issues.forEach(function (i) { seenP[i.priority] = 1; });
    var priorityOrder = Object.keys(seenP).sort(function (a, b) { return prank(a) - prank(b) || (a < b ? -1 : 1); });
    var byStatus = {};
    issues.forEach(function (i) {
      var s = i.status || '(none)', r = byStatus[s] || (byStatus[s] = { status: s, done: true, counts: {}, n: 0 });
      r.counts[i.priority] = (r.counts[i.priority] || 0) + 1; r.n++;
      if (!i.done) r.done = false;
    });
    var statusRows = Object.keys(byStatus).map(function (k) { return byStatus[k]; }).sort(function (a, b) { return b.n - a.n; });
    var ofPrio = function (list, p) { return list.filter(function (i) { return i.priority === p; }); };
    var fixedOpen = priorityOrder.map(function (p) { return [p, [ofPrio(closed, p).length, ofPrio(open, p).length]]; });
    var fixTime = priorityOrder.map(function (p) {
      var d = ofPrio(closed, p).map(function (i) { return Math.max(0, (i.resolved - i.created) / DAY); });
      return [p, d.length ? Math.round(Eng.median(d) * 10) / 10 : 0, d.length];
    }).filter(function (r) { return r[2]; });

    return {
      asOf: asOf, total: issues.length, noun: /bug|defect/i.test(opt.type || '') ? 'defects' : 'issues',
      priorityOrder: priorityOrder, statusRows: statusRows, fixedOpen: fixedOpen, fixTime: fixTime,
      byPriorityOpen: priorityOrder.map(function (p) { return [p, ofPrio(open, p).length]; }),
      reopened: open.filter(function (i) { return /reopen/i.test(i.status); }).sort(function (a, b) { return a.created - b.created; }),
      issues: issues, open: open, closed: closed,
      unassignedOpen: open.filter(function (i) { return i.assignee === 'Unassigned'; }).length,
      medianRes: Eng.median(resDays), medianRecent: Eng.median(recentRes), meanRes: Eng.mean(resDays),
      weeks: weeks, createdW: createdW, resolvedW: resolvedW, ageBuckets: buckets, staleHigh: stale,
      byStatus: Eng.countBy(issues, function (i) { return i.status; }),
      byAssigneeOpen: Eng.countBy(open, function (i) { return i.assignee; }),
      byComponentOpen: Eng.countBy(open, function (i) { return i.components.length ? i.components : '(none)'; }),
      byType: Eng.countBy(issues, function (i) { return i.type; }),
      byFixVersion: Eng.countBy(issues, function (i) { return i.fixVersions.length ? i.fixVersions : '(none)'; }),
      byExtraOpen: opt.breakdown ? Eng.countBy(open, function (i) { return i.extra; }) : null,
      breakdownName: opt.breakdown ? opt.breakdown.replace(/^Custom field \((.*)\)$/, '$1') : null,
    };
  }

  /** Plain-English findings, most important first. */
  function insights(m) {
    var out = [], pct = Eng.pct, N = m.noun, n1 = N.slice(0, -1);
    var old = m.ageBuckets[2][1] + m.ageBuckets[3][1];
    out.push(m.open.length + ' of ' + m.total + ' ' + N + ' are open' +
      (m.open.length ? '; ' + pct(old, m.open.length) + '% of them are older than 30 days.' : '.'));
    var c4 = m.createdW.slice(-4).reduce(sum, 0), r4 = m.resolvedW.slice(-4).reduce(sum, 0);
    if (c4 || r4) {
      out.push('Last 4 weeks: ' + c4 + ' created vs ' + r4 + ' resolved. The backlog is ' +
        (c4 > r4 ? 'growing by ' + (c4 - r4) : c4 < r4 ? 'shrinking by ' + (r4 - c4) : 'flat') + '.');
    }
    if (m.medianRes !== null) {
      var s = 'Median time to resolve: ' + days(m.medianRes) + '.';
      if (m.medianRecent !== null) s += ' ' + N.charAt(0).toUpperCase() + N.slice(1) + ' resolved in the last 30 days took ' + days(m.medianRecent) +
        (m.medianRecent < m.medianRes * 0.85 ? ' (faster than usual).' : m.medianRecent > m.medianRes * 1.15 ? ' (slower than usual).' : '.');
      out.push(s);
    }
    if (m.staleHigh.length) out.push(m.staleHigh.length + ' high-priority ' + (m.staleHigh.length > 1 ? N + ' have' : n1 + ' has') +
      ' been open for more than 30 days (oldest: ' + m.staleHigh[0].key + ').');
    var comp = m.byComponentOpen.filter(function (r) { return r[0] !== '(none)'; })[0];
    if (comp && m.open.length) out.push('Most open ' + N + ' sit in ' + comp[0] + ': ' + comp[1] + ' (' + pct(comp[1], m.open.length) + '% of open).');
    if (m.unassignedOpen) out.push(m.unassignedOpen + ' open ' + (m.unassignedOpen > 1 ? N + ' are' : n1 + ' is') + ' unassigned.');
    var top = m.byAssigneeOpen.filter(function (r) { return r[0] !== 'Unassigned'; })[0];
    if (top && m.open.length >= 10 && top[1] / m.open.length > 0.3) out.push(top[0] + ' holds ' + pct(top[1], m.open.length) + '% of open ' + N + ': a possible bottleneck.');
    return out;
  }
  function sum(a, b) { return a + b; }
  function days(d) { return d < 1 ? Math.round(d * 24) + ' hours' : (Math.round(d * 10) / 10) + ' days'; }

  /** The dashboard body (same HTML on screen, in the export and in print). */
  function render(m) {
    var C = E8.Charts, esc = Eng.esc, card = C.card, N = m.noun, n1 = N.slice(0, -1);
    var Nc = N.charAt(0).toUpperCase() + N.slice(1);
    var c4 = m.createdW.slice(-4).reduce(sum, 0), r4 = m.resolvedW.slice(-4).reduce(sum, 0), net = c4 - r4;
    var slower = m.medianRecent !== null && m.medianRes !== null && m.medianRecent > m.medianRes * 1.15;
    var html = '<div class="kpis">' +
      C.tile(Nc + ' in file', String(m.total), m.closed.length + ' resolved · ' + m.open.length + ' open') +
      C.tile('Open ' + N, String(m.open.length), Eng.pct(m.open.length, m.total) + '% of all ' + N, m.open.length ? '' : 'good') +
      C.tile('Median time to resolve', m.medianRes === null ? '–' : days(m.medianRes),
        m.medianRecent === null ? 'none resolved in the last 30 days' : 'last 30 days: ' + days(m.medianRecent), slower ? 'warn' : '') +
      C.tile('Backlog change, last 4 weeks', (net > 0 ? '+' : '') + net, c4 + ' created · ' + r4 + ' resolved', net > 0 ? 'bad' : 'good') +
      C.tile('High priority open > 30 days', String(m.staleHigh.length), m.staleHigh.length ? 'oldest: ' + esc(m.staleHigh[0].key) : 'none waiting that long', m.staleHigh.length ? 'bad' : 'good') +
      C.tile('Unassigned open ' + N, String(m.unassignedOpen), m.unassignedOpen ? 'nobody is working on them' : 'every open ' + n1 + ' has an owner', m.unassignedOpen ? 'warn' : 'good') + '</div>';
    html += card('Key findings', 'The main points in plain words, most important first.', C.findings(insights(m)), 'wide');
    html += card('Created vs resolved per week', 'New ' + N + ' (orange) against resolved ' + N + ' (green) for the last 12 weeks. Green above orange means the backlog is shrinking.',
      C.lines(m.weeks, [{ name: 'Created', values: m.createdW, color: '#e0742c' }, { name: 'Resolved', values: m.resolvedW, color: '#2f9e6e' }], { wide: true }), 'wide');
    html += '<div class="grid">';
    html += card('Age of open ' + N, 'How long unfinished ' + N + ' have been open. Long red bars mean stuck or forgotten work.', C.bars(m.ageBuckets, { colors: AGE_COLORS, keepZero: true }));
    html += card('Open ' + N + ' by priority', 'Unfinished ' + N + ' at each priority, highest first.', C.bars(m.byPriorityOpen, { color: '#c44a7a', max: 12 }));
    html += card('Fixed vs open by priority', 'For each priority, ' + N + ' resolved (green) and still open (red). The numbers are fixed / open.',
      C.stack(m.fixedOpen, [{ name: 'Fixed', color: '#2f9e6e' }, { name: 'Open', color: '#b3261e' }]));
    html += card('Median days to fix, by priority', 'Typical days from created to resolved. The number of resolved ' + N + ' is in brackets.',
      C.bars(m.fixTime.map(function (r) { return [r[0] + ' (' + r[2] + ')', r[1]]; }), { color: '#8a63d2', fmt: function (x) { return x + ' d'; } }));
    html += card('Open ' + N + ' by assignee', 'Who holds the unfinished ' + N + '. A long Unassigned bar means work nobody has picked up.', C.bars(m.byAssigneeOpen, { max: 8, more: 'others' }));
    html += card('Open ' + N + ' by component', 'Which parts of the product the unfinished ' + N + ' sit in.', C.bars(m.byComponentOpen, { color: '#3aa3b8', max: 8, more: 'other components' }));
    html += card('All ' + N + ' by status', 'Where every ' + n1 + ' in the file sits in your workflow right now.', C.bars(m.byStatus, { color: '#3b6fd8', max: 8, more: 'other statuses' }));
    if (m.byType.length > 1) html += card('All ' + N + ' by type', 'The mix of issue types in this file.', C.bars(m.byType, { color: '#c9a227', max: 8, more: 'other types' }));
    html += card(Nc + ' by fix version', 'How many ' + N + ' are planned for, or fixed in, each release. (none) means no fix version is set.', C.bars(m.byFixVersion, { color: '#7d7d7d', max: 8, more: 'other versions' }));
    if (m.byExtraOpen) html += card('Open ' + N + ' by ' + m.breakdownName, 'Unfinished ' + N + ' split by the field you picked.', C.bars(m.byExtraOpen, { color: '#3b6fd8', max: 10, more: 'other values' }));
    html += '</div>';
    html += card(Nc + ' by status and priority', 'Exact counts to quote in a meeting. "Not resolved" adds up every status that is not done.', statusPriority(m), 'wide');
    var issueTable = function (list) {
      return C.table([{ t: 'Key' }, { t: 'Summary' }, { t: 'Priority' }, { t: 'Status' }, { t: 'Assignee' }, { t: 'Age', num: true }],
        list.slice(0, 15).map(function (i) {
          return ['<span class="key">' + esc(i.key) + '</span>', esc(i.summary.slice(0, 90)), esc(i.priority), esc(i.status), esc(i.assignee), Math.round((m.asOf - i.created) / DAY) + ' d'];
        }), { paper: 6, minW: 640 }) + (list.length > 15 ? '<p class="more">Showing 15 of ' + list.length + '. The rest are in Jira.</p>' : '');
    };
    if (m.staleHigh.length) html += card('High-priority ' + N + ' open more than 30 days', 'Unfinished high-priority ' + N + ', oldest first. These usually need a decision, not more waiting.', issueTable(m.staleHigh), 'wide');
    if (m.reopened.length) html += card('Reopened ' + N, 'Open ' + N + ' whose status is Reopened right now, oldest first. A Jira CSV has no change history, so earlier reopens cannot be counted.', issueTable(m.reopened), 'wide');
    return html;
  }

  /** Status by priority: counts, with a "Not resolved" subtotal and a total row. */
  function statusPriority(m) {
    var pri = m.priorityOrder, rows = m.statusRows;
    var cells = function (label, counts) {
      var tot = 0;
      return ['<b>' + Eng.esc(label) + '</b>'].concat(pri.map(function (p) { var n = counts[p] || 0; tot += n; return n ? String(n) : '<span class="zero">0</span>'; })).concat([String(tot)]);
    };
    var sumOf = function (list) { var o = {}; list.forEach(function (r) { pri.forEach(function (p) { o[p] = (o[p] || 0) + (r.counts[p] || 0); }); }); return o; };
    var open = rows.filter(function (r) { return !r.done; }), done = rows.filter(function (r) { return r.done; });
    var cols = [{ t: 'Status' }].concat(pri.map(function (p) { return { t: p, num: true }; })).concat([{ t: 'Total', num: true }]);
    return E8.Charts.table(cols, open.concat(done).map(function (r) { return cells(r.status, r.counts); }), {
      sub: open.length ? { at: open.length, row: cells('Not resolved', sumOf(open)) } : null,
      foot: [cells('All ' + m.noun, sumOf(rows))], minW: 140 + 80 * pri.length,
    });
  }

  template.analyse = analyse;
  template.insights = insights;
  template.render = render;
  template.breakdownCandidates = breakdownCandidates;
  template.filters = function (data) {
    var types = {}, projects = {};
    data.records.forEach(function (r) {
      if (r['Issue Type']) types[r['Issue Type']] = 1;
      var p = r['Project name'] || r['Project key'];
      if (p) projects[p] = 1;
    });
    return { types: Object.keys(types).sort(), projects: Object.keys(projects).sort() };
  };
  return template;
})();
