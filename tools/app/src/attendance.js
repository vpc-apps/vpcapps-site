// E8 template: biometric attendance (eSSL, ZKTeco and similar exports).
// Two shapes, recognised by column names (vendors and versions name them differently):
//  - punch log: one row per punch (employee + date/time, optional in/out flag) → first in / last out per day
//  - daily report: one row per employee per day with In Time / Out Time (and maybe a status)
// Settings: shift start/end, grace minutes, weekly off days. Results: late arrivals, early exits,
// overtime, absences, missing punches, average hours, per-employee summary.
'use strict';

var E8 = window.E8 || (window.E8 = {});

E8.Attendance = (function () {
  var Eng = E8.Engine;
  var COLS = {
    id: /^(emp(loyee)?[\s._-]*(code|id|no\.?|number)|ac[\s.-]*no\.?|user[\s_]*id|badge|card[\s_]*no\.?|staff[\s_]*(id|code)|e\.?\s*code|enroll(ment)?[\s_]*(id|no))$/i,
    name: /^(emp(loyee)?[\s_]*name|name|staff[\s_]*name|full[\s_]*name)$/i,
    dept: /^(dept\.?|department|division|team)$/i,
    datetime: /^(date[\s_]*time|time[\s_]*stamp|punch[\s_]*(time|date[\s_]*time)|log[\s_]*(time|date[\s_]*time)|check[\s_]*time|att[\s_]*time|time)$/i,
    date: /^(date|attendance[\s_]*date|att[\s_]*date|log[\s_]*date|punch[\s_]*date|work[\s_]*date|day)$/i,
    time: /^(punch[\s_]*time|log[\s_]*time|time)$/i,
    inT: /^(in[\s_]*time|intime|first[\s_]*in|check[\s_]*in|in[\s_]*punch|in|time[\s_]*in|clock[\s_]*in)$/i,
    outT: /^(out[\s_]*time|outtime|last[\s_]*out|check[\s_]*out|out[\s_]*punch|out|time[\s_]*out|clock[\s_]*out)$/i,
    status: /^(status|attendance|att[\s_]*status|remarks?)$/i,
    dir: /^(in\/out|direction|state|check[\s_]*type|punch[\s_]*type|io[\s_]*(mode|type)|verify[\s_]*state)$/i,
  };

  function find(header, re) { for (var i = 0; i < header.length; i++) if (re.test(header[i].trim())) return header[i]; return null; }

  function mapCols(header) {
    var m = {};
    Object.keys(COLS).forEach(function (k) { m[k] = find(header, COLS[k]); });
    if (m.date && m.datetime === m.date) m.datetime = null;
    if (m.time && m.datetime === m.time && m.date) m.datetime = null;   // separate Date + Time columns
    return m;
  }

  var template = {
    id: 'attendance',
    name: 'Biometric attendance',
    help: 'eSSL eTimeTrackLite: Reports → Daily / Monthly attendance → export to Excel → save as CSV. ZKTeco / BioTime: Attendance → Transactions (or Report) → Export CSV.',
  };

  /** 'daily' (In/Out per day), 'punches' (one row per punch) or null. */
  template.part = function (header) {
    var m = mapCols(header);
    if (!(m.id || m.name)) return null;
    if (m.date && m.inT) return 'daily';
    if (m.datetime || (m.date && m.time)) return 'punches';
    return null;
  };

  /** "09:41", "9:41:05", "9:41 AM", "17.30" → minutes after midnight, or null. */
  function minutes(s) {
    if (!s) return null;
    var t = /(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(String(s));
    if (!t) return null;
    var h = +t[1], mi = +t[2];
    if (t[3]) { var pm = t[3].toUpperCase() === 'PM'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return h * 60 + mi;
  }
  template.minutes = minutes;
  function hm(min) { min = Math.round(min); return Math.floor(min / 60) + ':' + ('0' + (min % 60)).slice(-2); }
  function dayKey(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Builds employee-days {id, name, dept, day, inMin, outMin, punches, status}. */
  function employeeDays(data, part) {
    var m = mapCols(data.header), recs = data.records, days = {};
    var who = function (r) { return (m.id && r[m.id]) || (m.name && r[m.name]) || ''; };
    if (part === 'daily') {
      var dayFirst = Eng.guessDayFirst(recs.map(function (r) { return r[m.date]; }));
      recs.forEach(function (r) {
        var id = who(r), d = Eng.parseDate(r[m.date], dayFirst);
        if (!id || !d) return;
        var inM = minutes(r[m.inT]), outM = m.outT ? minutes(r[m.outT]) : null;
        days[id + '|' + dayKey(d)] = { id: id, name: (m.name && r[m.name]) || id, dept: (m.dept && r[m.dept]) || '', day: d,
          inMin: inM, outMin: outM, punches: (inM !== null) + (outM !== null), status: (m.status && r[m.status]) || '' };
      });
    } else {
      var dcol = m.datetime || m.date;
      var df = Eng.guessDayFirst(recs.map(function (r) { return r[dcol]; }));
      recs.forEach(function (r) {
        var id = who(r);
        var d = Eng.parseDate(m.datetime ? r[m.datetime] : r[m.date], df);
        if (!id || !d) return;
        var t = m.datetime ? minutes(r[m.datetime]) : minutes(r[m.time]);
        if (t === null) return;
        var k = id + '|' + dayKey(d);
        var e = days[k] || (days[k] = { id: id, name: (m.name && r[m.name]) || id, dept: (m.dept && r[m.dept]) || '', day: new Date(d.getFullYear(), d.getMonth(), d.getDate()), times: [], status: '' });
        e.times.push(t);
      });
      Object.keys(days).forEach(function (k) {
        var e = days[k], ts = e.times.sort(function (a, b) { return a - b; });
        // Repeated punches within 2 minutes count once (double scans).
        var uniq = ts.filter(function (t, i) { return i === 0 || t - ts[i - 1] > 2; });
        e.inMin = uniq[0]; e.outMin = uniq.length > 1 ? uniq[uniq.length - 1] : null; e.punches = uniq.length;
        delete e.times;
      });
    }
    return Object.keys(days).map(function (k) { return days[k]; });
  }

  /** parts: { punches | daily: data }, opt: { start: 'HH:MM', end, grace (min), off: [0,6] weekday numbers }. */
  template.analyse = function (parts, opt) {
    opt = opt || {};
    var start = minutes(opt.start || '09:30'), end = minutes(opt.end || '18:30'), grace = +opt.grace || 10;
    var off = opt.off || [0];
    var part = parts.daily ? 'daily' : 'punches', data = parts[part];
    var ed = employeeDays(data, part);
    var people = {}, dates = {};
    ed.forEach(function (e) { people[e.id] = people[e.id] || { id: e.id, name: e.name, dept: e.dept }; dates[dayKey(e.day)] = e.day; });
    var allDays = Object.keys(dates).sort();
    var from = dates[allDays[0]], to = dates[allDays[allDays.length - 1]];
    // Working days in range (calendar, minus weekly off days).
    var work = [];
    if (from && to) for (var d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) if (off.indexOf(d.getDay()) < 0) work.push(dayKey(d));
    var present = {}, rows = ed.filter(function (e) {
      var absentStatus = /^(a|ab|absent|lop|lwp)$/i.test(e.status.trim());
      return e.inMin !== null && e.inMin !== undefined && !absentStatus;
    });
    rows.forEach(function (e) { present[e.id + '|' + dayKey(e.day)] = e; });
    var shiftLen = end - start;
    var stats = {}, lateByWd = [0, 0, 0, 0, 0, 0, 0], arrivals = {}, attendByDay = {};
    Object.keys(people).forEach(function (id) { stats[id] = { p: people[id], present: 0, late: 0, lateMin: 0, early: 0, ot: 0, hours: 0, hoursDays: 0, missing: 0, absent: 0 }; });
    rows.forEach(function (e) {
      var s = stats[e.id], k = dayKey(e.day);
      s.present++;
      attendByDay[k] = (attendByDay[k] || 0) + 1;
      if (e.inMin > start + grace) { s.late++; s.lateMin += e.inMin - start; lateByWd[e.day.getDay()]++; }
      var b = Math.floor(e.inMin / 15) * 15; arrivals[b] = (arrivals[b] || 0) + 1;
      if (e.outMin === null || e.outMin === undefined || e.outMin <= e.inMin) { s.missing++; return; }
      var worked = e.outMin - e.inMin;
      s.hours += worked / 60; s.hoursDays++;
      if (e.outMin < end - grace) s.early++;
      if (worked > shiftLen + 30) s.ot += (worked - shiftLen) / 60;
    });
    Object.keys(stats).forEach(function (id) {
      var s = stats[id];
      s.absent = work.filter(function (k) { return !present[id + '|' + k]; }).length;
    });
    var list = Object.keys(stats).map(function (id) { return stats[id]; });
    var sum = function (f) { return list.reduce(function (a, s) { return a + f(s); }, 0); };
    var expected = list.length * work.length;
    // Rate counts only working days (people who come in on a weekly off day do not push it over 100%).
    var workSet = {}; work.forEach(function (k) { workSet[k] = 1; });
    var presentDays = Object.keys(present).filter(function (k) { return workSet[k.split('|')[1]]; }).length;
    var arrivalKeys = Object.keys(arrivals).map(Number).sort(function (a, b) { return a - b; });
    return {
      total: rows.length, people: list.length, from: from, to: to, workDays: work.length, part: part,
      start: start, end: end, grace: grace, off: off,
      presentDays: presentDays, expected: expected, rate: expected ? presentDays / expected : 0,
      late: sum(function (s) { return s.late; }), early: sum(function (s) { return s.early; }),
      ot: sum(function (s) { return s.ot; }), missing: sum(function (s) { return s.missing; }),
      absent: sum(function (s) { return s.absent; }),
      avgHours: sum(function (s) { return s.hours; }) / Math.max(1, sum(function (s) { return s.hoursDays; })),
      list: list, lateByWd: lateByWd,
      arrivals: arrivalKeys.map(function (k) { return [hm(k), arrivals[k]]; }),
      days: work.map(function (k) { return [k, attendByDay[k] || 0]; }),
    };
  };

  template.insights = function (m) {
    var out = [], pct = function (a, b) { return b ? Math.round(a * 100 / b) : 0; };
    out.push(m.people + ' employees, ' + m.workDays + ' working days (' + m.from.toDateString() + ' – ' + m.to.toDateString() + '). Attendance rate: ' + Math.round(m.rate * 100) + '%.');
    out.push(m.late + ' late arrivals after ' + hm(m.start) + ' + ' + m.grace + ' min grace (' + pct(m.late, m.presentDays) + '% of attended days).');
    var wd = m.lateByWd.map(function (n, i) { return [WD[i], n]; }).sort(function (a, b) { return b[1] - a[1]; })[0];
    if (wd && wd[1] && m.late >= 10) out.push('Most late arrivals happen on ' + wd[0] + ' (' + wd[1] + ').');
    var lateTop = m.list.slice().sort(function (a, b) { return b.late - a.late; })[0];
    if (lateTop && lateTop.late >= 3) out.push(lateTop.p.name + ' was late ' + lateTop.late + ' times (average ' + Math.round(lateTop.lateMin / lateTop.late) + ' min after shift start).');
    out.push('Average time at work: ' + hm(m.avgHours * 60) + ' h per day. Overtime: ' + Math.round(m.ot) + ' h in total' +
      (m.ot ? ', most by ' + m.list.slice().sort(function (a, b) { return b.ot - a.ot; })[0].p.name + '.' : '.'));
    if (m.absent) {
      var ab = m.list.slice().sort(function (a, b) { return b.absent - a.absent; })[0];
      out.push(m.absent + ' absent days in total; highest: ' + ab.p.name + ' (' + ab.absent + ').');
    }
    if (m.missing) out.push(m.missing + ' days with a missing punch (only an in or only an out): check the device or remind staff to punch out.');
    if (m.early) out.push(m.early + ' early exits before ' + hm(m.end) + '.');
    return out;
  };

  template.render = function (m) {
    var C = E8.Charts, esc = Eng.esc;
    var kpi = function (label, value, note) {
      return '<div class="kpi"><div class="kv">' + value + '</div><div class="kl">' + esc(label) + '</div>' + (note ? '<div class="kn">' + esc(note) + '</div>' : '') + '</div>';
    };
    var card = function (title, body, wide) { return '<section class="card' + (wide ? ' wide' : '') + '"><h3>' + esc(title) + '</h3>' + body + '</section>'; };
    var html = '<div class="kpis">' +
      kpi('Attendance rate', Math.round(m.rate * 100) + '%', m.presentDays + ' of ' + m.expected + ' person-days') +
      kpi('Late arrivals', m.late, 'after ' + hm(m.start) + ' + ' + m.grace + ' min') +
      kpi('Absent days', m.absent) +
      kpi('Avg hours / day', hm(m.avgHours * 60)) +
      kpi('Overtime', Math.round(m.ot) + ' h') +
      kpi('Missing punches', m.missing) + '</div>';
    html += card('Key findings', '<ul class="ins">' + template.insights(m).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>', true);
    html += card('People present per working day', C.lines(m.days.map(function (d) { return d[0]; }), [{ name: 'Present', values: m.days.map(function (d) { return d[1]; }), color: '#2f9e6e' }], { w: 1060 }), true);
    html += '<div class="grid">';
    html += card('Arrival times (15-minute slots)', C.bars(m.arrivals, { color: '#3b6fd8', max: 16 }));
    html += card('Late arrivals by weekday', C.bars(m.lateByWd.map(function (n, i) { return [WD[i], n]; }).filter(function (r, i) { return m.off.indexOf(i) < 0; }), { color: '#e0742c' }));
    html += card('Most late arrivals (top 10)', C.bars(m.list.map(function (s) { return [s.p.name, s.late]; }).filter(function (r) { return r[1]; }).sort(function (a, b) { return b[1] - a[1]; }), { color: '#c44a7a' }));
    html += card('Most overtime hours (top 10)', C.bars(m.list.map(function (s) { return [s.p.name, Math.round(s.ot * 10) / 10]; }).filter(function (r) { return r[1]; }).sort(function (a, b) { return b[1] - a[1]; }), { color: '#8a63d2' }));
    html += '</div>';
    var rows = m.list.slice().sort(function (a, b) { return (b.late + b.absent) - (a.late + a.absent); }).slice(0, 25);
    html += card('Employee summary (most late + absent first)', '<table><thead><tr><th>Employee</th><th>Present</th><th>Late</th><th>Absent</th><th>Early out</th><th>Avg h/day</th><th>OT h</th><th>Missing punch</th></tr></thead><tbody>' +
      rows.map(function (s) {
        return '<tr><td>' + esc(s.p.name) + (s.p.dept ? ' <span class="muted">· ' + esc(s.p.dept) + '</span>' : '') + '</td><td>' + s.present + '</td><td>' + s.late + '</td><td>' + s.absent +
          '</td><td>' + s.early + '</td><td>' + (s.hoursDays ? hm(s.hours * 60 / s.hoursDays) : '–') + '</td><td>' + Math.round(s.ot * 10) / 10 + '</td><td>' + s.missing + '</td></tr>';
      }).join('') + '</tbody></table>', true);
    return html;
  };

  return template;
})();
