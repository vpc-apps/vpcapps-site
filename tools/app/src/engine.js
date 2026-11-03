// E8.Engine: everything a template needs that is not about one data source.
// CSV parsing (RFC 4180, BOM, ; or , or tab), duplicate headers merged into
// lists (Jira repeats Comment/Labels/Sprint columns), date parsing for the
// formats exports use, small statistics and a row cap for the free tier.
// No libraries and no network: the file never leaves the device.
'use strict';

var E8 = window.E8 || (window.E8 = {});

E8.Engine = (function () {
  var FREE_ROWS = 5000;

  /** Splits CSV text into rows of cells. Handles quotes, "" escapes and newlines inside quotes. */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
    var delim = [',', ';', '\t'].map(function (d) { return [d, first.split(d).length]; })
      .sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); });
  }

  /**
   * Turns rows into records. Repeated header names become arrays of the
   * non-empty values ("Labels" x4 -> ['ui','login']); single headers stay strings.
   */
  function toRecords(rows) {
    var header = rows[0].map(function (h) { return h.trim(); });
    var count = {};
    header.forEach(function (h) { count[h] = (count[h] || 0) + 1; });
    var multi = {};
    Object.keys(count).forEach(function (h) { if (count[h] > 1) multi[h] = true; });
    var records = rows.slice(1).map(function (r) {
      var o = {};
      header.forEach(function (h, i) {
        var v = (r[i] || '').trim();
        if (multi[h]) { (o[h] = o[h] || []); if (v) o[h].push(v); } else o[h] = v;
      });
      return o;
    });
    return { header: header, unique: Object.keys(count), multi: multi, records: records };
  }

  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  /** Parses the date formats exports use; returns a Date or null. dayFirst decides 03/04/2026. */
  function parseDate(s, dayFirst) {
    if (!s) return null;
    s = String(s).trim();
    var m, h = 0, mi = 0;
    var t = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(s);
    if (t) {
      h = +t[1]; mi = +t[2];
      if (t[3]) { var pm = t[3].toUpperCase() === 'PM'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    }
    // 2026-11-02 / 2026-11-02T15:15
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return new Date(+m[1], m[2] - 1, +m[3], h, mi);
    // 02/Nov/26 or 02-Nov-2026 or 2 Nov 2026 (Jira's default)
    if ((m = /^(\d{1,2})[\/\- ]([A-Za-z]{3})[A-Za-z]*[\/\- ,]+(\d{2,4})/.exec(s))) {
      var mo = MON[m[2].toLowerCase()];
      if (mo !== undefined) return new Date(year(m[3]), mo, +m[1], h, mi);
    }
    // Nov 2, 2026
    if ((m = /^([A-Za-z]{3})[A-Za-z]* (\d{1,2}),? (\d{4})/.exec(s))) {
      var mo2 = MON[m[1].toLowerCase()];
      if (mo2 !== undefined) return new Date(+m[3], mo2, +m[2], h, mi);
    }
    // 03/04/2026, 03-04-2026, 03.04.2026 (ambiguous): day first or month first
    if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s))) {
      var a = +m[1], b = +m[2];
      var d = dayFirst ? a : b, mo3 = dayFirst ? b : a;
      if (mo3 > 12) { var x = d; d = mo3; mo3 = x; }
      return new Date(year(m[3]), mo3 - 1, d, h, mi);
    }
    var n = Date.parse(s);
    return isNaN(n) ? null : new Date(n);
  }
  function year(y) { y = +y; return y < 100 ? 2000 + y : y; }

  /** Decides day-first vs month-first from the values themselves (any first part > 12 = day first). */
  function guessDayFirst(values) {
    var dayFirst = false, monthFirst = false;
    values.forEach(function (s) {
      var m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/.exec(String(s || '').trim());
      if (!m) return;
      if (+m[1] > 12) dayFirst = true;
      if (+m[2] > 12) monthFirst = true;
    });
    return dayFirst || !monthFirst;
  }

  // ---------------------------------------------------------------- stats
  function countBy(list, fn) {
    var o = {};
    list.forEach(function (x) {
      var k = fn(x);
      (Array.isArray(k) ? k : [k]).forEach(function (key) {
        key = key === undefined || key === null || key === '' ? '(none)' : key;
        o[key] = (o[key] || 0) + 1;
      });
    });
    return Object.keys(o).map(function (k) { return [k, o[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  }
  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mean(nums) { return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null; }
  /** Monday-based week key, e.g. "2026-11-02". */
  function weekKey(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }
  function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /** Picks the template whose fingerprint matches the most headers. */
  function detect(header, templates) {
    var best = null, bestScore = 0;
    templates.forEach(function (t) {
      var hits = t.fingerprint.filter(function (h) { return header.indexOf(h) >= 0; }).length;
      var score = hits / t.fingerprint.length;
      if (score > bestScore) { bestScore = score; best = t; }
    });
    return bestScore >= 0.6 ? best : null;
  }

  return {
    FREE_ROWS: FREE_ROWS, parseCSV: parseCSV, toRecords: toRecords, parseDate: parseDate,
    guessDayFirst: guessDayFirst, countBy: countBy, median: median, mean: mean,
    weekKey: weekKey, monthKey: monthKey, pct: pct, esc: esc, detect: detect,
  };
})();
