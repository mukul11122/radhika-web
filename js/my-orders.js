(() => {
  'use strict';
  const $ = (id) => document.getElementById(id),
    esc = (value) =>
      String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
      );
  const displayStoreCode = value => String(value || '').trim().replace(/^(pmbjk|pmjbk|pmbi)/i, '');
  const visibleOrders = new Map();
  let excelReady;
  const initialState = $('history-state').innerHTML,
    loadLabel = $('history-load').innerHTML;
  let page = 1,
    busy = false,
    credentials = null;
  function notice(text, error = false) {
    $('message').textContent = text;
    $('message').hidden = !text;
    $('message').dataset.error = String(error);
  }
  function state(kind, title, detail) {
    const box = $('history-state');
    box.hidden = false;
    box.innerHTML =
      (kind === 'loading'
        ? '<span class="history-spinner" aria-hidden="true"></span>'
        : '<div class="history-section-icon" aria-hidden="true">' +
          (kind === 'error' ? '!' : '⌕') +
          '</div>') +
      '<h3>' +
      esc(title) +
      '</h3><p>' +
      esc(detail) +
      '</p>';
  }
  function resetResults() {
    visibleOrders.clear();
    $('history-orders').replaceChildren();
    $('history-paging').hidden = true;
    $('history-state').hidden = false;
    $('history-state').innerHTML = initialState;
    $('history-result-count').textContent = 'Ready when you are';
    notice('');
  }
  async function post(path, body) {
    const response = await fetch('/api/orders/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw Error(data.message || 'Please try again.');
    return data;
  }
  async function load() {
    if (busy || !credentials) return;
    const used = credentials;
    busy = true;
    $('history-load').disabled = true;
    $('history-load').setAttribute('aria-busy', 'true');
    $('history-load').textContent = 'Finding orders…';
    $('previous').disabled = true;
    $('next').disabled = true;
    $('history-orders').replaceChildren();
    $('history-paging').hidden = true;
    $('history-orders').setAttribute('aria-busy', 'true');
    $('history-result-count').textContent = 'Loading…';
    notice('');
    state('loading', 'Finding your orders', 'Please wait while we load your order history.');
    try {
      const data = await post('history', { ...used, page });
      if (credentials !== used) return;
      visibleOrders.clear();
      data.orders.forEach((order) => visibleOrders.set(order.id, order));
      $('history-orders').innerHTML = data.orders
        .map(
          (order) =>
            '<article class="order-card"><header><div><h3>Store ' +
            esc(order.storeCode || '—') +
            '</h3><small>' +
            esc(new Date(order.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })) +
            ' · ' +
            order.items.length +
            ' medicine' +
            (order.items.length === 1 ? '' : 's') +
            '</small></div><span class="order-badge" data-order-status="' +
            esc(order.status) +
            '">' +
            esc(order.status) +
            '</span></header><p class="order-ref">Reference ' +
            esc(order.id) +
            '</p>' +
            (order.docket
              ? '<p class="history-dispatch">' +
                esc(order.courier) +
                ' · Docket ' +
                esc(order.docket) +
                '</p>'
              : '') +
            '<div class="order-tracking-result" role="status" aria-live="polite" hidden></div><div class="order-items"><table><thead><tr><th>DC</th><th>Medicine</th><th>Qty</th></tr></thead><tbody>' +
            order.items
              .map(
                (item) =>
                  '<tr><td>' +
                  esc(item.code) +
                  '</td><td>' +
                  esc(item.name) +
                  '</td><td>' +
                  esc(item.quantity) +
                  '</td></tr>'
              )
              .join('') +
            '</tbody></table></div><div class="history-order-footer"><button type="button" class="history-excel" data-history-excel="' +
            esc(order.id) +
            '">↓ Download Excel</button><button type="button" class="history-excel" data-order-track="' + esc(order.id) + '">Track Docket</button><button class="history-repeat" type="button" data-repeat="' +
            esc(order.id) +
            '">Repeat order</button><p class="repeat-note">Latest stock and rates apply. Review before submitting.</p></div></article>'
        )
        .join('');
      $('history-orders')
        .querySelectorAll('.order-card')
        .forEach((card) => {
          card.insertBefore(
            card.querySelector('.history-order-footer'),
            card.querySelector('.order-tracking-result')
          );
        });
      $('history-state').hidden = !!data.orders.length;
      if (!data.orders.length)
        state(
          'empty',
          'No orders found',
          'Check your Store Code or try the mobile number used when ordering.'
        );
      $('history-result-count').textContent =
        data.orders.length + ' order' + (data.orders.length === 1 ? '' : 's') + ' shown';
      $('history-paging').hidden = page === 1 && !data.hasMore;
      $('page-status').textContent = 'Page ' + page;
      $('previous').disabled = page <= 1;
      $('next').disabled = !data.hasMore;
      if (window.matchMedia('(max-width: 650px)').matches)
        $('history-results-title').scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
          block: 'start',
        });
    } catch (error) {
      if (credentials !== used) return;
      $('history-orders').replaceChildren();
      state('error', 'We couldn’t load your orders', 'Please try your search again in a moment.');
      $('history-result-count').textContent = 'Please try again';
      notice(error.message, true);
    } finally {
      busy = false;
      $('history-load').disabled = false;
      $('history-load').innerHTML = loadLabel;
      $('history-load').setAttribute('aria-busy', 'false');
      $('history-orders').setAttribute('aria-busy', 'false');
    }
  }
  $('history-form').onsubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    if (!$('history-store').value.trim() && !$('history-mobile').value.trim()) {
      notice('Enter either your Store Code or order mobile number.', true);
      $('history-store').focus();
      return;
    }
    credentials = {
      storeCode: $('history-store').value.trim(),
      mobile: $('history-mobile').value.trim(),
    };
    page = 1;
    load();
  };
  $('history-form').addEventListener('reset', () => {
    credentials = null;
    page = 1;
    resetResults();
  });
  for (const id of ['history-store', 'history-mobile'])
    $(id).oninput = () => {
      credentials = null;
      page = 1;
      resetResults();
    };
  $('previous').onclick = () => {
    if (!busy) {
      page--;
      load();
    }
  };
  $('next').onclick = () => {
    if (!busy) {
      page++;
      load();
    }
  };
  function trackingDate(value) {
    const text = String(value || '').trim(), m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    const time = m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : Date.parse(text);
    return Number.isFinite(time) ? time : -Infinity;
  }
  $('history-orders').addEventListener('click', async (e) => {
    const button = e.target.closest('[data-order-track]');
    if (!button || button.disabled) return;
    const order = visibleOrders.get(button.dataset.orderTrack);
    if (!order) return;
    const result = button.closest('.order-card').querySelector('.order-tracking-result'), epoch = credentials;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    result.hidden = false;
    result.textContent = 'Fetching latest tracking status…';
    try {
      const store = displayStoreCode(order.storeCode).replace(/[^0-9]/g, '');
      if (!store) throw Error('Store code is unavailable.');
      const response = await fetch('/api/docket?store=' + encodeURIComponent(store), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.message || 'Tracking lookup failed. Please try again.');
      if (epoch !== credentials || !button.isConnected) return;
      const dockets = Array.isArray(data.dockets) ? data.dockets : [];
      const matching = order.docket ? dockets.filter(d => [d.docketNo, d.tracking].some(v => String(v || '').trim().toLowerCase() === String(order.docket).trim().toLowerCase())) : dockets;
      const latest = matching.slice().sort((a, b) => trackingDate(b.dispatchDate) - trackingDate(a.dispatchDate))[0];
      if (!latest) result.textContent = order.docket ? 'No tracking update found for this order’s docket yet.' : 'No docket found for this store yet.';
      else result.innerHTML = '<strong>' + esc(latest.status || 'Status') + '</strong><small>' + esc(order.docket ? 'Order docket' : 'Latest store docket') + '</small><span>' + esc([latest.courier, latest.tracking || latest.docketNo, latest.dispatchDate ? 'Dispatched: ' + latest.dispatchDate : ''].filter(Boolean).join(' · ')) + '</span><small>Latest saved tracking status</small>';
    } catch (error) {
      if (epoch === credentials && button.isConnected) result.textContent = error.message || 'Could not fetch tracking. Please try again.';
    } finally {
      if (epoch === credentials && button.isConnected) {
        button.disabled = false;
        button.textContent = 'Refresh Tracking';
        button.setAttribute('aria-busy', 'false');
      }
    }
  });
  $('history-orders').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-history-excel]');
    if (!button || button.disabled) return;
    const order = visibleOrders.get(button.dataset.historyExcel);
    if (!order) return;
    button.disabled = true;
    button.textContent = 'Preparing Excel…';
    try {
      if (!window.ExcelJS) {
        if (!excelReady)
          excelReady = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'js/vendor/exceljs.min.js';
            script.onload = resolve;
            script.onerror = () => {
              excelReady = null;
              script.remove();
              reject(Error('Excel could not be loaded. Please retry.'));
            };
            document.head.append(script);
          });
        await excelReady;
      }
      const book = new window.ExcelJS.Workbook(),
        sheet = book.addWorksheet('Order');
      sheet.columns = [{ width: 18 }, { width: 85 }, { width: 18 }];
      sheet.addRow(['Radhika Agencies — Order']);
      sheet.addRow(['Store Code', order.storeCode]);
      sheet.addRow(['Order reference', order.id]);
      sheet.addRow([
        'Date',
        new Date(order.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      ]);
      sheet.addRow(['Status', order.status]);
      sheet.addRow([]);
      sheet.addRow(['DC', 'Medicine', 'Order QTY']);
      order.items.forEach((item) =>
        sheet.addRow([String(item.code), String(item.name || ''), Number(item.quantity)])
      );
      sheet.eachRow((row) => {
        row.font = { name: 'Calibri', size: 12 };
        row.alignment = { vertical: 'middle', wrapText: true };
        row.height = 34;
      });
      sheet.getRow(1).font = { name: 'Calibri', size: 16, bold: true };
      sheet.getRow(7).font = { name: 'Calibri', size: 12, bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 7 }];
      const blob = new Blob([await book.xlsx.writeBuffer()], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download =
        'Order-' + String(order.storeCode).replace(/[^a-z0-9-]/gi, '') + '-' + order.id + '.xlsx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notice(e.message, true);
    } finally {
      button.disabled = false;
      button.textContent = '↓ Download Excel';
    }
  });
  $('history-orders').onclick = async (event) => {
    const button = event.target.closest('[data-repeat]');
    if (!button || busy || !credentials) return;
    const used = credentials;
    busy = true;
    button.disabled = true;
    button.textContent = 'Preparing…';
    $('history-load').disabled = true;
    notice('');
    try {
      const data = await post('repeat', { ...used, id: button.dataset.repeat });
      if (credentials !== used) return;
      sessionStorage.setItem(
        'radhika-repeat-order',
        JSON.stringify({
          storeCode: data.storeCode,
          mobile: data.mobile,
          items: data.items,
          created: Date.now(),
        })
      );
      location.assign('stock.html?repeat=1');
    } catch (error) {
      if (credentials === used) notice(error.message, true);
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = 'Repeat order';
      $('history-load').disabled = false;
    }
  };
  let historyDetailsTouched = false;
  ['history-store', 'history-mobile'].forEach((id) =>
    $(id).addEventListener('input', () => {
      historyDetailsTouched = true;
    })
  );
  window.KendraProfile?.refresh()
    .then((profile) => {
      if (
        profile &&
        !historyDetailsTouched &&
        !$('history-store').value &&
        !$('history-mobile').value
      ) {
        $('history-store').value = profile.storeCode || '';
      }
    })
    .catch(() => {});
})();
