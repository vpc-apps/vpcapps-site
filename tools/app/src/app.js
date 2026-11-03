// E8 app: file(s) → detect template (and which part, for multi-file sources) →
// controls → dashboard → single-file export.
// Free tier: first FREE_ROWS rows per file and a watermark on exports (E8.pro unlocks both later).
'use strict';

var E8 = window.E8 || (window.E8 = {});

(function () {
  var Eng = E8.Engine;
  var TEMPLATES = [E8.Jira, E8.Etsy, E8.Attendance];
  var TITLES = { jira: 'QA status report', etsy: 'Etsy profit report', attendance: 'Attendance report' };
  var SAMPLES = { jira: ['samples/jira_sample.csv'], etsy: ['samples/etsy_order_items_sample.csv', 'samples/etsy_statement_sample.csv'],
    attendance: ['samples/attendance_punches_sample.csv'] };
  var state = fresh();
  var $ = function (id) { return document.getElementById(id); };

  function fresh() { return { tpl: null, parts: {}, files: [], opt: {}, model: null, capped: false }; }

  /** Which template + part a parsed file belongs to. */
  function identify(data) {
    for (var i = 0; i < TEMPLATES.length; i++) {
      var t = TEMPLATES[i];
      if (t.part) { var p = t.part(data.header); if (p) return { tpl: t, part: p }; }
      else if (Eng.detect(data.header, [t])) return { tpl: t, part: 'main' };
    }
    return null;
  }

  function readFiles(list) {
    var files = Array.prototype.slice.call(list);
    var bad = files.filter(function (f) { return !/\.(csv|tsv|txt)$/i.test(f.name); });
    if (bad.length) return error('Please choose a CSV export (.csv). From Excel: File → Save As → CSV.');
    Promise.all(files.map(function (f) {
      return new Promise(function (ok, fail) {
        var fr = new FileReader();
        fr.onload = function () { ok({ text: String(fr.result), name: f.name }); };
        fr.onerror = function () { fail(new Error('read')); };
        fr.readAsText(f);
      });
    })).then(function (rs) { rs.forEach(function (r) { add(r.text, r.name); }); show(); })
      .catch(function () { error('Could not read that file.'); });
  }

  /** Adds one file to the current analysis (same template) or starts a new one. */
  function add(text, name) {
    var rows = Eng.parseCSV(text);
    if (!rows.length) return error('That file looks empty.');
    var data = Eng.toRecords(rows);
    var id = identify(data);
    if (!id) return error('“' + name + '” isn’t a format we read yet. Supported: Jira issues export; Etsy Order Items and payments statement CSVs; biometric attendance (punch log or daily In/Out report).');
    if (!data.records.length) return error('“' + name + '” has the right columns but no rows. Export again with your data included.');
    if (!E8.pro && data.records.length > Eng.FREE_ROWS) { data.records = data.records.slice(0, Eng.FREE_ROWS); state.capped = true; }
    if (state.tpl !== id.tpl) { var capped = state.capped; state = fresh(); state.capped = capped; state.tpl = id.tpl; }
    state.parts[id.part] = data;
    state.files = state.files.filter(function (f) { return f.part !== id.part; }).concat([{ name: name, part: id.part }]);
    $('err').hidden = true;
  }

  function show() {
    if (!state.tpl) return;
    var t = state.tpl;
    document.querySelectorAll('[data-for]').forEach(function (el) { el.hidden = el.getAttribute('data-for') !== t.id; });
    if (t.id === 'jira') buildJiraFilters();
    if (t.id === 'etsy') $('file2').parentNode.hidden = !!(state.parts.orders && state.parts.statement);
    if (!$('x-title').dataset.edited) $('x-title').value = TITLES[t.id];
    update();
  }

  function buildJiraFilters() {
    var data = state.parts.main, f = E8.Jira.filters(data), cand = E8.Jira.breakdownCandidates(data);
    var opt = function (v, label) { return '<option value="' + Eng.esc(v) + '">' + Eng.esc(label || v) + '</option>'; };
    $('f-type').innerHTML = opt('*', 'All issue types') + f.types.map(function (x) { return opt(x); }).join('');
    $('f-project').innerHTML = opt('*', 'All projects') + f.projects.map(function (p) { return opt(p); }).join('');
    $('f-extra').innerHTML = opt('', 'Extra breakdown: none') + cand.map(function (c) { return opt(c, c.replace(/^Custom field \((.*)\)$/, '$1')); }).join('');
    $('f-project').parentNode.hidden = f.projects.length < 2;
    $('f-extra').parentNode.hidden = !cand.length;
    var bug = f.types.filter(function (x) { return /^bug$/i.test(x); })[0];
    if (bug) $('f-type').value = bug;
  }

  function update() {
    var t = state.tpl;
    if (t.id === 'jira') {
      state.opt = { type: $('f-type').value, project: $('f-project').value, breakdown: $('f-extra').value || null };
      state.model = t.analyse(state.parts.main, state.opt);
    } else if (t.id === 'attendance') {
      state.opt = { start: $('a-start').value, end: $('a-end').value, grace: +$('a-grace').value || 0,
        off: $('a-off').value.split(',').filter(String).map(Number) };
      state.model = t.analyse(state.parts, state.opt);
    } else {
      state.opt = { cogsPct: parseFloat(String($('f-cogs').value).replace(',', '.')) || 0 };
      state.model = t.analyse(state.parts, state.opt);
    }
    $('drop').hidden = true;
    $('dash').hidden = false;
    $('meta').textContent = state.files.map(function (f) { return f.name; }).join(' + ') + ' · ' + metaLine() +
      (state.capped ? ' · free version: first ' + Eng.FREE_ROWS.toLocaleString() + ' rows per file' : '');
    $('body').innerHTML = state.model.total ? t.render(state.model) : '<p class="muted">No rows match these settings.</p>';
  }

  function metaLine() {
    var m = state.model;
    if (state.tpl.id === 'jira') return m.total + ' issues · data as of ' + m.asOf.toDateString();
    if (state.tpl.id === 'attendance') return m.people + ' employees · ' + m.workDays + ' working days · ' + m.from.toDateString() + ' – ' + m.to.toDateString();
    if (m.orders) return m.orders.lines + ' order lines · ' + m.orders.from.toDateString() + ' – ' + m.orders.to.toDateString();
    return m.total + ' statement lines';
  }

  function error(msg) { $('err').textContent = msg; $('err').hidden = false; $('drop').hidden = false; }

  /** One self-contained HTML file: no scripts, opens offline, can be emailed. */
  function exportHtml() {
    var m = state.model, title = $('x-title').value || TITLES[state.tpl.id];
    var css = document.getElementById('report-css').textContent + E8.Charts.CSS;
    var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + Eng.esc(title) + '</title><style>' + css + '</style></head><body><main class="report">' +
      '<header><h1>' + Eng.esc(title) + '</h1><p class="muted">' + Eng.esc(metaLine()) + '</p></header>' + state.tpl.render(m) +
      (E8.pro ? '' : '<footer class="wm">Made with the free Export to Dashboard tool · vpcapps.net/tools</footer>') +
      '</main></body></html>';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function loadSample(id) {
    Promise.all(SAMPLES[id].map(function (u) {
      return fetch(u).then(function (r) { return r.text(); }).then(function (t) { return { text: t, name: u.split('/').pop() }; });
    })).then(function (rs) { state = fresh(); rs.forEach(function (r) { add(r.text, r.name); }); show(); })
      .catch(function () { error('The sample file could not be loaded.'); });
  }

  function init() {
    var drop = $('drop');
    $('file').addEventListener('change', function (e) { if (e.target.files.length) { state = fresh(); readFiles(e.target.files); } });
    $('file2').addEventListener('change', function (e) { if (e.target.files.length) readFiles(e.target.files); });
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) { state = fresh(); readFiles(e.dataTransfer.files); } });
    document.querySelectorAll('[data-tpl]').forEach(function (b) { b.addEventListener('click', function () { loadSample(b.getAttribute('data-tpl')); }); });
    ['f-type', 'f-project', 'f-extra'].forEach(function (id) { $(id).addEventListener('change', update); });
    $('f-cogs').addEventListener('input', function () { if (state.tpl) update(); });
    ['a-start', 'a-end', 'a-grace', 'a-off'].forEach(function (id) { $(id).addEventListener('change', function () { if (state.tpl) update(); }); });
    $('x-title').addEventListener('input', function () { $('x-title').dataset.edited = '1'; });
    $('export').addEventListener('click', exportHtml);
    $('print').addEventListener('click', function () { window.print(); });
    $('again').addEventListener('click', function () { state = fresh(); $('dash').hidden = true; $('drop').hidden = false; $('err').hidden = true; $('file').value = ''; });
    // Landing pages preselect a source (?t=etsy) and may embed the app (&embed=1).
    var t = /[?&]t=(\w+)/.exec(location.search);
    if (t && HERO[t[1]]) preselect(t[1]);
    if (t && HERO[t[1]] && /[?&]sample=1/.test(location.search)) loadSample(t[1]);
    if (/[?&]embed=1/.test(location.search)) embed();
  }

  var HERO = {
    jira: ['Drop your Jira CSV export', 'Get a QA and bug dashboard: created vs resolved trend, ageing, by priority, assignee and component, with a one-page executive summary to share.'],
    etsy: ['Drop your Etsy CSV files', 'Order Items CSV, payments statement CSV, or both: get your true profit after every Etsy fee, ads and refunds, plus best sellers by month.'],
    attendance: ['Drop your attendance export', 'A biometric punch log (ZKTeco, BioTime) or a daily In/Out report (eSSL eTimeTrackLite): get late arrivals, overtime, absences and missing punches per employee.']
  };

  function preselect(id) {
    document.body.dataset.source = id;
    document.querySelectorAll('[data-src="' + id + '"]').forEach(function (el) { el.classList.add('on'); });
    $('hero').textContent = HERO[id][0];
    $('hero-sub').textContent = HERO[id][1];
    var s = $('sample-' + id);
    s.textContent = 'Try it with a sample file';
  }

  /** Inside a landing page: tell the page our height so it can size the frame. */
  function embed() {
    document.body.classList.add('embed');
    if (window.parent === window) return;
    var last = 0;
    var tell = function () {
      // Lowest visible block (not scrollHeight: it never shrinks below the frame's own height).
      var h = 16 + Math.ceil(Array.prototype.reduce.call(document.body.children, function (m, el) {
        return Math.max(m, el.getBoundingClientRect().bottom + window.scrollY);
      }, 0));
      if (h !== last) { last = h; window.parent.postMessage({ e8height: h }, location.origin); }
    };
    if (window.ResizeObserver) new ResizeObserver(tell).observe(document.body);
    window.addEventListener('load', tell);
    tell();
  }

  E8.App = { add: add, show: show, state: function () { return state; }, loadSample: loadSample };
  document.addEventListener('DOMContentLoaded', init);
})();
