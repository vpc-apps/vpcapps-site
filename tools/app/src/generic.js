// E8 template: Generic, for any table that matches no known export.
// Profiles every column (number, money, percent, date, yes/no, category, ID, contact, text), then builds the
// dashboard from a few plain rules: KPI cards, top values per category, rows over time, number stats, one
// category x category table, data quality, findings. The rules are the product: keep them simple to explain.
'use strict';

var E8 = window.E8 || (window.E8 = {});

E8.Generic = (function () {
  var Eng = E8.Engine;
  var MONEY_HINT = /amount|price|total|revenue|sales|cost|value|fee|paid|balance|salary|spend|budget|income|profit|net|gross/i;
  var ID_HINT = /(^|\W|_)(id|key|code|sku|no|number|#|ref|reference)(\W|_|$)|id$/i;
  var TOTAL_HINT = /amount|total|revenue|sales|value|net|gross|paid|income|profit|spend|balance/i;
  var PER_UNIT = /price|rate|per|unit|avg|average|mean|%/i;
  var DATE_HINT = /date|created|updated|time|day|submitted|ordered|opened|closed|when/i;
  var SYMBOLS = /[$€£₹¥]|\b(USD|EUR|GBP|INR|AUD|CAD|Rs\.?)\b/;
  var BOOL = /^(yes|no|y|n|true|false|t|f|0|1)$/i;
  var DATELIKE = /\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|^\d{1,2}[\/\- ][A-Za-z]{3}|^[A-Za-z]{3,9} \d{1,2},? \d{4}/;
  var EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i, URL = /^https?:\/\/\S+$/i;
  var MISSING = /^(n\/?a|#n\/a|null|none|nil|unknown|-+|—|\?)$/i;
  var KIND_LABEL = { number: 'Number', money: 'Money', percent: 'Percent', date: 'Date / time', bool: 'Yes / no', category: 'Category',
    id: 'ID', contact: 'Email / link', name: 'Name / label', text: 'Text', empty: 'Empty' };

  var template = { id: 'generic', name: 'Any table (general dashboard)', fingerprint: [] };

  /** A number from text as exports write it: 1,234.56 · 1.234,56 · 12,5 · $1,200 · (45) · 12%. Null if not a number. */
  function num(s) {
    var t = String(s).trim();
    if (!t) return null;
    var neg = /^\(.*\)$/.test(t) || /^-/.test(t);
    t = t.replace(/^[(\-+]\s*|\s*\)$/g, '').replace(SYMBOLS, '').replace(/[\s% ']/g, '');
    if (!/^\d[\d.,]*$/.test(t)) return null;
    var c = t.lastIndexOf(','), d = t.lastIndexOf('.');
    if (c >= 0 && d >= 0) t = c > d ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (c >= 0) t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.split(',').length === 2 ? t.replace(',', '.') : '';
    else if (d >= 0 && /^\d{1,3}(\.\d{3}){2,}$/.test(t)) t = t.replace(/\./g, '');
    if (!t || t.split('.').length > 2) return null;
    var v = parseFloat(t);
    return isNaN(v) ? null : neg ? -v : v;
  }

  /** What one column holds. */
  function profile(name, raw, rows) {
    // "n/a", "null", "-", "unknown" are blanks too: they say "no value", and would otherwise make a number column look like text.
    var vals = raw.filter(function (v) { return v !== '' && !MISSING.test(v); }), n = vals.length;
    var p = { name: name, n: n, blank: rows - n, distinct: 0, kind: 'empty', bad: [] };
    if (!n) return p;
    var counts = {};
    vals.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    p.distinct = Object.keys(counts).length;
    p.avgLen = vals.reduce(function (a, v) { return a + v.length; }, 0) / n;
    var share = function (f) { return vals.filter(f).length / n; };
    var low = Object.keys(counts).map(function (v) { return v.toLowerCase(); });
    if (p.distinct <= 2 && low.every(function (v) { return BOOL.test(v); }) && (p.distinct === 2 || !/^[01]$/.test(low[0]))) {
      p.kind = 'bool';
    } else if (share(function (v) { return DATELIKE.test(v); }) >= 0.8) {
      var df = Eng.guessDayFirst(vals);
      p.dates = vals.map(function (v) { return Eng.parseDate(v, df); }).filter(function (x) { return x && !isNaN(x); });
      p.kind = p.dates.length / n >= 0.8 ? 'date' : 'text';
      p.bad = vals.filter(function (v) { return !Eng.parseDate(v, df); }).slice(0, 3);
    } else if (share(function (v) { return EMAIL.test(v) || URL.test(v); }) >= 0.8) {
      p.kind = 'contact';
    } else if (share(function (v) { return num(v) !== null; }) >= 0.9) {
      p.nums = vals.map(num).filter(function (x) { return x !== null; });
      p.bad = vals.filter(function (v) { return num(v) === null; }).slice(0, 3);
      p.badCount = n - p.nums.length;
      var syms = vals.map(function (v) { var m = /[$€£₹¥]/.exec(v); return m ? m[0] : ''; }).filter(String);
      p.sym = syms.length ? Eng.countBy(syms, function (x) { return x; })[0][0] : '';
      var whole = p.nums.every(function (x) { return x === Math.round(x); });
      if (share(function (v) { return /%\s*$/.test(v); }) >= 0.5) p.kind = 'percent';
      else if (whole && p.distinct / n >= 0.9 && n >= 10 && (ID_HINT.test(name) || (Math.max.apply(null, p.nums) - Math.min.apply(null, p.nums) + 1) / p.distinct < 1.2)) p.kind = 'id';
      else if (syms.length / n >= 0.3 || (MONEY_HINT.test(name) && !/qty|quantity|count|units/i.test(name))) p.kind = 'money';
      else p.kind = 'number';
      // A rating or score: whole numbers from 0-10 with few values. It is averaged, never summed.
      p.score = p.kind === 'number' && whole && n >= 5 && !/qty|quantity|count|units|items|number of|stock|on hand/i.test(name) && p.distinct <= 11 && Math.min.apply(null, p.nums) >= 0 && Math.max.apply(null, p.nums) <= 10;
    } else if (p.distinct <= 50 && p.avgLen <= 40 && !(p.distinct / n >= 0.9 && n >= 20)) {
      p.kind = 'category';
    } else if (p.distinct / n >= 0.9 && n >= 10 && p.avgLen <= 40 && (ID_HINT.test(name) || !/\s/.test(vals[0]))) {
      p.kind = 'id';
    } else {
      p.kind = p.avgLen <= 40 ? 'name' : 'text';
    }
    p.top = Eng.countBy(vals, function (x) { return x; });
    return p;
  }

  var numeric = function (p) { return p.kind === 'number' || p.kind === 'money' || p.kind === 'percent'; };
  var groupable = function (p) { return (p.kind === 'category' || p.kind === 'bool') && p.distinct > 1; };

  /** Breakdown columns, most useful first: 5–30 values, then 2–4, then 31–50; fewer blanks first. */
  function rankBreakdowns(ps) {
    var band = function (d) { return d >= 5 && d <= 30 ? 0 : d <= 4 ? 1 : 2; };
    return ps.filter(groupable).slice().sort(function (a, b) { return band(a.distinct) - band(b.distinct) || a.blank - b.blank || ps.indexOf(a) - ps.indexOf(b); });
  }
  /** Measures, most money-like first: a total-like money column (Amount, Revenue) before a per-unit one (Unit price). */
  function rankMeasures(ps) {
    var rank = function (p) {
      var perUnit = PER_UNIT.test(p.name);
      if (p.kind === 'money') return TOTAL_HINT.test(p.name) && !perUnit ? 0 : perUnit ? 5 : 1;
      return p.kind === 'percent' ? 6 : p.score ? 4 : MONEY_HINT.test(p.name) ? 2 : 3;
    };
    return ps.filter(numeric).slice().sort(function (a, b) { return rank(a) - rank(b) || ps.indexOf(a) - ps.indexOf(b); });
  }
  function rankDates(ps) {
    return ps.filter(function (p) { return p.kind === 'date'; }).sort(function (a, b) {
      return Number(!DATE_HINT.test(a.name)) - Number(!DATE_HINT.test(b.name)) || a.blank - b.blank || ps.indexOf(a) - ps.indexOf(b);
    });
  }

  /** The candidate columns for the Adjust panel. */
  template.choices = function (data) {
    var ps = profiles(data);
    return { dates: rankDates(ps).map(function (p) { return p.name; }), measures: rankMeasures(ps).map(function (p) { return p.name; }),
      breakdowns: ps.filter(groupable).map(function (p) { return p.name; }) };
  };

  function cell(v) { return Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v).trim(); }
  function profiles(data) {
    if (data._profiles) return data._profiles;
    var rows = data.records.length;
    data._profiles = data.unique.map(function (h) { return profile(h, data.records.map(function (r) { return cell(r[h]); }), rows); });
    return data._profiles;
  }

  function fmtNum(v, p) {
    if (v === null || v === undefined || isNaN(v)) return '–';
    var a = Math.abs(v), s;
    if (a >= 1e6) s = (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    else if (a >= 1e4) s = Math.round(v).toLocaleString('en-US');
    else s = (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (p && p.kind === 'percent') return s + '%';
    if (p && p.kind === 'money') return (v < 0 ? '−' : '') + (p.sym || '') + s.replace(/^-/, '');
    return s;
  }
  function plural(n, w) { return n.toLocaleString('en-US') + ' ' + w + (n === 1 ? '' : 's'); }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

  /** opt: { date, measure, breakdowns: [names] } (empty = pick automatically). */
  template.analyse = function (data, opt) {
    opt = opt || {};
    var ps = profiles(data), rows = data.records.length, by = {};
    ps.forEach(function (p) { by[p.name] = p; });
    var dates = rankDates(ps), measures = rankMeasures(ps), breaks = rankBreakdowns(ps);
    var date = opt.date === '-' ? null : by[opt.date] && by[opt.date].kind === 'date' ? by[opt.date] : dates[0] || null;
    var measure = opt.measure === '-' ? null : by[opt.measure] && numeric(by[opt.measure]) ? by[opt.measure] : measures[0] || null;
    var chosen = (opt.breakdowns || []).filter(function (b) { return by[b] && by[b].distinct > 1 && !numeric(by[b]); }).map(function (b) { return by[b]; });
    var bk = chosen.length ? chosen.slice(0, 4) : breaks.slice(0, 4);
    var m = { total: rows, cols: ps.length, profiles: ps, date: date, measure: measure, breakdowns: bk };
    var cells = rows * ps.length;
    m.complete = cells ? Math.round(sum(ps.map(function (p) { return p.n; })) * 100 / cells) : 0;
    // KPI totals: the measure, plus one more money column if it is not a per-unit figure (a total of unit prices means nothing).
    m.measures = (measure ? [measure] : []).concat(measures.filter(function (p) { return p !== measure && p.kind === 'money' && !PER_UNIT.test(p.name); })).slice(0, 2);
    var val = function (r, p) { return num(cell(r[p.name])); };

    // Rows (and the measure) over time: per day up to ~2 months, per week up to ~1.5 years, else per month.
    if (date) {
      var df = Eng.guessDayFirst(data.records.map(function (r) { return cell(r[date.name]); }));
      var pts = data.records.map(function (r) { return { d: Eng.parseDate(cell(r[date.name]), df), v: measure ? val(r, measure) : null }; })
        .filter(function (x) { return x.d && !isNaN(x.d); });
      if (pts.length) {
        var t = pts.map(function (x) { return +x.d; });
        m.from = new Date(Math.min.apply(null, t)); m.to = new Date(Math.max.apply(null, t));
        var span = (m.to - m.from) / 864e5;
        m.period = span <= 62 ? 'day' : span <= 550 ? 'week' : 'month';
        var key = m.period === 'day' ? dayKey : m.period === 'week' ? Eng.weekKey : Eng.monthKey;
        var cnt = {}, tot = {}, vn = {};
        pts.forEach(function (x) { var k = key(x.d); cnt[k] = (cnt[k] || 0) + 1; if (x.v !== null) { tot[k] = (tot[k] || 0) + x.v; vn[k] = (vn[k] || 0) + 1; } });
        m.keys = fill(Object.keys(cnt).sort(), m.period);
        m.countSeries = m.keys.map(function (k) { return cnt[k] || 0; });
        m.sumSeries = measure ? m.keys.map(function (k) { return Math.round((measure.score ? (vn[k] ? tot[k] / vn[k] : 0) : tot[k] || 0) * 100) / 100; }) : null;
        // An average over time needs answers in every period (3 or more); a gap would read as a score of 0.
        if (measure && measure.score && m.keys.some(function (k) { return (vn[k] || 0) < 3; })) m.sumSeries = null;
        var busiest = m.keys.reduce(function (a, k) { return (cnt[k] || 0) > (cnt[a] || 0) ? k : a; }, m.keys[0]);
        m.busiest = [busiest, cnt[busiest]];
      }
    }

    // Top values per breakdown (count, and the measure's total when there is one).
    m.cats = bk.map(function (p) {
      var c = {}, s = {};
      data.records.forEach(function (r) {
        var k = cell(r[p.name]) || '(blank)';
        c[k] = (c[k] || 0) + 1;
        if (measure) { var v = val(r, measure); if (v !== null) s[k] = (s[k] || 0) + v; }
      });
      return { p: p, counts: Object.keys(c).map(function (k) { return [k, c[k]]; }).sort(function (a, b) { return b[1] - a[1]; }), sums: s };
    });

    // Number columns: min / median / mean / max, and a histogram of the measure.
    m.stats = ps.filter(numeric).map(function (p) {
      return { p: p, min: Math.min.apply(null, p.nums), max: Math.max.apply(null, p.nums), mean: Eng.mean(p.nums), median: Eng.median(p.nums), sum: sum(p.nums) };
    });
    if (measure && measure.nums.length) m.hist = histogram(measure);

    // Category x category: the two best breakdowns, top 6 values each, the rest as "Other".
    if (bk.length >= 2) m.cross = cross(data, bk[0], bk[1]);

    // Data quality.
    var seen = {}, dup = 0;
    data.records.forEach(function (r) { var k = JSON.stringify(r); if (seen[k]) dup++; else seen[k] = 1; });
    m.duplicates = dup;
    m.idCols = ps.filter(function (p) { return p.kind === 'id'; }).map(function (p) { return p.name; });
    return m;
  };

  function dayKey(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  /** Fills gaps between the first and last period so the line chart's x axis is even. */
  function fill(keys, period) {
    if (keys.length < 2 || keys.length > 400) return keys;
    var out = [], d = new Date(keys[0] + (period === 'month' ? '-01' : '') + 'T00:00:00'), end = keys[keys.length - 1];
    var k = period === 'month' ? Eng.monthKey : period === 'week' ? Eng.weekKey : dayKey;
    for (var i = 0; i < 800; i++) {
      var key = k(d);
      if (out[out.length - 1] !== key) out.push(key);
      if (key >= end) break;
      if (period === 'month') d.setMonth(d.getMonth() + 1); else d.setDate(d.getDate() + (period === 'week' ? 7 : 1));
    }
    return out;
  }

  function histogram(p) {
    var lo = Math.min.apply(null, p.nums), hi = Math.max.apply(null, p.nums);
    if (p.score) {
      var sc = [];
      for (var v = lo; v <= hi; v++) sc.push([String(v), p.nums.filter(function (x) { return x === v; }).length]);
      return sc;
    }
    if (lo === hi) return [[fmtNum(lo, p), p.nums.length]];
    var bins = 8, w = (hi - lo) / bins, out = [];
    for (var i = 0; i < bins; i++) out.push([fmtNum(lo + i * w, p) + ' – ' + fmtNum(lo + (i + 1) * w, p), 0]);
    p.nums.forEach(function (v) { out[Math.min(bins - 1, Math.floor((v - lo) / w))][1]++; });
    return out;
  }

  function cross(data, a, b) {
    var topOf = function (p) { var t = p.top.slice(0, 6).map(function (x) { return x[0]; }); return t; };
    var ra = topOf(a), cb = topOf(b), other = 'Other';
    // "n/a", "unknown", "-" are blanks (as in the profile), not values outside the top 6.
    var key = function (v, list) { return !v || MISSING.test(v) ? '(blank)' : list.indexOf(v) >= 0 ? v : other; };
    var rowsK = ra.slice(), colsK = cb.slice(), grid = {};
    data.records.forEach(function (r) {
      var x = key(cell(r[a.name]), ra), y = key(cell(r[b.name]), cb);
      if (rowsK.indexOf(x) < 0) rowsK.push(x);
      if (colsK.indexOf(y) < 0) colsK.push(y);
      grid[x + '\u0000' + y] = (grid[x + '\u0000' + y] || 0) + 1;
    });
    return { a: a, b: b, rows: rowsK, cols: colsK, grid: grid };
  }

  template.insights = function (m) {
    var out = [], n = m.total;
    m.cats.slice(0, 2).forEach(function (c) {
      var top = c.counts[0];
      if (top && c.counts.length > 1) out.push((top[1] * 2 > n ? 'Most rows' : 'The most common value') + ' (' + Eng.pct(top[1], n) + '%) ' + (top[1] * 2 > n ? 'have ' : 'is ') + c.p.name + ' = ' + top[0] + '.');
    });
    if (m.measure) {
      var tot = sum(m.measure.nums), p = m.measure, line;
      if (p.score) {
        var mx = Math.max.apply(null, p.nums);
        line = p.name + ' averages ' + fmtNum(Eng.mean(p.nums), p) + ' (scale ' + Math.min.apply(null, p.nums) + '–' + mx + ') across ' + plural(p.nums.length, 'row') +
          '; ' + Eng.pct(p.nums.filter(function (x) { return x === mx; }).length, p.nums.length) + '% gave ' + mx;
        tot = 0;
      } else line = p.name + ' totals ' + fmtNum(tot, p) + ' across ' + plural(p.nums.length, 'row') + ' (average ' + fmtNum(Eng.mean(p.nums), p) + ')';
      // The share of the top 5 values of the busiest "who/what" column with many values.
      var many = m.profiles.filter(function (q) { return (q.kind === 'category' || q.kind === 'name') && q.distinct >= 6; })
        .sort(function (a, b) { return b.distinct - a.distinct || a.blank - b.blank; })[0];
      if (many && tot > 0) {
        var s = {};
        m._records.forEach(function (r) { var k = cell(r[many.name]); var v = num(cell(r[p.name])); if (k && v !== null) s[k] = (s[k] || 0) + v; });
        var top5 = sum(Object.keys(s).map(function (k) { return s[k]; }).sort(function (a, b) { return b - a; }).slice(0, 5));
        if (top5 * 4 >= tot) line += '; the top 5 ' + many.name + ' values make up ' + Math.round(top5 * 100 / tot) + '%';
      }
      out.push(line + '.');
      if (p.badCount) out.push(plural(p.badCount, 'value') + ' in ' + p.name + ' are not numbers (for example "' + p.bad[0] + '"), so they are left out of its totals.');
    }
    if (m.from) {
      var b = m.busiest[0], when = m.period === 'month' ? E8.Charts.axisLabel(b) : (m.period === 'week' ? 'the week of ' : '') + new Date(b + 'T00:00:00').toDateString();
      out.push('Rows run from ' + m.from.toDateString() + ' to ' + m.to.toDateString() + (m.keys.length > 1 ? '; the busiest ' + m.period + ' was ' + when + ' with ' + plural(m.busiest[1], 'row') : '') + '.');
    }
    var blanks = m.profiles.filter(function (p) { return n && p.blank / n >= 0.5; }).sort(function (a, b) { return b.blank - a.blank; });
    blanks.slice(0, 2).forEach(function (p) { out.push('Column "' + p.name + '" is ' + Eng.pct(p.blank, n) + '% blank.'); });
    if (blanks.length > 2) out.push(plural(blanks.length - 2, 'more column') + ' are at least half blank (see Data quality).');
    if (m.duplicates) out.push(plural(m.duplicates, 'row') + (m.duplicates === 1 ? ' is an exact copy' : ' are exact copies') + ' of another row.');
    var same = m.profiles.filter(function (p) { return p.n && p.distinct === 1 && n > 1; });
    if (same.length) out.push(plural(same.length, 'column') + ' hold the same value in every filled row (for example "' + same[0].name + '").');
    if (!out.length) out.push(plural(n, 'row') + ' and ' + plural(m.cols, 'column') + '; nothing stands out.');
    return out;
  };

  template.render = function (m) {
    var C = E8.Charts, card = C.card, esc = Eng.esc, n = m.total;
    var tiles = C.tile('Rows', n.toLocaleString('en-US'), plural(m.cols, 'column')) +
      C.tile('Complete', m.complete + '%', 'of all cells are filled in', m.complete < 70 ? 'bad' : m.complete < 90 ? 'warn' : 'good');
    m.measures.forEach(function (p) {
      tiles += p.score ? C.tile(p.name + ' average', fmtNum(Eng.mean(p.nums), p), 'scale ' + Math.min.apply(null, p.nums) + '–' + Math.max.apply(null, p.nums) + ' · ' + plural(p.nums.length, 'answer'))
        : C.tile(p.name + ' total', fmtNum(sum(p.nums), p), 'average ' + esc(fmtNum(Eng.mean(p.nums), p)) + ' · ' + plural(p.nums.length, 'value'));
    });
    if (m.from) tiles += C.tile('Date range', Math.max(1, Math.round((m.to - m.from) / 864e5) + 1) + ' days', esc(m.from.toDateString() + ' – ' + m.to.toDateString()) + ' (' + esc(m.date.name) + ')');
    tiles += C.tile('Data quality', m.duplicates ? plural(m.duplicates, 'duplicate') : 'No duplicates', m.idCols.length ? 'ID column: ' + esc(m.idCols[0]) : 'exact copies of another row', m.duplicates ? 'warn' : '');
    var html = '<div class="kpis">' + tiles + '</div>';
    html += card('Key findings', 'The main points in plain words, worked out from your columns.', C.findings(template.insights(m)), 'wide');

    html += '<div class="grid">';
    var COLORS = ['#3b6fd8', '#c44a7a', '#8a63d2', '#2f9e6e'];
    m.cats.forEach(function (c, i) {
      html += card('Rows by ' + c.p.name, 'How many rows have each value, most first. The grey bar adds up the rest.',
        C.bars(c.counts, { color: COLORS[i % 4], max: 8, more: 'others' }));
    });
    if (m.keys && m.keys.length) {
      var lbl = { day: 'day', week: 'week', month: 'month' }[m.period];
      html += card('Rows per ' + lbl, 'How many rows fall in each ' + lbl + ' of ' + m.date.name + '. Peaks show the busy ' + lbl + 's.',
        C.lines(m.keys, [{ name: 'Rows', values: m.countSeries, color: '#3b6fd8' }]));
      if (m.sumSeries) html += card(m.measure.name + (m.measure.score ? ': average' : '') + ' per ' + lbl,
        (m.measure.score ? 'The average of ' : 'The total of ') + m.measure.name + ' in each ' + lbl + '.',
        C.lines(m.keys, [{ name: m.measure.name, values: m.sumSeries, color: '#2f9e6e' }]));
    }
    if (m.hist) html += card('Spread of ' + m.measure.name, m.measure.score ? 'How many rows gave each score, lowest first.' : 'How many rows fall in each range of ' + m.measure.name + ', from smallest to largest.',
      C.bars(m.hist, { color: '#e0742c', keepZero: true, max: 8 }));
    html += '</div>';

    if (m.stats.length) {
      html += card('Number columns', 'Smallest, middle (median), average and largest value of every number column. A median far from the average means a few very large or small values.',
        C.table([{ t: 'Column' }, { t: 'Type' }, { t: 'Filled', num: true }, { t: 'Min', num: true }, { t: 'Median', num: true }, { t: 'Average', num: true }, { t: 'Max', num: true }, { t: 'Total', num: true }],
          m.stats.map(function (s) {
            return [esc(s.p.name), s.p.score ? 'Score' : KIND_LABEL[s.p.kind], s.p.nums.length.toLocaleString('en-US'), fmtNum(s.min, s.p), fmtNum(s.median, s.p), fmtNum(s.mean, s.p), fmtNum(s.max, s.p),
              s.p.kind === 'percent' || s.p.score ? '–' : fmtNum(s.sum, s.p)].map(function (x, i) { return i ? esc(x) : x; });
          }), { paper: 8, minW: 640 }), 'wide');
    }
    if (m.cross) html += card(m.cross.a.name + ' by ' + m.cross.b.name, 'Exact row counts for each pair of values, with totals. Values outside the top 6 are added up as "Other".', crossTable(m.cross), 'wide');
    html += card('Data quality', 'Each column as we read it: its type, how much is blank and how many different values it has. ID columns are mostly unique, so they are not charted.' +
      (m.duplicates ? ' ' + plural(m.duplicates, 'row') + ' repeat another row exactly.' : ''),
      C.table([{ t: 'Column' }, { t: 'Read as' }, { t: 'Blank', num: true }, { t: 'Different values', num: true }, { t: 'Example' }],
        m.profiles.map(function (p) {
          return [esc(p.name), p.score ? 'Score' : KIND_LABEL[p.kind], Eng.pct(p.blank, n) + '%', p.distinct.toLocaleString('en-US'), esc(p.top && p.top[0] ? String(p.top[0][0]).slice(0, 40) : '')];
        }), { paper: 10, minW: 560 }), 'wide');
    return html;
  };

  function crossTable(x) {
    var C = E8.Charts, esc = Eng.esc, g = function (r, c) { return x.grid[r + '\u0000' + c] || 0; };
    var colTot = x.cols.map(function (c) { return sum(x.rows.map(function (r) { return g(r, c); })); });
    var cols = [{ t: x.a.name }].concat(x.cols.map(function (c) { return { t: c, num: true }; })).concat([{ t: 'Total', num: true }]);
    var rows = x.rows.map(function (r) {
      var vals = x.cols.map(function (c) { return g(r, c); });
      return [esc(r)].concat(vals.map(String)).concat([String(sum(vals))]);
    });
    return C.table(cols, rows, { foot: [['Total'].concat(colTot.map(String)).concat([String(sum(colTot))])], minW: 120 + 80 * cols.length });
  }

  // analyse() keeps the records for the top-5 share finding.
  var analyse = template.analyse;
  template.analyse = function (data, opt) { var m = analyse(data, opt); m._records = data.records; return m; };
  template.num = num;
  template.profile = profile;

  return template;
})();
