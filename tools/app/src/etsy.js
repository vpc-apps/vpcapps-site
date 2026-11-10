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
      // Etsy writes order dates month first (10/05/2026); read day first only when a value proves it.
      var dayFirst = dates.some(function (d) { var x = /^(\d{1,2})[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.exec(String(d || '').trim()); return x && +x[1] > 12; });
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
      var byItem = {}, byMonth = {}, orders = {}, byCountry = {}, ordersMonth = {}, unitsMonth = {};
      lines.forEach(function (l) {
        byItem[l.item] = (byItem[l.item] || 0) + l.total;
        var mk = Eng.monthKey(l.date); byMonth[mk] = (byMonth[mk] || 0) + l.total;
        (ordersMonth[mk] = ordersMonth[mk] || {})[l.order] = 1;
        unitsMonth[mk] = (unitsMonth[mk] || 0) + l.qty;
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
        months: Object.keys(byMonth).sort(), byMonth: byMonth, unitsMonth: unitsMonth,
        ordersMonth: Object.keys(ordersMonth).reduce(function (o, k) { o[k] = Object.keys(ordersMonth[k]).length; return o; }, {}),
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

    // Months for the month chart and table: every month with sales or with fees (a month with only ads or
    // listing fees still costs money, and the table's total must match the fee cards).
    if (m.orders) {
      var mset = {};
      m.orders.months.concat(m.fees ? Object.keys(m.fees.byMonth) : []).forEach(function (k) { mset[k] = 1; });
      m.months = Object.keys(mset).sort();
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
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function round2(n) { return Math.round(n * 100) / 100; }

  function fmt(m, n) {
    var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '−' : '') + m.cur + s;
  }

  template.insights = function (m) {
    var out = [], pct = function (a, b) { return b ? Math.round(a * 1000 / b) / 10 : 0; };
    if (m.orders) out.push(plural(m.orders.orders, 'order') + ', ' + plural(m.orders.units, 'item') + ' sold, ' + fmt(m, m.orders.sales) + ' in item sales (average order ' + fmt(m, m.orders.aov) + ').');
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
    var C = E8.Charts, esc = Eng.esc, card = C.card, money = function (v) { return fmt(m, v); };
    var pctOf = function (a) { return m.sales ? Math.round(a * 1000 / m.sales) / 10 : 0; };
    var feePct = m.fees ? pctOf(m.fees.total) : 0, refPct = m.fees ? pctOf(m.fees.refunds) : 0, margin = Math.round(m.margin * 100);
    var html = '<div class="kpis">' +
      C.tile('Item sales', money(m.sales), m.orders ? plural(m.orders.units, 'item') + ' sold' : 'from the payments statement') +
      C.tile('Orders', m.orders ? String(m.orders.orders) : '–', m.orders ? 'average order ' + esc(money(m.orders.aov)) : 'add the Order Items CSV') +
      C.tile('Etsy fees and costs', m.fees ? money(m.fees.total) : '–', m.fees ? feePct + '% of sales' : 'add the payments statement',
        !m.fees ? '' : feePct > 30 ? 'bad' : feePct > 20 ? 'warn' : 'good') +
      C.tile('Refunds', m.fees ? money(m.fees.refunds) : '–', m.fees ? refPct + '% of sales' : 'add the payments statement',
        !m.fees ? '' : refPct >= 8 ? 'bad' : refPct >= 3 ? 'warn' : 'good') +
      C.tile('Product cost', money(m.cogs), m.cogsPct ? m.cogsPct + '% of sales' : 'not entered (0%)') +
      C.tile('True profit', money(m.profit), margin + '% margin', !m.sales ? '' : margin < 10 ? 'bad' : margin < 30 ? 'warn' : 'good') + '</div>';
    html += card('Key findings', 'The main points in plain words, most important first.', C.findings(template.insights(m)), 'wide');

    var flow = [['Item sales', round2(m.sales)]], colors = ['#3b6fd8'];
    if (m.fees) m.fees.rows.forEach(function (r) { flow.push(['− ' + r[0], r[1]]); colors.push('#e0742c'); });
    if (m.fees && m.fees.refunds) { flow.push(['− Refunds', m.fees.refunds]); colors.push('#c44a7a'); }
    if (m.cogs) { flow.push(['− Product cost', round2(m.cogs)]); colors.push('#8a63d2'); }
    flow.push(['= True profit', round2(m.profit)]); colors.push(m.profit < 0 ? '#b3261e' : '#2f9e6e');
    html += card('Where the money goes', 'Start from item sales (blue), take away each Etsy fee, refund and product cost; the last bar is what you keep.' +
      (m.fees ? '' : ' Add your payments statement to see the fees.'), C.bars(flow, { colors: colors, max: 20, keepZero: true, fmt: money }), 'wide');

    html += '<div class="grid">';
    if (m.orders) {
      var months = m.months.slice(-12);
      html += card('Sales by month', 'Item sales per month' + (m.fees ? ' (blue) against Etsy fees, costs and refunds (orange). A widening gap means more profit.' : '.'),
        C.lines(months, [{ name: 'Item sales', values: months.map(function (k) { return round2(m.orders.byMonth[k] || 0); }), color: '#3b6fd8' }]
          .concat(m.fees ? [{ name: 'Fees, costs and refunds', values: months.map(function (k) { return round2(m.fees.byMonth[k] || 0); }), color: '#e0742c' }] : [])));
      html += card('Best-selling items', 'Item sales per product, biggest first. The grey bar adds up the rest.', C.bars(m.orders.byItem, { color: '#c44a7a', max: 8, more: 'other items', fmt: money }));
      if (m.orders.byCountry.length > 1) html += card('Sales by buyer country', 'Where your buyers live, by item sales.', C.bars(m.orders.byCountry, { color: '#8a63d2', max: 8, more: 'other countries', fmt: money }));
    }
    if (m.fees) html += card('Etsy fees and costs by type', 'What Etsy charged, by kind of fee. Ads and transaction fees are usually the biggest.', C.bars(m.fees.rows, { color: '#e0742c', max: 8, more: 'other fees', fmt: money }));
    html += '</div>';
    html += card('Month by month', 'Exact numbers per month to copy into your accounts.' + (m.fees ? ' "Left after fees" is sales minus fees, costs and refunds, before product cost.' : ''), monthTable(m), 'wide');
    return html;
  };

  /** Exact counts per month, with a total row. */
  function monthTable(m) {
    var C = E8.Charts, money = function (v) { return fmt(m, v); }, fm = m.fees ? m.fees.byMonth : {};
    if (!m.orders) {
      var ks = Object.keys(fm).sort();
      return C.table([{ t: 'Month' }, { t: 'Fees, costs and refunds', num: true }], ks.map(function (k) { return [C.axisLabel(k), money(fm[k])]; }),
        { foot: [['Total', money(ks.reduce(function (a, k) { return a + fm[k]; }, 0))]], minW: 300 });
    }
    var o = m.orders, cols = [{ t: 'Month' }, { t: 'Orders', num: true }, { t: 'Items sold', num: true }, { t: 'Item sales', num: true }];
    if (m.fees) cols = cols.concat([{ t: 'Fees, costs and refunds', num: true }, { t: 'Left after fees', num: true }]);
    var row = function (label, orders, units, sales, fees) {
      return [label, String(orders), String(units), money(sales)].concat(m.fees ? [money(fees), money(sales - fees)] : []);
    };
    var tot = { o: 0, u: 0, s: 0, f: 0 };
    var rows = m.months.map(function (k) {
      var f = fm[k] || 0, s = o.byMonth[k] || 0;
      tot.o += o.ordersMonth[k] || 0; tot.u += o.unitsMonth[k] || 0; tot.s += s; tot.f += f;
      return row(C.axisLabel(k), o.ordersMonth[k] || 0, o.unitsMonth[k] || 0, s, f);
    });
    return C.table(cols, rows, { foot: [row('Total', o.orders, tot.u, tot.s, tot.f)], minW: m.fees ? 620 : 420 });
  }

  return template;
})();
