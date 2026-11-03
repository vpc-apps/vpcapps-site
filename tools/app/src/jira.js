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

    return {
      asOf: asOf, total: issues.length, issues: issues, open: open, closed: closed,
      unassignedOpen: open.filter(function (i) { return i.assignee === 'Unassigned'; }).length,
      medianRes: Eng.median(resDays), medianRecent: Eng.median(recentRes), meanRes: Eng.mean(resDays),
      weeks: weeks, createdW: createdW, resolvedW: resolvedW, ageBuckets: buckets, staleHigh: stale,
      byStatus: Eng.countBy(issues, function (i) { return i.status; }),
      byPriorityOpen: Eng.countBy(open, function (i) { return i.priority; }),
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
    var out = [], pct = Eng.pct;
    var old = m.ageBuckets[2][1] + m.ageBuckets[3][1];
    out.push(m.open.length + ' of ' + m.total + ' issues are open' +
      (m.open.length ? '; ' + pct(old, m.open.length) + '% of them are older than 30 days.' : '.'));
    var c4 = m.createdW.slice(-4).reduce(sum, 0), r4 = m.resolvedW.slice(-4).reduce(sum, 0);
    if (c4 || r4) {
      out.push('Last 4 weeks: ' + c4 + ' created vs ' + r4 + ' resolved. The backlog is ' +
        (c4 > r4 ? 'growing by ' + (c4 - r4) : c4 < r4 ? 'shrinking by ' + (r4 - c4) : 'flat') + '.');
    }
    if (m.medianRes !== null) {
      var s = 'Median time to resolve: ' + days(m.medianRes) + '.';
      if (m.medianRecent !== null) s += ' Issues resolved in the last 30 days took ' + days(m.medianRecent) +
        (m.medianRecent < m.medianRes * 0.85 ? ' (faster than usual).' : m.medianRecent > m.medianRes * 1.15 ? ' (slower than usual).' : '.');
      out.push(s);
    }
    if (m.staleHigh.length) out.push(m.staleHigh.length + ' high-priority issue' + (m.staleHigh.length > 1 ? 's have' : ' has') +
      ' been open for more than 30 days (oldest: ' + m.staleHigh[0].key + ').');
    var comp = m.byComponentOpen.filter(function (r) { return r[0] !== '(none)'; })[0];
    if (comp && m.open.length) out.push('Most open issues sit in ' + comp[0] + ': ' + comp[1] + ' (' + pct(comp[1], m.open.length) + '% of open).');
    if (m.unassignedOpen) out.push(m.unassignedOpen + ' open issue' + (m.unassignedOpen > 1 ? 's are' : ' is') + ' unassigned.');
    var top = m.byAssigneeOpen.filter(function (r) { return r[0] !== 'Unassigned'; })[0];
    if (top && m.open.length >= 10 && top[1] / m.open.length > 0.3) out.push(top[0] + ' holds ' + pct(top[1], m.open.length) + '% of open issues: a possible bottleneck.');
    return out;
  }
  function sum(a, b) { return a + b; }
  function days(d) { return d < 1 ? Math.round(d * 24) + ' hours' : (Math.round(d * 10) / 10) + ' days'; }

  /** The dashboard body (same HTML on screen and in the export). */
  function render(m) {
    var C = E8.Charts, esc = Eng.esc;
    var kpi = function (label, value, note) {
      return '<div class="kpi"><div class="kv">' + value + '</div><div class="kl">' + esc(label) + '</div>' +
        (note ? '<div class="kn">' + esc(note) + '</div>' : '') + '</div>';
    };
    var card = function (title, body, wide) { return '<section class="card' + (wide ? ' wide' : '') + '"><h3>' + esc(title) + '</h3>' + body + '</section>'; };
    var html = '<div class="kpis">' +
      kpi('Issues in file', m.total) +
      kpi('Open', m.open.length, Eng.pct(m.open.length, m.total) + '% of all') +
      kpi('Resolved', m.closed.length) +
      kpi('Median time to resolve', m.medianRes === null ? '–' : days(m.medianRes)) +
      kpi('High priority open > 30 d', m.staleHigh.length) +
      kpi('Unassigned open', m.unassignedOpen) + '</div>';
    html += card('Key findings', '<ul class="ins">' + insights(m).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>', true);
    html += '<div class="grid">';
    html += card('Created vs resolved per week (last 12 weeks)', C.lines(m.weeks, [
      { name: 'Created', values: m.createdW, color: '#e0742c' }, { name: 'Resolved', values: m.resolvedW, color: '#2f9e6e' }], { w: 1060 }), true);
    html += card('Age of open issues', C.shares(m.ageBuckets.filter(function (b) { return b[1]; }), { w: 1060 }), true);
    html += card('Open issues by priority', C.bars(m.byPriorityOpen, { color: '#c44a7a' }));
    html += card('Open issues by assignee (top 10)', C.bars(m.byAssigneeOpen));
    html += card('Open issues by component (top 10)', C.bars(m.byComponentOpen, { color: '#8a63d2' }));
    html += card('All issues by status', C.bars(m.byStatus, { color: '#3aa3b8' }));
    html += card('All issues by type', C.bars(m.byType, { color: '#c9a227' }));
    html += card('Issues by fix version (top 10)', C.bars(m.byFixVersion, { color: '#7d7d7d' }));
    if (m.byExtraOpen) html += card('Open issues by ' + m.breakdownName, C.bars(m.byExtraOpen, { color: '#3b6fd8' }));
    html += '</div>';
    if (m.staleHigh.length) {
      html += card('High-priority issues open more than 30 days', '<table><thead><tr><th>Key</th><th>Summary</th><th>Priority</th><th>Assignee</th><th>Age</th></tr></thead><tbody>' +
        m.staleHigh.slice(0, 15).map(function (i) {
          return '<tr><td>' + esc(i.key) + '</td><td>' + esc(i.summary.slice(0, 80)) + '</td><td>' + esc(i.priority) +
            '</td><td>' + esc(i.assignee) + '</td><td>' + Math.round((m.asOf - i.created) / DAY) + ' d</td></tr>';
        }).join('') + '</tbody></table>', true);
    }
    return html;
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
