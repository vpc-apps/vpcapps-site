// E8.Charts: small SVG charts as strings, so the same markup works on screen
// and inside the exported single-file HTML (no script needed to view it).
// Colours come from CSS variables with fallbacks for the export.
'use strict';

var E8 = window.E8 || (window.E8 = {});

E8.Charts = (function () {
  var esc = function (s) { return E8.Engine.esc(s); };
  var PALETTE = ['#3b6fd8', '#e0742c', '#2f9e6e', '#c44a7a', '#8a63d2', '#c9a227', '#3aa3b8', '#7d7d7d'];

  /** Horizontal bars: rows = [[label, value], ...]. */
  function bars(rows, opt) {
    opt = opt || {};
    rows = rows.slice(0, opt.max || 10);
    if (!rows.length) return empty();
    var w = opt.w || 520, lh = 26, lw = 170, h = rows.length * lh + 8, fmt = opt.fmt || function (v) { return v; };
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; })) || 1;
    var out = rows.map(function (r, i) {
      var bw = Math.max(2, (w - lw - 60) * r[1] / max), y = i * lh + 4;
      var label = r[0].length > 21 ? r[0].slice(0, 20) + '…' : r[0];
      return '<text x="' + (lw - 8) + '" y="' + (y + 16) + '" text-anchor="end" class="lbl">' + esc(label) + '</text>' +
        '<rect x="' + lw + '" y="' + (y + 4) + '" width="' + bw.toFixed(1) + '" height="16" rx="3" fill="' + (opt.color || PALETTE[0]) + '"/>' +
        '<text x="' + (lw + bw + 6).toFixed(1) + '" y="' + (y + 16) + '" class="val">' + esc(fmt(r[1])) + '</text>';
    }).join('');
    return svg(w, h, out, opt.title);
  }

  /** Lines over time: keys = x labels, series = [{name, values, color}]. */
  function lines(keys, series, opt) {
    opt = opt || {};
    if (!keys.length) return empty();
    var w = opt.w || 520, h = opt.w ? 260 : 220, l = 40, r = 10, t = 14, b = 34;
    var max = Math.max(1, Math.max.apply(null, series.map(function (s) { return Math.max.apply(null, s.values); })));
    var x = function (i) { return l + (keys.length === 1 ? (w - l - r) / 2 : i * (w - l - r) / (keys.length - 1)); };
    var y = function (v) { return t + (h - t - b) * (1 - v / max); };
    var out = '';
    [0, 0.5, 1].forEach(function (f) {
      var v = Math.round(max * f);
      out += '<line x1="' + l + '" x2="' + (w - r) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/>' +
        '<text x="' + (l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="ax">' + v + '</text>';
    });
    var step = Math.ceil(keys.length / 6);
    keys.forEach(function (k, i) {
      if (i % step === 0 || i === keys.length - 1) out += '<text x="' + x(i) + '" y="' + (h - 12) + '" text-anchor="middle" class="ax">' + esc(k.slice(5)) + '</text>';
    });
    series.forEach(function (s, si) {
      var c = s.color || PALETTE[si];
      out += '<polyline fill="none" stroke="' + c + '" stroke-width="2.2" points="' +
        s.values.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ') + '"/>';
    });
    var legend = series.map(function (s, si) {
      return '<tspan fill="' + (s.color || PALETTE[si]) + '">■</tspan> ' + esc(s.name) + '   ';
    }).join('');
    out += '<text x="' + l + '" y="' + (h - 0) + '" class="ax">' + legend + '</text>';
    return svg(w, h + 4, out, opt.title);
  }

  /** Stacked single bar of shares, e.g. open issues by age bucket. */
  function shares(rows, opt) {
    opt = opt || {};
    var total = rows.reduce(function (a, r) { return a + r[1]; }, 0);
    if (!total) return empty();
    var w = opt.w || 520, x = 0, out = '', leg = '';
    rows.forEach(function (r, i) {
      var bw = (w - 2) * r[1] / total, c = PALETTE[i % PALETTE.length];
      out += '<rect x="' + (1 + x).toFixed(1) + '" y="4" width="' + Math.max(0, bw - 1).toFixed(1) + '" height="26" fill="' + c + '"/>';
      x += bw;
      leg += '<tspan fill="' + c + '">■</tspan> ' + esc(r[0]) + ' (' + r[1] + ')   ';
    });
    out += '<text x="0" y="50" class="ax">' + leg + '</text>';
    return svg(w, 58, out, opt.title);
  }

  function svg(w, h, inner, title) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img"' + (title ? ' aria-label="' + esc(title) + '"' : '') +
      ' preserveAspectRatio="xMinYMin meet">' + inner + '</svg>';
  }
  function empty() { return '<p class="muted">No data for this chart.</p>'; }

  /** CSS for the charts, used on screen and in the export. */
  var CSS = 'svg{width:100%;height:auto;font:12px system-ui,sans-serif}svg .lbl{fill:var(--ink,#1d2333)}' +
    'svg .val,svg .ax{fill:var(--muted,#5d667c)}svg .grid{stroke:var(--line,#dde2ee);stroke-width:1}';

  return { bars: bars, lines: lines, shares: shares, CSS: CSS, PALETTE: PALETTE };
})();
