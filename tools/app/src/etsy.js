// E8 template: Etsy seller true profit.
// Two Etsy exports, either or both:
//  - Sold Order Items CSV (Shop Manager → Settings → Options → Download Data → Orders: "Order Items")
//  - Payments statement CSV (Shop Manager → Finances → Payment account / Monthly statements → Download CSV)
// Profit = item sales − Etsy fees (transaction, processing, listing, regulatory) − ads − shipping labels
//          − refunds − product cost (% of item price, entered by the seller).
'use strict';

var E8 = window.E8 || (window.E8 = {});

E8.Etsy = (function () {
  var Eng = E8.Engine;

  var PARTS = {
    orders: ['Sale Date', 'Item Name', 'Quantity', 'Price', 'Order ID'],
    statement: ['Date', 'Type', 'Title', 'Amount', 'Fees & Taxes', 'Net'],
  };

  var template = {
    id: 'etsy',
    name: 'Etsy sales + payments',
    multiFile: true,
    // detect() scores against this list; either file's columns must match.
    fingerprint: PARTS.orders,
    fingerprints: [PARTS.orders, PARTS.statement],
    help: 'Etsy: Shop Manager → Settings → Options → Download Data (Order Items CSV), and Finances → Monthly statements → Download CSV.',
  };

  /** Which Etsy file this is: 'orders', 'statement' or null. */
  template.part = function (header) {
    var best = null, bestScore = 0;
    Object.keys(PARTS).forEach(function (k) {
      var s = PARTS[k].filter(function (h) { return header.indexOf(h) >= 0; }).length / PARTS[k].length;
      if (s > bestScore) { bestScore = s; best = k; }
    });
    return bestScore >= 0.8 ? best : null;
  };

  /** "$1,234.50", "-$0.20", "(0.20)", "--", "12,50 €" → number (0 when empty). */
  function money(s) {
    if (s === undefined || s === null) return 0;
    s = String(s).trim();
    if (!s || s === '--' || s === '-') return 0;
    var neg = /^-|^\(|-\s*[^\d]*$/.test(s) || /\)$/.test(s);
    var t = s.replace(/[^\d.,]/g, '');
    if (/,\d{2}$/.test(t) && t.indexOf('.') < 0) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    var n = parseFloat(t) || 0;
    return neg ? -n : n;
  }
  template.money = money;

  function currencyOf(recs, col) {
    for (var i = 0; i < recs.length && i < 50; i++) {
      var v = recs[i][col] || '';
      if (/€/.test(v)) return '€';
      if (/£/.test(v)) return '£';
      if (/₹|INR/.test(v)) return '₹';
      if (/\$/.test(v)) return '$';
    }
    var c = recs[0] && (recs[0]['Currency'] || '');
    return { EUR: '€', GBP: '£', INR: '₹', USD: '$', CAD: 'CA$', AUD: 'A$' }[c] || '$';
  }

  /** Fee bucket for one statement line. */
  function bucket(type, title, info) {
    var t = (type + ' ' + title + ' ' + info).toLowerCase();
    if (/deposit|payout|reserve/.test(t)) return 'payout';
    if (/^tax|sales tax|vat on sale|collected/.test(type.toLowerCase())) return 'tax';
    if (/refund/.test(t)) return 'refunds';
    if (/offsite ads/.test(t)) return 'Offsite Ads';
    if (/etsy ads|marketing|promoted/.test(t)) return 'Etsy Ads';
    if (/shipping label|postage|usps|royal mail|shipping/.test(t) && !/^sale/.test(type.toLowerCase())) return 'Shipping labels';
    if (/transaction fee/.test(t)) return 'Transaction fees';
    if (/processing fee|payment processing/.test(t)) return 'Processing fees';
    if (/listing fee|renew/.test(t)) return 'Listing fees';
    if (/regulatory|operating fee|vat on fee|currency conversion/.test(t)) return 'Other Etsy fees';
    if (/^sale|^payment/.test(type.toLowerCase())) return 'sale';
    if (/fee/.test(t)) return 'Other Etsy fees';
    return 'other';
  }

  /** opt: { cogsPct } (0–100). parts: { orders: data, statement: data }. */
  template.analyse = function (parts, opt) {
    opt = opt || {};
    var cogsPct = Math.max(0, Math.min(100, +opt.cogsPct || 0)) / 100;
    var m = { parts: Object.keys(parts), cur: '$', orders: null, fees: null };

    if (parts.orders) {
      var recs = parts.orders.records;
      m.cur = currencyOf(recs, 'Price');
      var dates = recs.map(function (r) { return r['Sale Date']; });
      var dayFirst = Eng.guessDayFirst(dates);
      var lines = recs.map(function (r) {
        var qty = +(r['Quantity'] || 1) || 1;
        var price = money(r['Price']);
        var disc = money(r['Discount Amount']);
        var total = r['Item Total'] !== undefined && r['Item Total'] !== '' ? money(r['Item Total']) : price * qty - Math.abs(disc);
        return {
          date: Eng.parseDate(r['Sale Date'], dayFirst), item: r['Item Name'] || '(no name)', qty: qty, total: total,
          order: r['Order ID'], country: r['Ship Country'] || '', shipping: money(r['Order Shipping']), disc: Math.abs(disc),
        };
      }).filter(function (l) { return l.date; });
      var byItem = {}, byMonth = {}, orders = {}, byCountry = {};
      lines.forEach(function (l) {
        byItem[l.item] = (byItem[l.item] || 0) + l.total;
        var mk = Eng.monthKey(l.date); byMonth[mk] = (byMonth[mk] || 0) + l.total;
        orders[l.order] = 1;
        if (l.country) byCountry[l.country] = (byCountry[l.country] || 0) + l.total;
      });
      var sales = lines.reduce(function (a, l) { return a + l.total; }, 0);
      var units = lines.reduce(function (a, l) { return a + l.qty; }, 0);
      var nOrders = Object.keys(orders).length;
      m.orders = {
        lines: lines.length, sales: sales, units: units, orders: nOrders, aov: nOrders ? sales / nOrders : 0,
        discounts: lines.reduce(function (a, l) { return a + l.disc; }, 0),
        byItem: sortObj(byItem), byCountry: sortObj(byCountry),
        months: Object.keys(byMonth).sort(), byMonth: byMonth,
        from: new Date(Math.min.apply(null, lines.map(function (l) { return l.date; }))),
        to: new Date(Math.max.apply(null, lines.map(function (l) { return l.date; }))),
      };
    }

    if (parts.statement) {
      var srecs = parts.statement.records;
      if (!parts.orders) m.cur = currencyOf(srecs, 'Amount');
      var sd = Eng.guessDayFirst(srecs.map(function (r) { return r['Date']; }));
      var b = {}, sales2 = 0, feeMonth = {};
      srecs.forEach(function (r) {
        var k = bucket(r['Type'] || '', r['Title'] || '', r['Info'] || '');
        var amount = money(r['Amount']), feesTax = money(r['Fees & Taxes']), net = money(r['Net']);
        if (k === 'sale') { sales2 += amount; return; }
        if (k === 'payout' || k === 'tax' || k === 'other') return;
        // Costs are negative in Etsy statements; use the net effect.
        var cost = -(net || feesTax || amount);
        b[k] = (b[k] || 0) + cost;
        var d = Eng.parseDate(r['Date'], sd);
        if (d) { var mk = Eng.monthKey(d); feeMonth[mk] = (feeMonth[mk] || 0) + cost; }
      });
      var feeRows = Object.keys(b).filter(function (k) { return k !== 'refunds'; })
        .map(function (k) { return [k, round2(b[k])]; }).sort(function (x, y) { return y[1] - x[1]; });
      m.fees = {
        rows: feeRows, total: feeRows.reduce(function (a, r) { return a + r[1]; }, 0),
        refunds: round2(b.refunds || 0), statementSales: sales2, byMonth: feeMonth,
        ads: round2((b['Etsy Ads'] || 0) + (b['Offsite Ads'] || 0)), labels: round2(b['Shipping labels'] || 0),
      };
    }

    var sales = m.orders ? m.orders.sales : (m.fees ? m.fees.statementSales : 0);
    var fees = m.fees ? m.fees.total : 0, refunds = m.fees ? m.fees.refunds : 0;
    var cogs = sales * cogsPct;
    m.sales = sales; m.cogs = cogs; m.cogsPct = cogsPct * 100;
    m.profit = sales - fees - refunds - cogs;
    m.margin = sales ? m.profit / sales : 0;
    m.total = m.orders ? m.orders.lines : (parts.statement ? parts.statement.records.length : 0);
    return m;
  };

  function sortObj(o) { return Object.keys(o).map(function (k) { return [k, round2(o[k])]; }).sort(function (a, b) { return b[1] - a[1]; }); }
  function round2(n) { return Math.round(n * 100) / 100; }

  function fmt(m, n) {
    var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '−' : '') + m.cur + s;
  }

  template.insights = function (m) {
    var out = [], pct = function (a, b) { return b ? Math.round(a * 1000 / b) / 10 : 0; };
    if (m.orders) out.push(m.orders.orders + ' orders, ' + m.orders.units + ' items sold, ' + fmt(m, m.orders.sales) + ' in item sales (average order ' + fmt(m, m.orders.aov) + ').');
    if (m.fees && m.sales) {
      var top = m.fees.rows[0];
      out.push('Etsy fees and costs took ' + fmt(m, m.fees.total) + ' = ' + pct(m.fees.total, m.sales) + '% of sales' +
        (top ? '; the biggest is ' + top[0].toLowerCase() + ' (' + fmt(m, top[1]) + ').' : '.'));
      if (m.fees.ads) out.push('Ads cost ' + fmt(m, m.fees.ads) + ' (' + pct(m.fees.ads, m.sales) + '% of sales). Check that ad-driven orders cover this.');
      if (m.fees.refunds) out.push('Refunds: ' + fmt(m, m.fees.refunds) + ' (' + pct(m.fees.refunds, m.sales) + '% of sales).');
    }
    if (m.orders && m.orders.byItem.length) {
      var it = m.orders.byItem[0];
      out.push('Best seller: "' + it[0].slice(0, 60) + '" with ' + fmt(m, it[1]) + ' (' + pct(it[1], m.orders.sales) + '% of sales).');
      if (m.orders.byItem.length >= 5) {
        var top3 = m.orders.byItem.slice(0, 3).reduce(function (a, r) { return a + r[1]; }, 0);
        out.push('Your top 3 items bring ' + pct(top3, m.orders.sales) + '% of sales.');
      }
    }
    if (m.orders && m.orders.months.length >= 2) {
      var ms = m.orders.months, last = m.orders.byMonth[ms[ms.length - 1]], prev = m.orders.byMonth[ms[ms.length - 2]];
      if (prev) out.push('Latest month (' + ms[ms.length - 1] + '): ' + fmt(m, last) + ', ' + (last >= prev ? 'up ' : 'down ') + Math.abs(Math.round((last - prev) * 100 / prev)) + '% on the month before.');
    }
    if (m.sales) out.push('True profit after Etsy fees' + (m.cogsPct ? ', refunds and product cost (' + m.cogsPct + '%)' : ' and refunds (enter your product cost % to include it)') +
      ': ' + fmt(m, m.profit) + ' = ' + Math.round(m.margin * 100) + '% of sales.');
    if (!m.fees) out.push('Add your Etsy payments statement CSV to see fees, ads and refunds.');
    if (!m.orders) out.push('Add your Etsy Order Items CSV to see best sellers and monthly sales.');
    return out;
  };

  template.render = function (m) {
    var C = E8.Charts, esc = Eng.esc;
    var kpi = function (label, value, note) {
      return '<div class="kpi"><div class="kv">' + value + '</div><div class="kl">' + esc(label) + '</div>' + (note ? '<div class="kn">' + esc(note) + '</div>' : '') + '</div>';
    };
    var card = function (title, body, wide) { return '<section class="card' + (wide ? ' wide' : '') + '"><h3>' + esc(title) + '</h3>' + body + '</section>'; };
    var html = '<div class="kpis">' +
      kpi('Item sales', fmt(m, m.sales)) +
      kpi('Etsy fees + costs', m.fees ? fmt(m, m.fees.total) : '–', m.fees && m.sales ? Math.round(m.fees.total * 100 / m.sales) + '% of sales' : 'needs statement') +
      kpi('Refunds', m.fees ? fmt(m, m.fees.refunds) : '–') +
      kpi('Product cost', fmt(m, m.cogs), m.cogsPct + '% of sales') +
      kpi('True profit', fmt(m, m.profit), Math.round(m.margin * 100) + '% margin') +
      kpi('Orders', m.orders ? m.orders.orders : '–', m.orders ? 'avg ' + fmt(m, m.orders.aov) : 'needs order items') + '</div>';
    html += card('Key findings', '<ul class="ins">' + template.insights(m).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>', true);
    // Waterfall-style breakdown as bars.
    var flow = [['Item sales', round2(m.sales)]];
    if (m.fees) m.fees.rows.forEach(function (r) { flow.push(['− ' + r[0], r[1]]); });
    if (m.fees && m.fees.refunds) flow.push(['− Refunds', m.fees.refunds]);
    if (m.cogs) flow.push(['− Product cost', round2(m.cogs)]);
    flow.push(['= True profit', round2(m.profit)]);
    html += card('Where the money goes (' + m.cur + ')', C.bars(flow.map(function (r) { return [r[0], Math.max(0, r[1])]; }), { color: '#2f9e6e', max: 20, w: 1060, fmt: function (v) { return fmt(m, v); } }), true);
    html += '<div class="grid">';
    if (m.orders) {
      var months = m.orders.months.slice(-12);
      html += card('Sales by month', C.lines(months, [{ name: 'Item sales', values: months.map(function (k) { return round2(m.orders.byMonth[k]); }), color: '#3b6fd8' }]
        .concat(m.fees ? [{ name: 'Etsy fees + costs', values: months.map(function (k) { return round2(m.fees.byMonth[k] || 0); }), color: '#e0742c' }] : [])));
      html += card('Best-selling items (sales)', C.bars(m.orders.byItem, { color: '#c44a7a', fmt: function (v) { return fmt(m, v); } }));
      if (m.orders.byCountry.length > 1) html += card('Sales by buyer country', C.bars(m.orders.byCountry, { color: '#8a63d2', fmt: function (v) { return fmt(m, v); } }));
    }
    if (m.fees) html += card('Etsy fees and costs by type', C.bars(m.fees.rows, { color: '#e0742c', fmt: function (v) { return fmt(m, v); } }));
    html += '</div>';
    return html;
  };

  return template;
})();
