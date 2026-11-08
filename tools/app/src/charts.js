// E8.Charts: charts and report blocks as HTML strings, so the same markup works on screen,
// inside the exported single-file HTML (no script needed to view it) and in print.
// Bars are HTML (they fill the card and their text never shrinks with it); line charts are SVG,
// drawn at a few widths close to the real card width so their text stays readable.
'use strict';

var E8 = window.E8 || (window.E8 = {});

E8.Charts = (function () {
  var esc = function (s) { return E8.Engine.esc(s); };
  var PALETTE = ['#3b6fd8', '#e0742c', '#2f9e6e', '#c44a7a', '#8a63d2', '#c9a227', '#3aa3b8', '#7d7d7d'];
  var REST = '#9aa3b5';

  /**
   * Horizontal bars, rows = [[label, value], ...]. The rows share the card's height, so a few bars grow
   * thicker and many stay readable. A long list folds into "N others" (opt.more names them).
   * opt: { max (rows shown, default 10), more, color, colors [per row], fmt, keepZero }
   */
  function bars(rows, opt) {
    opt = opt || {};
    rows = rows.filter(function (r) { return opt.keepZero || r[1] > 0; });
    var limit = opt.max || 10, colors = opt.colors;
    if (rows.length > limit) {
      var rest = rows.slice(limit - 1).reduce(function (a, r) { return a + r[1]; }, 0), n = rows.length - limit + 1;
      rows = rows.slice(0, limit - 1).concat([[n + ' ' + (opt.more || 'others'), Math.round(rest * 100) / 100, true]]);
    }
    if (!rows.length || !rows.some(function (r) { return r[1] > 0; })) return empty();
    // The scale comes from the real rows: a folded "N others" bar would dwarf them. It is capped at full width
    // and striped when it is off the scale; its number stays exact.
    var real = rows.filter(function (r) { return !r[2]; });
    var max = Math.max.apply(null, (real.length ? real : rows).map(function (r) { return r[1]; })) || 1, fmt = opt.fmt || function (v) { return v; };
    return '<div class="hb" style="--n:' + rows.length + '">' + rows.map(function (r, i) {
      var c = r[2] ? REST : (colors ? colors[i % colors.length] : (opt.color || PALETTE[0]));
      var w = r[1] > 0 ? Math.max(1.5, 100 * r[1] / max) : 0, over = w > 100;
      return '<div class="hb-row"><span class="hb-l" title="' + esc(r[0]) + '">' + esc(r[0]) + '</span><span class="hb-t"><span class="hb-b' + (over ? ' hb-over' : '') + '"' +
        (over ? ' title="Not to scale: adds up all the rows not shown"' : '') + ' style="width:' + Math.min(100, w).toFixed(1) + '%;background:' + c + '"></span></span><span class="hb-v">' + esc(fmt(r[1])) + '</span></div>';
    }).join('') + '</div>';
  }

  /** Stacked horizontal bars: rows = [[label, [v1, v2, ...]]], parts = [{name, color}]. Same layout as bars. */
  function stack(rows, parts) {
    rows = rows.filter(function (r) { return r[1].some(function (v) { return v > 0; }); });
    if (!rows.length) return empty();
    var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
    var max = Math.max.apply(null, rows.map(function (r) { return sum(r[1]); })) || 1;
    return legend(parts) + '<div class="hb" style="--n:' + rows.length + '">' + rows.map(function (r) {
      var tot = sum(r[1]);
      return '<div class="hb-row"><span class="hb-l" title="' + esc(r[0]) + '">' + esc(r[0]) + '</span><span class="hb-t"><span class="hb-s" style="width:' +
        (100 * tot / max).toFixed(1) + '%">' + r[1].map(function (v, i) {
          return v ? '<span class="hb-b" title="' + esc(parts[i].name + ': ' + v) + '" style="width:' + (100 * v / tot).toFixed(1) + '%;background:' + parts[i].color + '"></span>' : '';
        }).join('') + '</span></span><span class="hb-v">' + r[1].join(' / ') + '</span></div>';
    }).join('') + '</div>';
  }

  function legend(parts) {
    return '<div class="legend">' + parts.map(function (p) { return '<span><i style="background:' + p.color + '"></i>' + esc(p.name) + '</span>'; }).join('') + '</div>';
  }

  /**
   * Lines over time: keys = x labels (dates), series = [{name, values, color}]. opt.wide = a full-width card.
   * Drawn at the widths the card really has (wide screen, print, phone); CSS shows the one that fits.
   */
  function lines(keys, series, opt) {
    opt = opt || {};
    if (!keys.length) return empty();
    // Card widths: wide ~1040 on screen, ~720 on A4, ~380 on a phone; a grid card ~330 on screen and phone, ~230 on A4.
    var sizes = opt.wide ? [[1040, 'ln-l'], [720, 'ln-p'], [400, 'ln-s']] : [[340, 'ln-l ln-s'], [250, 'ln-p']];
    return legend(series.map(function (s, i) { return { name: s.name, color: s.color || PALETTE[i] }; })) +
      sizes.map(function (z) { return line(keys, series, z[0], z[1], opt.title); }).join('');
  }

  function line(keys, series, w, cls, title) {
    var h = w > 600 ? 230 : w > 300 ? 210 : 170, l = 36, r = 12, t = 12, b = 24;
    var max = Math.max(1, Math.max.apply(null, series.map(function (s) { return Math.max.apply(null, s.values); })));
    var x = function (i) { return l + (keys.length === 1 ? (w - l - r) / 2 : i * (w - l - r) / (keys.length - 1)); };
    var y = function (v) { return t + (h - t - b) * (1 - v / max); };
    var fmtAx = function (v) { return v >= 10000 ? Math.round(v / 1000) + 'k' : v; };
    var out = '';
    [0, 0.5, 1].forEach(function (f) {
      var v = Math.round(max * f);
      out += '<line x1="' + l + '" x2="' + (w - r) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/>' +
        '<text x="' + (l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="ax">' + fmtAx(v) + '</text>';
    });
    var labelW = 46, step = Math.max(1, Math.ceil(keys.length / Math.floor((w - l - r) / labelW))), last = keys.length - 1;
    keys.forEach(function (k, i) {
      // The last label ends at the chart edge (centred it would be cut off); a regular one too close to it is skipped.
      var isLast = i === last && last > 0;
      if (!isLast && (i % step !== 0 || (i !== last && x(last) - x(i) < labelW))) return;
      out += '<text x="' + x(i) + '" y="' + (h - 6) + '" text-anchor="' + (isLast ? 'end' : 'middle') + '" class="ax">' + esc(axisLabel(k)) + '</text>';
    });
    series.forEach(function (s, si) {
      var c = s.color || PALETTE[si];
      out += '<polyline fill="none" stroke="' + c + '" stroke-width="2.2" points="' +
        s.values.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ') + '"/>';
      if (keys.length === 1) out += '<circle cx="' + x(0) + '" cy="' + y(s.values[0]) + '" r="4" fill="' + c + '"/>';
    });
    return '<svg class="ln ' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" role="img"' + (title ? ' aria-label="' + esc(title) + '"' : '') +
      ' preserveAspectRatio="xMidYMin meet">' + out + '</svg>';
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** "2026-10-05" → "10-05", "2026-10" → "Oct 26", anything else as it is. */
  function axisLabel(k) {
    k = String(k);
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return k.slice(5);
    var m = /^(\d{4})-(\d{2})$/.exec(k);
    return m ? MONTHS[+m[2] - 1] + ' ' + m[1].slice(2) : k;
  }

  function empty() { return '<p class="muted">No data for this chart.</p>'; }

  // ------------------------------------------------------------ report blocks

  /** A report card: title, one plain sentence on what it shows and how to read it, then the content. cls: 'wide'. */
  function card(title, desc, body, cls) {
    return '<section class="card' + (cls ? ' ' + cls : '') + '"><h3>' + esc(title) + '</h3>' +
      (desc ? '<p class="desc">' + esc(desc) + '</p>' : '') + '<div class="cb">' + body + '</div></section>';
  }

  /** A KPI card: big value, label, small sub-line (HTML allowed). state: 'good' | 'warn' | 'bad' colours the bottom border. */
  function tile(label, value, sub, state) {
    return '<div class="kpi' + (state ? ' ' + state : '') + '"><div class="kv">' + esc(value) + '</div><div class="kl">' + esc(label) + '</div>' +
      (sub ? '<div class="kn">' + sub + '</div>' : '') + '</div>';
  }

  /**
   * A bordered table that scrolls sideways inside its own box on narrow screens.
   * cols = [{t: 'Header', num: true}], rows = [[cell html, ...]] (cells already escaped),
   * opt: { foot: [[cells]] (bold rows at the end), sub: {at: index, row: [cells]} , paper: rows kept in print, minW }
   */
  function table(cols, rows, opt) {
    opt = opt || {};
    if (!rows.length) return '<p class="muted">No rows for this table.</p>';
    var tr = function (cells, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cells.map(function (c, i) { return '<td' + (cols[i] && cols[i].num ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>';
    };
    var body = rows.map(function (r, i) {
      var html = tr(r, opt.paper && i >= opt.paper ? 'xtra' : '');
      return opt.sub && opt.sub.at === i + 1 ? html + tr(opt.sub.row, 'sub') : html;
    }).join('');
    var more = opt.paper && rows.length > opt.paper ? '<p class="more paper">Printed: the first ' + opt.paper + ' of ' + rows.length + ' rows. The full list is on screen and in the downloaded report.</p>' : '';
    return '<div class="tw"><table class="data" style="min-width:' + (opt.minW || 520) + 'px"><thead><tr>' +
      cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.t) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      body + (opt.foot || []).map(function (r) { return tr(r, 'total'); }).join('') + '</tbody></table></div>' + more;
  }

  /** Findings as a list of short plain sentences. */
  function findings(list) {
    return '<ul class="ins">' + list.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
  }

  /** CSS for the charts, used on screen and in the export (the page's report-css holds the rest). */
  var CSS = 'svg.ln{width:100%;height:auto;font:12px system-ui,sans-serif;display:block}svg .ax{fill:var(--muted,#5d667c)}svg .grid{stroke:var(--line,#dde2ee);stroke-width:1}' +
    'svg.ln-s,svg.ln-p{display:none}@media (max-width:640px){svg.ln-l{display:none}svg.ln-s{display:block}}' +
    '.hb{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;gap:6px;min-height:calc(var(--n) * 30px);font-size:13px}' +
    '.hb-row{flex:1 1 0;display:grid;grid-template-columns:minmax(64px,34%) minmax(0,1fr) auto;align-items:center;gap:8px;min-height:22px;max-height:64px}' +
    '.hb-l{text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink,#1d2333)}' +
    '.hb-t{display:flex;align-items:center;height:100%;min-height:14px}.hb-b{display:block;height:clamp(12px,62%,34px);border-radius:3px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.hb-s{display:flex;height:clamp(12px,62%,34px)}.hb-s .hb-b{height:100%;border-radius:0}.hb-s .hb-b:first-child{border-radius:3px 0 0 3px}.hb-s .hb-b:last-child{border-radius:0 3px 3px 0}' +
    '.hb-b.hb-over{background-image:repeating-linear-gradient(135deg,transparent 0 6px,rgba(255,255,255,.55) 6px 9px)!important}' +
    '.hb-v{color:var(--muted,#5d667c);font-variant-numeric:tabular-nums;white-space:nowrap;min-width:2ch}' +
    '.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--muted,#5d667c);margin-bottom:6px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '@media print{svg.ln-l,svg.ln-s{display:none}svg.ln-p{display:block}svg.ln{max-height:150px}.hb{min-height:0!important;gap:2px}.hb-row{min-height:0;max-height:none;flex:0 0 auto}.hb-t{height:12px;min-height:0}.hb-b,.hb-s{height:10px}.hb-l,.hb-v{font-size:10px}.legend{font-size:10px;margin-bottom:2px}}';

  return { bars: bars, stack: stack, lines: lines, axisLabel: axisLabel, card: card, tile: tile, table: table, findings: findings, CSS: CSS, PALETTE: PALETTE };
})();
