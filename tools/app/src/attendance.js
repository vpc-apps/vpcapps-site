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
    var C = E8.Charts, esc = Eng.esc, card = C.card;
    var rate = Math.round(m.rate * 100), latePct = m.presentDays ? Math.round(m.late * 1000 / m.presentDays) / 10 : 0;
    var html = '<div class="kpis">' +
      C.tile('Attendance rate', rate + '%', m.presentDays + ' of ' + m.expected + ' working person-days', rate >= 95 ? 'good' : rate >= 90 ? 'warn' : 'bad') +
      C.tile('Late arrivals', String(m.late), latePct + '% of attended days, after ' + hm(m.start) + ' + ' + m.grace + ' min', latePct > 10 ? 'bad' : latePct > 5 ? 'warn' : 'good') +
      C.tile('Absent days', String(m.absent), m.people ? (Math.round(m.absent * 10 / m.people) / 10) + ' per employee' : '', m.absent ? '' : 'good') +
      C.tile('Average hours per day', hm(m.avgHours * 60), 'shift is ' + hm(m.end - m.start) + ' h') +
      C.tile('Overtime', Math.round(m.ot) + ' h', 'days more than 30 min past the shift') +
      C.tile('Missing punches', String(m.missing), m.missing ? 'only an in or only an out' : 'every day has an in and an out', m.missing ? 'warn' : 'good') + '</div>';
    html += card('Key findings', 'The main points in plain words, most important first.', C.findings(template.insights(m)), 'wide');
    html += card('Employees present per working day', 'How many people came in on each working day. Dips show holidays, strikes or device problems.',
      C.lines(m.days.map(function (d) { return d[0]; }), [{ name: 'Present', values: m.days.map(function (d) { return d[1]; }), color: '#2f9e6e' }], { wide: true }), 'wide');
    html += '<div class="grid">';
    var cut = m.start + m.grace;
    html += card('Arrival times', 'First punch per day in 15-minute slots. Orange slots are after the shift start plus grace, amber ones partly so.',
      C.bars(m.arrivals, { max: 16, more: 'later slots', colors: m.arrivals.map(function (a) { var b = minutes(a[0]); return b >= cut ? '#e0742c' : b + 15 > cut ? '#c9a227' : '#3b6fd8'; }) }));
    html += card('Late arrivals by weekday', 'Late arrivals on each working weekday. A tall Monday bar is common; a tall other day may point to a cause.',
      C.bars(m.lateByWd.map(function (n, i) { return [WD[i], n]; }).filter(function (r, i) { return m.off.indexOf(i) < 0; }), { color: '#e0742c', keepZero: true }));
    html += card('Most late arrivals', 'Employees with the most late days. The grey bar adds up everyone else.',
      C.bars(m.list.map(function (s) { return [s.p.name, s.late]; }).sort(function (a, b) { return b[1] - a[1]; }), { color: '#c44a7a', max: 10, more: 'others' }));
    html += card('Most overtime hours', 'Employees with the most hours past the shift end.',
      C.bars(m.list.map(function (s) { return [s.p.name, Math.round(s.ot * 10) / 10]; }).sort(function (a, b) { return b[1] - a[1]; }), { color: '#8a63d2', max: 10, more: 'others', fmt: function (v) { return v + ' h'; } }));
    html += '</div>';
    var depts = deptRows(m);
    if (depts) html += card('By department', 'Exact counts per department to quote in a review. Rates use working days only.', depts, 'wide');
    var rows = m.list.slice().sort(function (a, b) { return (b.late + b.absent) - (a.late + a.absent) || (a.p.name < b.p.name ? -1 : 1); });
    html += card('Employee summary', 'One row per employee, most late plus absent days first.' + (rows.length > 25 ? ' Showing 25 of ' + rows.length + '.' : ''),
      C.table([{ t: 'Employee' }, { t: 'Department' }, { t: 'Present', num: true }, { t: 'Late', num: true }, { t: 'Absent', num: true }, { t: 'Early out', num: true },
        { t: 'Average h/day', num: true }, { t: 'Overtime h', num: true }, { t: 'Missing punch', num: true }],
        rows.slice(0, 25).map(function (s) {
          return ['<b>' + esc(s.p.name) + '</b>', esc(s.p.dept || '–'), s.present, s.late, s.absent, s.early, s.hoursDays ? hm(s.hours * 60 / s.hoursDays) : '–',
            Math.round(s.ot * 10) / 10, s.missing].map(String);
        }), { paper: 12, minW: 760 }), 'wide');
    return html;
  };

  /** Per-department counts with a total row, or '' when the file has no department column. */
  function deptRows(m) {
    var by = {};
    m.list.forEach(function (s) {
      if (!s.p.dept) return;
      var d = by[s.p.dept] || (by[s.p.dept] = { n: 0, present: 0, late: 0, absent: 0, missing: 0, ot: 0 });
      d.n++; d.present += s.present; d.late += s.late; d.absent += s.absent; d.missing += s.missing; d.ot += s.ot;
    });
    var names = Object.keys(by).sort(function (a, b) { return by[b].n - by[a].n || (a < b ? -1 : 1); });
    if (!names.length) return '';
    var row = function (label, d) {
      var exp = d.n * m.workDays;
      return ['<b>' + Eng.esc(label) + '</b>', d.n, d.present, d.late, d.present ? (Math.round(d.late * 1000 / d.present) / 10) + '%' : '–', d.absent,
        exp ? Math.min(100, Math.round((exp - d.absent) * 100 / exp)) + '%' : '–', d.missing, Math.round(d.ot)].map(String);
    };
    var all = { n: 0, present: 0, late: 0, absent: 0, missing: 0, ot: 0 };
    m.list.forEach(function (s) { all.n++; all.present += s.present; all.late += s.late; all.absent += s.absent; all.missing += s.missing; all.ot += s.ot; });
    return E8.Charts.table([{ t: 'Department' }, { t: 'Employees', num: true }, { t: 'Present days', num: true }, { t: 'Late', num: true }, { t: 'Late %', num: true },
      { t: 'Absent', num: true }, { t: 'Attendance', num: true }, { t: 'Missing punch', num: true }, { t: 'Overtime h', num: true }],
      names.map(function (k) { return row(k, by[k]); }), { foot: [row('All employees', all)], minW: 720, paper: 12 });
  }

  return template;
})();
