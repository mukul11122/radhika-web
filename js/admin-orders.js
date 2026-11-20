(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sessionKey = 'radhika-admin-session';
  const displayStoreCode = (value) =>
    String(value || '')
      .trim()
      .replace(/^(pmbjk|pmjbk|pmbi)/i, '');
  let authEpoch = 0;
  function validSession(value) {
    try {
      const data = JSON.parse(atob(value.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
      return data.scope === 'stock-upload-login' && data.exp > Date.now();
    } catch {
      return false;
    }
  }
  let token = '',
    page = 1,
    busy = false;
  const adminProfiles = new Map();
  const selectedOrders = new Set();
  const visibleOrders = new Map(),
    exportingOrders = new Set();
  let bulkUpdating = false;
  let dashboardData = null,
    dashboardExporting = false;
  let lowExporting = false,
    alertSettings = null;
  const states = [
    'New',
    'Accepted',
    'Challan Ready',
    'Packed',
    'Dispatched',
    'Delivered',
    'Cancelled',
  ];
  const esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  function message(text, error = false) {
    $('message').textContent = text;
    $('message').dataset.error = error;
  }
  function lock() {
    authEpoch++;
    token = '';
    try {
      localStorage.removeItem(sessionKey);
    } catch {}
    alertSettings = null;
    selectedOrders.clear();
    adminProfiles.clear();
    $('admin-profile-dialog').close();
    $('admin-profile-edit').reset();
    $('profile-editor-message').textContent = '';
    $('admin-profile-message').textContent = '';
    visibleOrders.clear();
    $('docket-record-rows').replaceChildren();
    $('docket-record-message').textContent = '';
    $('docket-record-date').innerHTML = '<option value="">All dates</option>';
    dashboardData = null;
    $('dashboard-excel').disabled = true;
    $('bulk-results').hidden = true;
    syncSelection();
    selectAdminView('dashboard');
    $('login-card').hidden = false;
    $('panel').hidden = true;
    $('logout').hidden = true;
    page = 1;
    $('orders').replaceChildren();
    $('manage-stock-results').replaceChildren();
    managedStock = null;
    managedSelection.clear();
    $('operations-content').replaceChildren();
    $('admin-demands').replaceChildren();
    $('admin-profiles').replaceChildren();
    $('operations-message').textContent = '';
    $('dashboard-summary').replaceChildren();
    $('dashboard-order-counts').replaceChildren();
    $('top-medicines').replaceChildren();
    $('stock-alerts').replaceChildren();
    $('medicine-search').value = '';
    $('medicine-search').disabled = true;
    $('medicine-previous').disabled = true;
    $('medicine-next').disabled = true;
    $('medicine-page').textContent = '';
    $('message').textContent = '';
    $('insights-message').textContent = '';
    $('login-form').reset();
  }
  window.addEventListener('pageshow', () => {
    if (token && !validSession(token)) lock();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === sessionKey && !event.newValue) lock();
  });
  $('logout').onclick = lock;
  async function request(url, options = {}) {
    const epoch = authEpoch;
    const r = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const out = await r.json();
    if (epoch !== authEpoch) throw Error('Panel locked. Please sign in again.');
    if (r.status === 401) lock();
    if (!r.ok || !out.ok) throw Error(out.message || 'Request failed.');
    return out;
  }
  $('login-form').onsubmit = async (e) => {
    e.preventDefault();
    $('login-button').disabled = true;
    try {
      const fields = new FormData(e.target);
      const out = await request('/api/stock/login', {
        method: 'POST',
        body: JSON.stringify({
          username: fields.get('username'),
          password: fields.get('password'),
        }),
      });
      token = out.token;
      try {
        localStorage.setItem(sessionKey, token);
      } catch {}
      $('login-card').hidden = true;
      $('panel').hidden = false;
      $('logout').hidden = false;
      e.target.reset();
      await Promise.all([load(), loadInsights()]);
    } catch (e) {
      message(e.message, true);
    } finally {
      $('login-button').disabled = false;
    }
  };
  function card(o) {
    const transitions = {
      New: 'Accepted',
      Accepted: 'Challan Ready',
      'Challan Ready': 'Packed',
      Packed: 'Dispatched',
      Dispatched: 'Delivered',
    };
    const next = transitions[o.status];
    const cancellation = ['New', 'Accepted', 'Challan Ready', 'Packed'].includes(o.status);
    return `<article class="order-card" data-id="${esc(o.id)}"><label class="bulk-order-select"><input type="checkbox" data-select-order="${esc(o.id)}" aria-label="Select order ${esc(o.id)}"> Select order</label><header><div><h2>Store ${esc(displayStoreCode(o.storeCode))}</h2><small>${esc(new Date(o.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}</small></div><span class="order-badge">${esc(o.status)}</span></header><p>Mobile: ${esc(o.mobile)}</p><p class="order-ref">Reference: ${esc(o.id)}</p><small>Email delivery: ${o.sent.length}/3 recipients</small><div class="order-download"><button type="button" class="order-track-link" data-order-track="${esc(o.id)}">Track Docket</button><button type="button" data-order-excel="${esc(o.id)}">↓ Download Excel</button>${o.unavailableItems?.length ? `<button type="button" data-order-unavailable="${esc(o.id)}">↓ Download Not Available (${o.unavailableItems.length})</button>` : ''}</div><div class="order-tracking-result" role="status" aria-live="polite" hidden></div><div class="order-items"><table><thead><tr><th>DC</th><th>Order quantity</th></tr></thead><tbody>${o.items.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.quantity)}</td></tr>`).join('')}</tbody></table></div><details class="order-history"><summary data-order-history="${esc(o.id)}">View order history</summary><div data-order-history-content="${esc(o.id)}"></div></details>${o.contactProfile ? `<p class="order-delivery">Delivery: ${esc([o.contactProfile.contactName, o.contactProfile.address, o.contactProfile.city, o.contactProfile.state, o.contactProfile.pincode, o.contactProfile.dlForm20 ? 'DL Form 20: ' + o.contactProfile.dlForm20 : '', o.contactProfile.dlForm21 ? 'DL Form 21: ' + o.contactProfile.dlForm21 : '', o.contactProfile.gst ? 'GSTIN: ' + o.contactProfile.gst : ''].filter(Boolean).join(' · '))}</p>` : ''}${o.docket || o.courier ? `<p>Dispatch: ${esc([o.courier, o.docket].filter(Boolean).join(' · '))}</p>` : ''}${o.note ? `<p class="order-note">${esc(o.note)}</p>` : ''}${next || cancellation ? `<div class="order-action-fields">${o.status === 'Packed' ? '<label>Courier (optional)<input data-courier maxlength="100"></label><label>Docket number (optional)<input data-docket maxlength="100"></label>' : ''}<label>Note / cancellation reason<textarea data-note rows="2" maxlength="1000" placeholder="Required when cancelling"></textarea></label></div><div class="order-actions">${next ? `<button class="orders-primary" data-status="${next}">Mark ${next}</button>` : ''}${cancellation ? '<button class="cancel-order" data-status="Cancelled">Cancel & return stock</button>' : ''}</div>` : ''}</article>`;
    return `<article class="order-card" data-id="${esc(o.id)}"><label class="bulk-order-select"><input type="checkbox" data-select-order="${esc(o.id)}" aria-label="Select order ${esc(o.id)}"> Select order</label><header><div><h2>Store ${esc(displayStoreCode(o.storeCode))}</h2><small>${esc(new Date(o.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}</small></div><span class="order-badge">${esc(o.status)}</span></header><p>Mobile: ${esc(o.mobile)}</p><p class="order-ref">Reference: ${esc(o.id)}</p><small>Email delivery: ${o.sent.length}/3 recipients</small><div class="order-download"><button type="button" class="order-track-link" data-order-track="${esc(o.id)}">Track Docket</button><button type="button" data-order-excel="${esc(o.id)}">↓ Download Excel</button>${o.unavailableItems?.length ? `<button type="button" data-order-unavailable="${esc(o.id)}">↓ Download Not Available (${o.unavailableItems.length})</button>` : ''}</div><div class="order-tracking-result" role="status" aria-live="polite" hidden></div><div class="order-items"><table><thead><tr><th>DC</th><th>Order quantity</th></tr></thead><tbody>${o.items.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.quantity)}</td></tr>`).join('')}</tbody></table></div><details class="order-history"><summary data-order-history="${esc(o.id)}">View order history</summary><div data-order-history-content="${esc(o.id)}"></div></details>${o.contactProfile ? `<p class="order-delivery">Delivery: ${esc([o.contactProfile.contactName, o.contactProfile.address, o.contactProfile.city, o.contactProfile.state, o.contactProfile.pincode, o.contactProfile.dlForm20 ? 'DL Form 20: ' + o.contactProfile.dlForm20 : '', o.contactProfile.dlForm21 ? 'DL Form 21: ' + o.contactProfile.dlForm21 : '', o.contactProfile.gst ? 'GSTIN: ' + o.contactProfile.gst : ''].filter(Boolean).join(' · '))}</p>` : ''}${o.docket ? `<p>Dispatch: ${esc(o.courier)} · ${esc(o.docket)}</p>` : ''}${o.note ? `<p class="order-note">${esc(o.note)}</p>` : ''}${next || cancellation ? `<div class="order-action-fields">${o.status === 'Packed' ? '<label>Courier (optional)<input data-courier maxlength="100"></label><label>Docket number (optional)<input data-docket maxlength="100"></label>' : ''}<label>Note / cancellation reason<textarea data-note rows="2" maxlength="1000" placeholder="Required when cancelling"></textarea></label></div><div class="order-actions">${next ? `<button class="orders-primary" data-status="${next}">Mark ${next}</button>` : ''}${cancellation ? '<button class="cancel-order" data-status="Cancelled">Cancel & return stock</button>' : ''}</div>` : ''}</article>`;
  }
  async function load() {
    if (!token || busy) return;
    busy = true;
    $('refresh').disabled = true;
    message('Loading orders…');
    try {
      const out = await request(
        '/api/admin/orders?page=' +
          page +
          '&status=' +
          encodeURIComponent($('status-filter').value) +
          '&q=' +
          encodeURIComponent($('search').value.trim())
      );
      $('stats').innerHTML = states
        .map(
          (status) =>
            `<button type="button" class="orders-stat" data-order-filter="${status}" aria-pressed="${$('status-filter').value === status}"><span>${status}</span><strong>${out.stats.find((r) => r.status === status)?.count || 0}</strong></button>`
        )
        .join('');
      visibleOrders.clear();
      out.orders.forEach((order) => visibleOrders.set(order.id, order));
      $('orders').innerHTML =
        out.orders.map(card).join('') || '<p>No orders match these filters.</p>';
      const visibleIds = new Set(out.orders.map((order) => order.id));
      for (const id of selectedOrders) if (!visibleIds.has(id)) selectedOrders.delete(id);
      document
        .querySelectorAll('[data-select-order]')
        .forEach((input) => (input.checked = selectedOrders.has(input.dataset.selectOrder)));
      syncSelection();
      const pages = Math.max(1, Math.ceil(out.total / 30));
      $('page-status').textContent = `Page ${page} of ${pages} · ${out.total} orders`;
      $('previous').disabled = page <= 1;
      $('next').disabled = page >= pages;
      message('');
    } catch (e) {
      message(e.message, true);
    } finally {
      busy = false;
      $('refresh').disabled = false;
    }
  }
  $('refresh').onclick = async () => {
    await Promise.all([load(), loadInsights()]);
  };
  $('stats').addEventListener('click', (event) => {
    const button = event.target.closest('[data-order-filter]');
    if (!button || busy || bulkUpdating) return;
    const status = button.dataset.orderFilter;
    $('status-filter').value = $('status-filter').value === status ? '' : status;
    page = 1;
    selectedOrders.clear();
    syncSelection();
    load();
  });
  $('status-filter').onchange = () => {
    page = 1;
    load();
  };
  let timer;
  $('search').oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      page = 1;
      load();
    }, 350);
  };
  $('previous').onclick = () => {
    page--;
    load();
  };
  $('next').onclick = () => {
    page++;
    load();
  };
  $('orders').onclick = async (e) => {
    const button = e.target.closest('[data-status]');
    if (!button || busy || bulkUpdating) return;
    const card = button.closest('[data-id]'),
      status = button.dataset.status,
      note = card.querySelector('[data-note]')?.value.trim() || '';
    if (
      status === 'Cancelled' &&
      (!note || !confirm('Cancel this order and return its reserved stock?'))
    ) {
      if (!note) message('Enter a cancellation reason.', true);
      return;
    }
    busy = true;
    card.querySelectorAll('button').forEach((b) => (b.disabled = true));
    button.textContent = 'Updating…';
    try {
      const out = await request(
        '/api/admin/orders/' + encodeURIComponent(card.dataset.id) + '/status',
        {
          method: 'POST',
          body: JSON.stringify({
            status,
            note,
            docket: card.querySelector('[data-docket]')?.value || '',
            courier: card.querySelector('[data-courier]')?.value || '',
          }),
        }
      );
      busy = false;
      await Promise.all([load(), loadInsights()]);
      message(out.message);
    } catch (e) {
      message(e.message, true);
      busy = false;
      await load();
      message(e.message, true);
    }
  };
  function syncSelection() {
    const boxes = [...document.querySelectorAll('[data-select-order]')];
    $('bulk-count').textContent = selectedOrders.size + ' selected';
    $('bulk-update').disabled = busy || bulkUpdating || !selectedOrders.size;
    $('bulk-clear').disabled = busy || !selectedOrders.size;
    $('bulk-select-all').checked =
      boxes.length > 0 && boxes.every((input) => selectedOrders.has(input.dataset.selectOrder));
    $('bulk-select-all').indeterminate = selectedOrders.size > 0 && !$('bulk-select-all').checked;
  }
  $('orders').addEventListener('change', (e) => {
    const input = e.target.closest('[data-select-order]');
    if (!input || busy) return;
    input.checked
      ? selectedOrders.add(input.dataset.selectOrder)
      : selectedOrders.delete(input.dataset.selectOrder);
    syncSelection();
  });
  $('bulk-select-all').onchange = () => {
    if (busy) return;
    document.querySelectorAll('[data-select-order]').forEach((input) => {
      input.checked = $('bulk-select-all').checked;
      input.checked
        ? selectedOrders.add(input.dataset.selectOrder)
        : selectedOrders.delete(input.dataset.selectOrder);
    });
    syncSelection();
  };
  $('bulk-clear').onclick = () => {
    if (busy) return;
    selectedOrders.clear();
    document.querySelectorAll('[data-select-order]').forEach((input) => (input.checked = false));
    syncSelection();
  };
  $('bulk-update').onclick = async () => {
    if (busy || bulkUpdating || !selectedOrders.size) return;
    const status = $('bulk-status').value,
      note = $('bulk-note').value.trim();
    const entries = [...document.querySelectorAll('.order-card[data-id]')]
      .filter((card) => selectedOrders.has(card.dataset.id))
      .map((card) => ({
        id: card.dataset.id,
        label: card.querySelector('h2').textContent,
        status,
        note: note || card.querySelector('[data-note]')?.value.trim() || '',
        docket: card.querySelector('[data-docket]')?.value.trim() || '',
        courier: card.querySelector('[data-courier]')?.value.trim() || '',
      }));
    if (status === 'Cancelled' && entries.some((entry) => !entry.note)) {
      message('Enter a common cancellation reason or a reason for every selected order.', true);
      return;
    }
    if (
      !confirm(
        'Update ' +
          entries.length +
          ' selected orders to ' +
          status +
          '?' +
          (status === 'Cancelled' ? ' Reserved stock will be returned where eligible.' : '')
      )
    )
      return;
    busy = true;
    bulkUpdating = true;
    let controlsRestored = false;
    const controls = [...$('panel').querySelectorAll('button,input,select,textarea')].map(
      (element) => ({ element, disabled: element.disabled })
    );
    controls.forEach(({ element }) => (element.disabled = true));
    $('bulk-update').setAttribute('aria-busy', 'true');
    $('bulk-results').hidden = false;
    $('bulk-results').textContent = 'Updating selected orders…';
    try {
      const results = await OrderBulk.update(
        entries,
        (entry) =>
          request('/api/admin/orders/' + encodeURIComponent(entry.id) + '/status', {
            method: 'POST',
            body: JSON.stringify({
              status: entry.status,
              note: entry.note,
              docket: entry.docket,
              courier: entry.courier,
            }),
          }),
        (done, total) => {
          $('bulk-update').textContent = 'Updating ' + done + ' / ' + total + '…';
          $('bulk-results').textContent = 'Updating orders: ' + done + ' of ' + total;
        }
      );
      selectedOrders.clear();
      results.filter((result) => !result.ok).forEach((result) => selectedOrders.add(result.id));
      const success = results.filter((result) => result.ok).length;
      $('bulk-results').innerHTML =
        '<strong>' +
        success +
        ' updated · ' +
        (results.length - success) +
        ' failed</strong><ul>' +
        results
          .map(
            (result) =>
              '<li class="' +
              (result.ok ? 'bulk-ok' : 'bulk-error') +
              '">' +
              esc(result.label) +
              ' · ' +
              esc(result.id.slice(0, 8)) +
              ': ' +
              esc(result.message) +
              '</li>'
          )
          .join('') +
        '</ul>';
      controls.forEach(({ element, disabled }) => (element.disabled = disabled));
      controlsRestored = true;
      busy = false;
      await Promise.all([load(), loadInsights()]);
      message('Bulk update complete. Failed orders remain selected for review.');
    } catch (e) {
      message(e.message, true);
      $('bulk-results').textContent =
        'Bulk update interrupted. Refresh orders to check current statuses before retrying.';
    } finally {
      busy = false;
      bulkUpdating = false;
      if (!controlsRestored)
        controls.forEach(({ element, disabled }) => (element.disabled = disabled));
      $('bulk-update').textContent = 'Update Selected';
      $('bulk-update').setAttribute('aria-busy', 'false');
      syncSelection();
    }
  };
  let alertPages = { lowStock: 1, expiring: 1, expired: 1 },
    alertsBusy = false,
    insightsBusy = false;
  const money = (value) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
  function simpleTable(headers, rows, sorting = null) {
    return (
      '<div class="insight-table"><table><thead><tr>' +
      headers
        .map((h, index) => {
          const key = sorting?.keys[index],
            active = key === sorting?.key;
          return (
            '<th' +
            (sorting
              ? ' aria-sort="' +
                (active ? (sorting.direction === 1 ? 'ascending' : 'descending') : 'none') +
                '"'
              : '') +
            '>' +
            (sorting
              ? '<button type="button" class="medicine-sort" ' +
                (sorting.section
                  ? 'data-alert-section="' + sorting.section + '" data-alert-sort="'
                  : 'data-medicine-sort="') +
                key +
                '">' +
                esc(h) +
                '<span aria-hidden="true">' +
                (active ? (sorting.direction === 1 ? '↑' : '↓') : '↕') +
                '</span></button>'
              : esc(h)) +
            '</th>'
          );
        })
        .join('') +
      '</tr></thead><tbody>' +
      rows
        .map((row) => '<tr>' + row.map((v) => '<td>' + esc(v) + '</td>').join('') + '</tr>')
        .join('') +
      '</tbody></table></div>'
    );
  }
  let medicineSort = 'quantity',
    medicineDirection = -1;
  let medicinePage = 1,
    medicineLoading = false,
    medicineError = '';
  function renderMedicines() {
    $('top-medicines').setAttribute('aria-busy', String(medicineLoading));
    $('medicine-search').disabled = medicineLoading || !dashboardData;
    if (medicineLoading || medicineError || !dashboardData) {
      $('medicine-previous').disabled = true;
      $('medicine-next').disabled = true;
      $('medicine-page').textContent = '';
      $('top-medicines').innerHTML =
        '<div class="medicine-state" role="status">' +
        (medicineLoading
          ? '<span class="medicine-spinner" aria-hidden="true"></span><strong>Loading medicines…</strong><p>Please wait while the medicine list is loaded.</p>'
          : medicineError
            ? '<strong>Medicines could not be loaded.</strong><p>Please try again.</p><button type="button" data-medicine-retry>Try again</button>'
            : '<strong>No medicine data loaded yet.</strong>') +
        '</div>';
      return;
    }
    const query = $('medicine-search').value.trim().toLowerCase();
    const rows = (dashboardData?.topMedicines || []).filter(
      (row) =>
        String(row.code).toLowerCase().includes(query) ||
        String(row.name).toLowerCase().includes(query)
    );
    rows.sort((a, b) => {
      const result = ['quantity', 'orders'].includes(medicineSort)
        ? Number(a[medicineSort]) - Number(b[medicineSort])
        : String(a[medicineSort]).localeCompare(String(b[medicineSort]), undefined, {
            numeric: medicineSort === 'code',
            sensitivity: 'base',
          });
      return (
        result * medicineDirection ||
        String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
      );
    });
    const pages = Math.max(1, Math.ceil(rows.length / 10));
    medicinePage = Math.max(1, Math.min(medicinePage, pages));
    $('top-medicines').innerHTML =
      (rows.length
        ? simpleTable(
            ['DC', 'Medicine', 'Ordered QTY', 'Orders'],
            rows
              .slice((medicinePage - 1) * 10, medicinePage * 10)
              .map((row) => [row.code, row.name, row.quantity, row.orders]),
            {
              keys: ['code', 'name', 'quantity', 'orders'],
              key: medicineSort,
              direction: medicineDirection,
            }
          )
        : '<div class="medicine-state" role="status"><strong>' +
          (query ? 'No matching medicines found.' : 'No ordered medicines yet.') +
          '</strong><p>' +
          (query
            ? 'Try another DC or medicine name, or clear the search.'
            : 'Medicines will appear here once orders are available.') +
          '</p></div>') +
      '<p class="repeat-note">Estimated value uses saved Sales Rates; older orders use current rates. ' +
      (dashboardData?.unpricedOrders || 0) +
      ' order(s) without rates excluded.</p>';
    $('medicine-page').textContent =
      'Page ' + medicinePage + ' of ' + pages + ' · ' + rows.length + ' medicines';
    $('medicine-previous').disabled = medicinePage <= 1;
    $('medicine-next').disabled = medicinePage >= pages;
  }
  $('medicine-search').addEventListener('input', () => {
    medicinePage = 1;
    renderMedicines();
  });
  $('medicine-previous').onclick = () => {
    medicinePage--;
    renderMedicines();
  };
  $('medicine-next').onclick = () => {
    medicinePage++;
    renderMedicines();
  };
  $('top-medicines').addEventListener('click', (event) => {
    if (event.target.closest('[data-medicine-retry]')) loadInsights();
    const button = event.target.closest('[data-medicine-sort]');
    if (!button || medicineLoading || !dashboardData) return;
    const key = button.dataset.medicineSort;
    if (medicineSort === key) medicineDirection *= -1;
    else {
      medicineSort = key;
      medicineDirection = ['quantity', 'orders'].includes(key) ? -1 : 1;
    }
    medicinePage = 1;
    renderMedicines();
  });
  async function loadInsights() {
    if (!token || insightsBusy) return;
    insightsBusy = true;
    const alertsTask = loadAlerts();
    medicineLoading = true;
    medicineError = '';
    $('dashboard-excel').disabled = true;
    renderMedicines();
    $('insights-message').textContent = 'Loading dashboard…';
    try {
      const data = await request('/api/admin/dashboard');
      dashboardData = data;
      medicineLoading = false;
      $('dashboard-excel').disabled = dashboardExporting;
      $('dashboard-summary').innerHTML = [
        ['Today’s orders', data.todayOrders],
        ['Pending dispatch', data.pendingDispatch],
        ['Estimated value · Today', money(data.estimatedValues.today)],
        ['Estimated value · This week (Mon–Sun)', money(data.estimatedValues.weekly)],
        ['Estimated value · This month', money(data.estimatedValues.monthly)],
        ['Estimated value · This year', money(data.estimatedValues.yearly)],
      ]
        .map(
          ([label, value]) =>
            '<div class="orders-stat"><span>' +
            esc(label) +
            '</span><strong>' +
            esc(value) +
            '</strong></div>'
        )
        .join('');
      $('dashboard-order-counts').innerHTML = simpleTable(
        ['Period', 'Total orders', ...states],
        [
          ['today', 'Today'],
          ['weekly', 'This week'],
          ['monthly', 'This month'],
          ['yearly', 'This year'],
        ].map(([key, label]) => [
          label,
          data.orderCounts[key].total,
          ...states.map((status) => data.orderCounts[key][status]),
        ])
      );
      medicinePage = 1;
      renderMedicines();
      await alertsTask;
    } catch (e) {
      medicineLoading = false;
      medicineError = e.message || 'Loading failed.';
      renderMedicines();
      $('insights-message').textContent = e.message;
    } finally {
      insightsBusy = false;
    }
  }
  const alertSorts = {
    lowStock: { key: 'quantity', direction: 1 },
    expiring: { key: 'expiry', direction: 1 },
    expired: { key: 'expiry', direction: 1 },
  };
  const alertSearches = { lowStock: '', expiring: '', expired: '' };
  function alertState(loading) {
    return ['Low stock', 'Short expiry', 'Expired stock']
      .map(
        (title) =>
          '<article><h3>' +
          title +
          '</h3><div class="medicine-state" role="status">' +
          (loading
            ? '<span class="medicine-spinner" aria-hidden="true"></span><strong>Loading medicines…</strong><p>Please wait while stock records are loaded.</p>'
            : '<strong>Stock records could not be loaded.</strong><p>Please try again.</p><button type="button" data-alert-retry>Try again</button>') +
          '</div></article>'
      )
      .join('');
  }
  async function loadAlerts() {
    if (!token || alertsBusy) return;
    alertsBusy = true;
    $('alert-apply').disabled = true;
    try {
      const days = $('alert-days'),
        low = $('alert-low');
      if (!days.reportValidity() || !low.reportValidity()) return;
      $('stock-alerts').setAttribute('aria-busy', 'true');
      $('stock-alerts').innerHTML = alertState(true);
      const data = await request(
        '/api/admin/stock-alerts?days=' +
          encodeURIComponent(days.value) +
          '&low=' +
          encodeURIComponent(low.value) +
          '&' +
          new URLSearchParams([
            ...Object.entries(alertPages).map(([key, value]) => [key + 'Page', value]),
            ...Object.entries(alertSearches).map(([key, value]) => [key + 'Search', value]),
            ...Object.entries(alertSorts).flatMap(([section, sorting]) => [
              [section + 'Sort', sorting.key],
              [section + 'Direction', sorting.direction === 1 ? 'asc' : 'desc'],
            ]),
          ])
      );
      alertPages = data.pages;
      alertSettings = { days: data.days, low: data.low };
      const panels = [
        ['lowStock', 'Low stock', ['DC', 'Medicine', 'QTY'], (r) => [r.code, r.name, r.quantity]],
        [
          'expiring',
          'Short expiry',
          ['DC', 'Medicine / Batch', 'Expiry', 'Days', 'QTY'],
          (r) => [r.code, r.name + ' / ' + (r.batch || '—'), r.expiry, r.days, r.quantity],
        ],
        [
          'expired',
          'Expired stock',
          ['DC', 'Medicine / Batch', 'Expiry', 'QTY'],
          (r) => [r.code, r.name + ' / ' + (r.batch || '—'), r.expiry, r.quantity],
        ],
      ];
      $('stock-alerts').innerHTML = panels
        .map(
          ([key, title, headers, map]) =>
            '<article><h3>' +
            title +
            ' <span>' +
            data.counts[key] +
            '</span></h3>' +
            (['lowStock', 'expiring', 'expired'].includes(key)
              ? '<button type="button" class="alert-excel-download" data-low-excel="' +
                key +
                '" ' +
                (lowExporting ? 'disabled' : '') +
                '>↓ Download Excel</button>'
              : '') +
            '<form data-alert-search="' +
            key +
            '" class="alert-search-form"><label>Search ' +
            title +
            '<input type="search" name="query" maxlength="200" placeholder="' +
            (key === 'lowStock' ? 'DC or medicine name' : 'DC, medicine name or batch') +
            '" value="' +
            esc(alertSearches[key]) +
            '" /></label><button type="submit">Search</button><button type="button" data-alert-clear="' +
            key +
            '">Reset</button></form>' +
            (data[key].length
              ? simpleTable(headers, data[key].map(map), {
                  section: key,
                  keys:
                    key === 'lowStock'
                      ? ['code', 'name', 'quantity']
                      : key === 'expiring'
                        ? ['code', 'name', 'expiry', 'days', 'quantity']
                        : ['code', 'name', 'expiry', 'quantity'],
                  ...alertSorts[key],
                })
              : '<div class="medicine-state" role="status"><strong>' +
                (alertSearches[key]
                  ? 'No matching medicines found.'
                  : key === 'expired'
                    ? 'No expired stock found.'
                    : key === 'expiring'
                      ? 'No medicines expire within the selected days.'
                      : 'No medicines meet the selected low-stock limit.') +
                '</strong><p>' +
                (alertSearches[key]
                  ? 'Try another DC, medicine name or batch, or reset the search.'
                  : 'The latest stock has no records for this section.') +
                '</p></div>') +
            '<div class="orders-paging" aria-label="' +
            title +
            ' pages">' +
            '<button type="button" data-alert-key="' +
            key +
            '" data-alert-page="' +
            (alertPages[key] - 1) +
            '" ' +
            (alertPages[key] <= 1 ? 'disabled' : '') +
            '>← Previous</button>' +
            '<span>Page ' +
            alertPages[key] +
            ' of ' +
            Math.max(1, Math.ceil(data.counts[key] / 30)) +
            ' · ' +
            data.counts[key] +
            ' records</span>' +
            '<button type="button" data-alert-key="' +
            key +
            '" data-alert-page="' +
            (alertPages[key] + 1) +
            '" ' +
            (alertPages[key] >= Math.max(1, Math.ceil(data.counts[key] / 30)) ? 'disabled' : '') +
            '>Next →</button><form class="alert-page-jump" data-alert-jump="' +
            key +
            '"><label>Go to page<input name="page" type="number" min="1" max="' +
            Math.max(1, Math.ceil(data.counts[key] / 30)) +
            '" step="1" required value="' +
            alertPages[key] +
            '" ' +
            (data.counts[key] ? '' : 'disabled') +
            ' /></label><button type="submit" ' +
            (data.counts[key] ? '' : 'disabled') +
            '>Go</button></form></div>' +
            '</article>'
        )
        .join('');
      $('insights-message').textContent = '';
    } catch (e) {
      $('stock-alerts').innerHTML = alertState(false);
      $('insights-message').textContent = e.message;
    } finally {
      $('stock-alerts').setAttribute('aria-busy', 'false');
      alertsBusy = false;
      $('alert-apply').disabled = false;
    }
  }
  $('alert-apply').onclick = () => {
    if (alertsBusy) return;
    alertPages = { lowStock: 1, expiring: 1, expired: 1 };
    loadAlerts();
  };
  $('stock-alerts').addEventListener('click', (event) => {
    const button = event.target.closest('[data-alert-page]');
    if (!button || alertsBusy || button.disabled) return;
    alertPages[button.dataset.alertKey] = Number(button.dataset.alertPage);
    loadAlerts();
  });
  $('stock-alerts').addEventListener('submit', (event) => {
    const form = event.target.closest('[data-alert-search]');
    if (!form) return;
    event.preventDefault();
    if (alertsBusy) return;
    const key = form.dataset.alertSearch;
    alertSearches[key] = form.elements.query.value.trim();
    alertPages[key] = 1;
    loadAlerts();
  });
  $('stock-alerts').addEventListener('click', (event) => {
    const button = event.target.closest('[data-alert-clear]');
    if (!button || alertsBusy) return;
    const key = button.dataset.alertClear;
    alertSearches[key] = '';
    alertPages[key] = 1;
    loadAlerts();
  });
  $('stock-alerts').addEventListener('submit', (event) => {
    const form = event.target.closest('[data-alert-jump]');
    if (!form) return;
    event.preventDefault();
    if (alertsBusy || !form.reportValidity()) return;
    alertPages[form.dataset.alertJump] = Number(form.elements.page.value);
    loadAlerts();
  });
  $('stock-alerts').addEventListener('click', (event) => {
    if (event.target.closest('[data-alert-retry]')) loadAlerts();
  });
  $('stock-alerts').addEventListener('click', (event) => {
    const button = event.target.closest('[data-alert-sort]');
    if (!button || alertsBusy) return;
    const section = button.dataset.alertSection,
      key = button.dataset.alertSort;
    if (alertSorts[section].key === key) alertSorts[section].direction *= -1;
    else alertSorts[section] = { key, direction: 1 };
    alertPages[section] = 1;
    loadAlerts();
  });
  let docketPage = 1, docketSequence = 0, docketSort = 'dispatch_date', docketDirection = 'desc';
  async function loadDocketRecords() {
    const seq = ++docketSequence, epoch = authEpoch, date = $('docket-record-date').value;
    $('docket-record-message').textContent = 'Loading docket records…';
    $('docket-record-rows').replaceChildren();
    try {
      const data = await request('/api/admin/dockets?' + new URLSearchParams({q: $('docket-record-search').elements.q.value.trim(), date, page: docketPage, sort: docketSort, direction: docketDirection}));
      if (seq !== docketSequence || epoch !== authEpoch) return;
      docketPage = data.page;
      $('docket-record-date').innerHTML = '<option value="">All dates</option>' + data.dates.map(d => '<option value="' + esc(d.date || 'unknown') + '">' + esc(d.date || 'Date unavailable') + ' (' + d.count + ')</option>').join('');
      $('docket-record-date').value = date;
      $('docket-record-rows').innerHTML = data.items.map(r => '<tr>' + [r.dispatch_date, displayStoreCode(r.organization), r.store_owner, r.mobile, r.docket_no, r.courier, r.tracking, r.status, r.boxes, r.items].map((v, index) => '<td>' + (index === 5 && /^https:\/\//.test(r.courierUrl || '') ? '<a class="docket-courier-link" href="' + esc(r.courierUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(v || 'Courier') + ' ↗</a>' : esc(v || '—')) + '</td>').join('') + '</tr>').join('');
      $('docket-record-message').textContent = data.total + ' docket records' + (data.total ? '' : ' found.');
      $('docket-record-page').textContent = 'Page ' + data.page + ' of ' + data.pages;
      $('docket-record-prev').disabled = data.page <= 1;
      $('docket-record-next').disabled = data.page >= data.pages;
    } catch(error) { if (seq === docketSequence && epoch === authEpoch) $('docket-record-message').textContent = error.message; }
  }
  $('admin-view-dockets').addEventListener('click', event => {
    const button = event.target.closest('[data-docket-sort]');
    if (!button) return;
    docketDirection = docketSort === button.dataset.docketSort && docketDirection === 'asc' ? 'desc' : 'asc';
    docketSort = button.dataset.docketSort;
    docketPage = 1;
    document.querySelectorAll('[data-docket-sort]').forEach(b => {
      const selected = b.dataset.docketSort === docketSort;
      b.closest('th').setAttribute('aria-sort', selected ? (docketDirection === 'asc' ? 'ascending' : 'descending') : 'none');
      b.querySelector('span').textContent = selected ? (docketDirection === 'asc' ? '↑' : '↓') : '↕';
    });
    loadDocketRecords();
  });
  $('docket-record-search').onsubmit = e => { e.preventDefault(); docketPage = 1; loadDocketRecords(); };
  $('docket-record-date').onchange = () => { docketPage = 1; loadDocketRecords(); };
  $('docket-record-refresh').onclick = () => loadDocketRecords();
  $('docket-record-prev').onclick = () => { if (docketPage > 1) { docketPage--; loadDocketRecords(); } };
  $('docket-record-next').onclick = () => { docketPage++; loadDocketRecords(); };
  function selectAdminView(view) {
    if (view === 'kendras' && token) {
      loadAdminDemands();
      loadAdminProfiles();
    }
    if (view === 'operations' && token) loadOperations();
    if (view === 'dockets' && token) loadDocketRecords();
    if (view === 'stock' && token) loadManagedStock();
    if (view === 'alerts' && token && !alertSettings) loadAlerts();
    for (const name of ['dashboard', 'orders', 'alerts', 'operations', 'kendras', 'stock', 'dockets'])
      $('admin-view-' + name).hidden = name !== view;
    document
      .querySelectorAll('[data-admin-view]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.adminView === view))
      );
  }
  document
    .querySelectorAll('[data-admin-view]')
    .forEach((button) => (button.onclick = () => selectAdminView(button.dataset.adminView)));

  let managedSort = 'code',
    managedDirection = 'asc';
  let managedStock = null,
    managedPage = 1,
    managedBusy = false;
  const managedSelection = new Set();
  function syncManaged() {
    $('manage-stock-size').disabled = managedBusy;
    $('manage-stock-remove').disabled = managedBusy || !managedSelection.size;
    $('manage-stock-remove').textContent = 'Remove selected (' + managedSelection.size + ')';
    $('manage-stock-select').disabled = managedBusy || !managedStock?.items?.length;
    $('manage-stock-previous').disabled = managedBusy || managedPage <= 1;
    $('manage-stock-next').disabled =
      managedBusy ||
      !managedStock ||
      managedPage * Number($('manage-stock-size').value) >= managedStock.total;
  }
  let managedSearchTimer,
    managedReloadQueued = false;
  async function loadManagedStock() {
    if (!token) return;
    if (managedBusy) {
      managedReloadQueued = true;
      return;
    }
    const searchQuery = $('manage-stock-search').elements.q.value.trim();
    managedBusy = true;
    managedSelection.clear();
    syncManaged();
    $('manage-stock-message').textContent = 'Loading stock…';
    try {
      managedStock = await request(
        '/api/admin/stock-records?page=' +
          managedPage +
          '&size=' +
          $('manage-stock-size').value +
          '&sort=' +
          managedSort +
          '&direction=' +
          managedDirection +
          '&q=' +
          encodeURIComponent(searchQuery)
      );
      if (searchQuery !== $('manage-stock-search').elements.q.value.trim()) {
        managedReloadQueued = true;
        return;
      }
      managedPage = managedStock.page;
      $('manage-stock-results').scrollTop = 0;
      const heading = (key, label) =>
        '<th aria-sort="' +
        (managedSort === key ? (managedDirection === 'asc' ? 'ascending' : 'descending') : 'none') +
        '"><button type="button" data-stock-sort="' +
        key +
        '">' +
        label +
        ' ' +
        (managedSort === key ? (managedDirection === 'asc' ? '↑' : '↓') : '↕') +
        '</button></th>';
      $('manage-stock-results').innerHTML = managedStock.items.length
        ? '<table><thead><tr><th>Select</th>' +
          heading('code', 'DC') +
          heading('name', 'Medicine') +
          heading('batch', 'Batch') +
          heading('expiry', 'Expiry') +
          heading('available', 'QTY') +
          '<th>Action</th></tr></thead><tbody>' +
          managedStock.items
            .map(
              (r) =>
                '<tr><td><input type="checkbox" data-stock-select="' +
                esc(r.id) +
                '" aria-label="Select batch ' +
                esc(r.batch) +
                '"></td><td>' +
                esc(r.code) +
                '</td><td>' +
                esc(r.name) +
                '</td><td>' +
                esc(r.batch) +
                '</td><td>' +
                esc(r.expiry) +
                '</td><td>' +
                esc(r.available) +
                '</td><td><button type="button" data-stock-remove="' +
                esc(r.id) +
                '">Remove</button></td></tr>'
            )
            .join('') +
          '</tbody></table>'
        : '<p>No stock records match.</p>';
      $('manage-stock-page').textContent =
        'Page ' +
        managedPage +
        ' of ' +
        Math.max(1, Math.ceil(managedStock.total / Number($('manage-stock-size').value))) +
        ' · ' +
        managedStock.total +
        ' batch records';
      $('manage-stock-message').textContent = '';
    } catch (e) {
      $('manage-stock-message').textContent = e.message;
    } finally {
      managedBusy = false;
      syncManaged();
      if (managedReloadQueued && token) {
        managedReloadQueued = false;
        managedPage = 1;
        loadManagedStock();
      }
    }
  }
  async function removeManaged(ids) {
    if (managedBusy || !managedStock || !ids.length) return;
    const rows = managedStock.items.filter((r) => ids.includes(String(r.id)));
    const summary = rows
      .map((r) => 'DC ' + r.code + ' · ' + r.name + ' · Batch ' + r.batch + ' · QTY ' + r.available)
      .join('\n');
    if (
      !confirm(
        'Remove ' +
          rows.length +
          ' batch records from live stock?\n\n' +
          summary +
          '\n\nThese batches will no longer be available for orders.'
      )
    )
      return;
    managedBusy = true;
    syncManaged();
    try {
      const result = await request('/api/admin/stock-records/remove', {
        method: 'POST',
        body: JSON.stringify({ ids, revision: managedStock.revision }),
      });
      managedBusy = false;
      managedPage = 1;
      await loadManagedStock();
      $('manage-stock-message').textContent = result.message;
    } catch (e) {
      $('manage-stock-message').textContent = e.message;
    } finally {
      managedBusy = false;
      syncManaged();
    }
  }
  $('manage-stock-search').elements.q.oninput = () => {
    clearTimeout(managedSearchTimer);
    managedSelection.clear();
    syncManaged();
    managedSearchTimer = setTimeout(() => {
      managedPage = 1;
      loadManagedStock();
    }, 250);
  };
  $('manage-stock-search').onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(managedSearchTimer);
    managedPage = 1;
    loadManagedStock();
  };
  $('manage-stock-results').onchange = (e) => {
    const el = e.target.closest('[data-stock-select]');
    if (!el) return;
    if (el.checked) managedSelection.add(el.dataset.stockSelect);
    else managedSelection.delete(el.dataset.stockSelect);
    syncManaged();
  };
  $('manage-stock-size').onchange = () => {
    if (managedBusy) return;
    managedPage = 1;
    loadManagedStock();
  };
  $('manage-stock-results').onclick = (e) => {
    const sort = e.target.closest('[data-stock-sort]');
    if (sort) {
      if (managedBusy) return;
      managedDirection =
        managedSort === sort.dataset.stockSort && managedDirection === 'asc' ? 'desc' : 'asc';
      managedSort = sort.dataset.stockSort;
      managedPage = 1;
      loadManagedStock();
      return;
    }
    const el = e.target.closest('[data-stock-remove]');
    if (el) removeManaged([el.dataset.stockRemove]);
  };
  $('manage-stock-select').onclick = () => {
    const boxes = $('manage-stock-results').querySelectorAll('[data-stock-select]');
    const all = [...boxes].every((b) => b.checked);
    boxes.forEach((b) => {
      b.checked = !all;
      if (all) managedSelection.delete(b.dataset.stockSelect);
      else managedSelection.add(b.dataset.stockSelect);
    });
    syncManaged();
  };
  $('manage-stock-remove').onclick = () => removeManaged([...managedSelection]);
  $('manage-stock-previous').onclick = () => {
    managedPage--;
    loadManagedStock();
  };
  $('manage-stock-next').onclick = () => {
    managedPage++;
    loadManagedStock();
  };

  let adminDemandPage = 1,
    adminProfilePage = 1,
    demandsBusy = false,
    profilesBusy = false;
  async function loadAdminDemands() {
    if (!token || demandsBusy) return;
    demandsBusy = true;
    $('admin-demand-message').textContent = 'Loading demand requests…';
    try {
      const form = $('admin-demand-search'),
        data = await request(
          '/api/admin/demands?' +
            new URLSearchParams({
              q: form.elements.q.value,
              status: form.elements.status.value,
              page: adminDemandPage,
            })
        );
      $('admin-demands').innerHTML = data.demands.length
        ? data.demands
            .map(
              (row) =>
                '<article class="backup-entry"><h3>Store ' +
                esc(displayStoreCode(row.store_code)) +
                ' · ' +
                esc(row.medicine) +
                '</h3><p>DC: ' +
                esc(row.code || 'Not listed') +
                ' · Quantity: ' +
                row.quantity +
                ' · Status: ' +
                esc(row.status) +
                '</p><p>' +
                esc(row.profile.contactName) +
                ' · ' +
                esc(row.mobile) +
                '</p><p>Note: ' +
                esc(row.note || '—') +
                '</p><p>' +
                esc(
                  new Date(row.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                ) +
                '</p><form class="demand-status-form" data-demand-id="' +
                esc(row.id) +
                '"><label>Status<select name="status">' +
                data.statuses
                  .map(
                    (status) =>
                      '<option ' +
                      (status === row.status ? 'selected' : '') +
                      '>' +
                      status +
                      '</option>'
                  )
                  .join('') +
                '</select></label><label>Admin note<textarea name="note" maxlength="1000" rows="2">' +
                esc(row.admin_note || '') +
                '</textarea></label><button type="submit">Update demand</button></form></article>'
            )
            .join('')
        : '<p>No matching demand requests.</p>';
      $('admin-demand-page').textContent =
        'Page ' +
        adminDemandPage +
        ' of ' +
        Math.max(1, Math.ceil(data.total / 20)) +
        ' · ' +
        data.total +
        ' requests';
      $('admin-demand-previous').disabled = adminDemandPage <= 1;
      $('admin-demand-next').disabled = adminDemandPage >= Math.ceil(data.total / 20);
      $('admin-demand-message').textContent = '';
    } catch (error) {
      $('admin-demand-message').textContent = error.message;
    } finally {
      demandsBusy = false;
    }
  }
  async function loadAdminProfiles() {
    if (!token || profilesBusy) return;
    profilesBusy = true;
    $('admin-profiles').textContent = 'Loading profiles…';
    try {
      const data = await request(
        '/api/admin/kendras?' +
          new URLSearchParams({
            q: $('admin-profile-search').elements.q.value,
            page: adminProfilePage,
          })
      );
      $('admin-profiles').innerHTML = data.profiles.length
        ? simpleTable(
            [
              'Store',
              'Contact person',
              'Mobile',
              'Delivery address',
              'GSTIN',
              'DL Form 20',
              'DL Form 21',
            ],
            data.profiles.map((row) => [
              displayStoreCode(row.storeCode),
              row.contactName,
              row.mobile,
              [row.address, row.city, row.state, row.pincode].join(', '),
              row.gst || '—',
              row.dlForm20 || '—',
              row.dlForm21 || '—',
            ])
          )
        : '<p>No matching Kendra profiles.</p>';
      adminProfiles.clear();
      data.profiles.forEach((row) => adminProfiles.set(row.storeCode, row));
      const profileTable = $('admin-profiles').querySelector('table');
      if (profileTable) {
        const heading = document.createElement('th');
        heading.textContent = 'Actions';
        profileTable.querySelector('thead tr').append(heading);
        profileTable.querySelectorAll('tbody tr').forEach((tr, index) => {
          const cell = document.createElement('td'),
            button = document.createElement('button');
          button.type = 'button';
          button.className = 'profile-edit-button';
          button.textContent = 'Edit profile';
          button.dataset.profileEdit = data.profiles[index].storeCode;
          cell.append(button);
          tr.append(cell);
        });
      }
      $('admin-profile-page').textContent =
        'Page ' +
        adminProfilePage +
        ' of ' +
        Math.max(1, Math.ceil(data.total / 20)) +
        ' · ' +
        data.total +
        ' profiles';
      $('admin-profile-previous').disabled = adminProfilePage <= 1;
      $('admin-profile-next').disabled = adminProfilePage >= Math.ceil(data.total / 20);
    } catch (error) {
      $('admin-profiles').textContent = error.message;
    } finally {
      profilesBusy = false;
    }
  }
  $('admin-profiles').addEventListener('click', (event) => {
    const button = event.target.closest('[data-profile-edit]');
    if (!button || !token) return;
    const profile = adminProfiles.get(button.dataset.profileEdit);
    if (!profile) return;
    const form = $('admin-profile-edit');
    form.reset();
    for (const field of form.elements)
      if (field.name in profile) field.value = profile[field.name] || '';
    form.dataset.originalStore = profile.storeCode;
    form.elements.storeCode.value = displayStoreCode(profile.storeCode);
    $('profile-editor-message').textContent = '';
    $('admin-profile-dialog').showModal();
  });
  $('profile-editor-close').onclick = $('profile-editor-cancel').onclick = () => {
    $('admin-profile-dialog').close();
  };
  $('admin-profile-edit').elements.storeCode.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });
  $('admin-profile-edit').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target,
      button = $('profile-editor-save');
    if (button.disabled || !token) return;
    const profile = Object.fromEntries(new FormData(form));
    button.disabled = true;
    button.textContent = 'Saving…';
    $('profile-editor-message').textContent = '';
    try {
      const changed = profile.storeCode !== form.dataset.originalStore;
      const data = await request(
        '/api/admin/kendras/' +
          encodeURIComponent(form.dataset.originalStore) +
          (changed ? '/store-code' : ''),
        {
          method: changed ? 'POST' : 'PUT',
          body: JSON.stringify(profile),
        }
      );
      $('admin-profile-dialog').close();
      await Promise.all([loadAdminProfiles(), loadAdminDemands()]);
      $('admin-profile-message').textContent = data.message;
    } catch (error) {
      $('profile-editor-message').textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Save changes';
    }
  };
  $('admin-demand-search').onsubmit = (e) => {
    e.preventDefault();
    adminDemandPage = 1;
    loadAdminDemands();
  };
  $('admin-profile-search').onsubmit = (e) => {
    e.preventDefault();
    adminProfilePage = 1;
    loadAdminProfiles();
  };
  $('admin-demand-previous').onclick = () => {
    if (!demandsBusy) {
      adminDemandPage--;
      loadAdminDemands();
    }
  };
  $('admin-demand-next').onclick = () => {
    if (!demandsBusy) {
      adminDemandPage++;
      loadAdminDemands();
    }
  };
  $('admin-profile-previous').onclick = () => {
    if (!profilesBusy) {
      adminProfilePage--;
      loadAdminProfiles();
    }
  };
  $('admin-profile-next').onclick = () => {
    if (!profilesBusy) {
      adminProfilePage++;
      loadAdminProfiles();
    }
  };
  $('admin-demands').addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-demand-id]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      await request('/api/admin/demands/' + form.dataset.demandId + '/status', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      await loadAdminDemands();
      $('admin-demand-message').textContent = 'Demand status updated.';
    } catch (error) {
      $('admin-demand-message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  let operationsBusy = false;
  async function loadOperations() {
    if (!token || operationsBusy) return;
    operationsBusy = true;
    $('operations-refresh').disabled = true;
    $('operations-content').setAttribute('aria-busy', 'true');
    if (!$('operations-content').innerHTML)
      $('operations-content').innerHTML = OperationsView.loading();
    $('operations-message').textContent = 'Loading operations…';
    try {
      const data = await request('/api/admin/operations');
      $('operations-content').innerHTML = OperationsView.render(data);
      $('operations-message').textContent = '';
    } catch (error) {
      $('operations-message').textContent = error.message;
      $('operations-content').innerHTML =
        '<div class="ops-loading"><strong>Operations could not be loaded.</strong><p>Use Refresh to try again.</p></div>';
    } finally {
      operationsBusy = false;
      $('operations-refresh').disabled = false;
      $('operations-content').setAttribute('aria-busy', 'false');
    }
  }
  $('operations-refresh').onclick = loadOperations;
  $('backup-create').onclick = async () => {
    const button = $('backup-create');
    button.disabled = true;
    $('operations-message').textContent = 'Creating backup and testing restore…';
    try {
      await request('/api/admin/backups', { method: 'POST', body: '{}' });
      await loadOperations();
      $('operations-message').textContent = 'Backup saved. Restore test passed.';
    } catch (error) {
      $('operations-message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  $('operations-content').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-email-retry]');
    if (!button || button.disabled || !token) return;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const data = await request(
        '/api/admin/orders/' + encodeURIComponent(button.dataset.emailRetry) + '/retry-email',
        { method: 'POST', body: '{}' }
      );
      await loadOperations();
      $('operations-message').textContent = data.message;
    } catch (error) {
      $('operations-message').textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Retry pending email';
    }
  });
  $('operations-content').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-backup-download],[data-backup-verify]');
    if (!button || button.disabled || !token) return;
    button.disabled = true;
    const epoch = authEpoch;
    try {
      if (button.dataset.backupVerify) {
        $('operations-message').textContent = 'Testing backup restore…';
        await request('/api/admin/backups/' + button.dataset.backupVerify + '/verify', {
          method: 'POST',
          body: '{}',
        });
        await loadOperations();
        $('operations-message').textContent = 'Restore test passed.';
      } else {
        $('operations-message').textContent = 'Preparing backup download…';
        let offset = 0;
        const parts = [];
        do {
          const data = await request(
            '/api/admin/backups/' + button.dataset.backupDownload + '/download?offset=' + offset
          );
          parts.push(Uint8Array.from(atob(data.part), (char) => char.charCodeAt(0)));
          offset = data.nextOffset;
        } while (offset != null);
        if (epoch !== authEpoch) throw Error('Please sign in again.');
        const url = URL.createObjectURL(new Blob(parts, { type: 'application/gzip' })),
          link = document.createElement('a');
        link.href = url;
        link.download = 'Radhika-Backup-' + button.dataset.backupDownload + '.json.gz';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        $('operations-message').textContent =
          'Backup downloaded. Keep this file privately in a separate location.';
      }
    } catch (error) {
      $('operations-message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $('orders').addEventListener('click', async (event) => {
    const summary = event.target.closest('[data-order-history]');
    if (!summary || !token) return;
    const content = summary.parentElement.querySelector('[data-order-history-content]');
    if (content.dataset.loaded === 'true') return;
    content.textContent = 'Loading order history…';
    try {
      const data = await request('/api/admin/orders/' + summary.dataset.orderHistory + '/history');
      content.innerHTML = data.events.length
        ? simpleTable(
            ['When', 'Status', 'Changed by', 'Details'],
            data.events.map((row) => [
              new Date(row.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
              row.status,
              row.actor,
              row.note +
                (row.details?.stockReturned
                  ? ' · Stock returned: ' + row.details.returnedQuantity
                  : ''),
            ])
          )
        : '<p>No history recorded for this older order.</p>';
      content.dataset.loaded = 'true';
    } catch (error) {
      content.textContent = error.message;
    }
  });
  let excelLibrary;
  function loadOrderExcel() {
    if (window.ExcelJS) return Promise.resolve();
    if (!excelLibrary)
      excelLibrary = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'js/vendor/exceljs.min.js';
        script.onload = resolve;
        script.onerror = () => {
          excelLibrary = null;
          script.remove();
          reject(Error('Excel could not be loaded. Please try again.'));
        };
        document.head.append(script);
      });
    return excelLibrary;
  }
  function trackingDate(value) {
    const text = String(value || '').trim(), m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    const time = m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : Date.parse(text);
    return Number.isFinite(time) ? time : -Infinity;
  }
  $('orders').addEventListener('click', async (e) => {
    const button = e.target.closest('[data-order-track]');
    if (!button || button.disabled || !token) return;
    const order = visibleOrders.get(button.dataset.orderTrack);
    if (!order) return;
    const result = button.closest('.order-card').querySelector('.order-tracking-result'), epoch = authEpoch;
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
      if (epoch !== authEpoch || !button.isConnected) return;
      const dockets = Array.isArray(data.dockets) ? data.dockets : [];
      const matching = order.docket ? dockets.filter(d => [d.docketNo, d.tracking].some(v => String(v || '').trim().toLowerCase() === String(order.docket).trim().toLowerCase())) : dockets;
      const latest = matching.slice().sort((a, b) => trackingDate(b.dispatchDate) - trackingDate(a.dispatchDate))[0];
      if (!latest) result.textContent = order.docket ? 'No tracking update found for this order’s docket yet.' : 'No docket found for this store yet.';
      else result.innerHTML = '<strong>' + esc(latest.status || 'Status') + '</strong><small>' + esc(order.docket ? 'Order docket' : 'Latest store docket') + '</small><span>' + esc([latest.courier, latest.tracking || latest.docketNo, latest.dispatchDate ? 'Dispatched: ' + latest.dispatchDate : ''].filter(Boolean).join(' · ')) + '</span><small>Latest saved tracking status</small>';
    } catch (error) {
      if (epoch === authEpoch && button.isConnected) result.textContent = error.message || 'Could not fetch tracking. Please try again.';
    } finally {
      if (epoch === authEpoch && button.isConnected) {
        button.disabled = false;
        button.textContent = 'Refresh Tracking';
        button.setAttribute('aria-busy', 'false');
      }
    }
  });
  $('orders').addEventListener('click', async (e) => {
    const button = e.target.closest('[data-order-excel], [data-order-unavailable]');
    if (!button || busy || bulkUpdating) return;
    const missing = !!button.dataset.orderUnavailable;
    const id = button.dataset.orderUnavailable || button.dataset.orderExcel,
      order = visibleOrders.get(id);
    if (!order || exportingOrders.has(id)) return;
    exportingOrders.add(id);
    button.disabled = true;
    button.textContent = 'Preparing Excel…';
    button.setAttribute('aria-busy', 'true');
    try {
      await loadOrderExcel();
      const bytes = await (
        missing
          ? OrderExcel.unavailableWorkbook(window.ExcelJS, order)
          : OrderExcel.workbook(window.ExcelJS, order)
      ).xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download =
        (missing ? 'Not-Available-' : 'Order-') +
        String(order.storeCode || 'Unknown').replace(/[^a-zA-Z0-9-]/g, '') +
        '-' +
        id +
        '.xlsx';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      message(e.message || 'Order Excel download failed.', true);
    } finally {
      exportingOrders.delete(id);
      button.disabled = busy || bulkUpdating;
      button.textContent = missing
        ? '↓ Download Not Available (' + order.unavailableItems.length + ')'
        : '↓ Download Excel';
      button.setAttribute('aria-busy', 'false');
    }
  });
  $('stock-alerts').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-low-excel]');
    if (!button || !token || !alertSettings || lowExporting) return;
    lowExporting = true;
    button.disabled = true;
    button.textContent = 'Preparing Excel…';
    const kind = button.dataset.lowExcel,
      shortExpiry = kind === 'expiring',
      expiredStock = kind === 'expired';
    const settings = {
        ...alertSettings,
        search: alertSearches[kind],
        sort: alertSorts[kind].key,
        direction: alertSorts[kind].direction === 1 ? 'asc' : 'desc',
      },
      session = token;
    try {
      const rows = [];
      let snapshot = '',
        total = 0,
        current = 1;
      do {
        const data = await request(
          '/api/admin/stock-alerts?days=' +
            settings.days +
            '&low=' +
            settings.low +
            '&' +
            kind +
            'Search=' +
            encodeURIComponent(settings.search) +
            '&' +
            kind +
            'Sort=' +
            settings.sort +
            '&' +
            kind +
            'Direction=' +
            settings.direction +
            '&page=' +
            current +
            (snapshot ? '&snapshot=' + snapshot : '')
        );
        if (token !== session) throw Error('Please sign in again.');
        snapshot = data.snapshot;
        total = data.counts[kind];
        if (!data[kind].length && rows.length < total)
          throw Error('Stock changed. Please download again.');
        rows.push(...data[kind]);
        current++;
      } while (rows.length < total);
      await loadOrderExcel();
      const book = new window.ExcelJS.Workbook();
      book.creator = 'Radhika Agencies';
      const sheet = book.addWorksheet(
        expiredStock ? 'Expired stock' : shortExpiry ? 'Short expiry' : 'Low stock',
        {
          views: [{ state: 'frozen', ySplit: 4 }],
        }
      );
      sheet.columns = expiredStock
        ? [{ width: 15 }, { width: 80 }, { width: 22 }, { width: 18 }, { width: 14 }]
        : shortExpiry
          ? [
              { width: 15 },
              { width: 80 },
              { width: 22 },
              { width: 18 },
              { width: 14 },
              { width: 14 },
            ]
          : [{ width: 15 }, { width: 90 }, { width: 18 }];
      sheet.mergeCells(expiredStock ? 'A1:E1' : shortExpiry ? 'A1:F1' : 'A1:C1');
      sheet.getCell('A1').value = expiredStock
        ? 'RADHIKA AGENCIES — EXPIRED STOCK'
        : shortExpiry
          ? 'RADHIKA AGENCIES — SHORT EXPIRY'
          : 'RADHIKA AGENCIES — LOW STOCK';
      sheet.getCell('A1').font = { bold: true, size: 20 };
      sheet.getCell('A2').value = expiredStock
        ? 'Report'
        : shortExpiry
          ? 'Expiry within days'
          : 'Stock QTY ≤';
      sheet.getCell('B2').value = expiredStock
        ? 'All expired stock'
        : shortExpiry
          ? settings.days
          : settings.low;
      sheet.addTable({
        name: 'LowStock',
        ref: 'A4',
        headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: (expiredStock
          ? ['DC', 'Medicine', 'Batch', 'Expiry', 'QTY']
          : shortExpiry
            ? ['DC', 'Medicine', 'Batch', 'Expiry', 'Days', 'QTY']
            : ['DC', 'Medicine', 'QTY']
        ).map((name) => ({ name, filterButton: true })),
        rows: rows.map((row) =>
          expiredStock
            ? [
                String(row.code),
                String(row.name),
                String(row.batch || ''),
                String(row.expiry),
                Number(row.quantity),
              ]
            : shortExpiry
              ? [
                  String(row.code),
                  String(row.name),
                  String(row.batch || ''),
                  String(row.expiry),
                  Number(row.days),
                  Number(row.quantity),
                ]
              : [String(row.code), String(row.name), Number(row.quantity)]
        ),
      });
      sheet.getColumn(2).alignment = { wrapText: true };
      const bytes = await book.xlsx.writeBuffer();
      if (token !== session) throw Error('Please sign in again.');
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = expiredStock
        ? 'Radhika-Expired-Stock.xlsx'
        : shortExpiry
          ? 'Radhika-Short-Expiry-' + settings.days + '-Days.xlsx'
          : 'Radhika-Low-Stock-' + settings.low + '.xlsx';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      message(error.message || 'Excel download failed.', true);
    } finally {
      lowExporting = false;
      for (const active of document.querySelectorAll('[data-low-excel]')) {
        active.disabled = !token;
        active.textContent = '↓ Download Excel';
      }
    }
  });
  $('dashboard-excel').onclick = async () => {
    if (!token || !dashboardData || dashboardExporting) return;
    dashboardExporting = true;
    const button = $('dashboard-excel');
    button.disabled = true;
    button.textContent = 'Preparing Excel…';
    button.setAttribute('aria-busy', 'true');
    const data = dashboardData;
    try {
      await loadOrderExcel();
      const bytes = await DashboardExcel.workbook(window.ExcelJS, data).xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Radhika-Dashboard-' + data.today + '.xlsx';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      message(e.message || 'Dashboard Excel download failed.', true);
    } finally {
      dashboardExporting = false;
      button.textContent = '↓ Download Excel';
      button.disabled = !token || !dashboardData;
      button.setAttribute('aria-busy', 'false');
    }
  };
  try {
    const saved = localStorage.getItem(sessionKey);
    if (saved && validSession(saved)) {
      token = saved;
      $('login-card').hidden = true;
      $('panel').hidden = false;
      $('logout').hidden = false;
      Promise.all([load(), loadInsights()]).catch((error) => message(error.message, true));
    } else if (saved) localStorage.removeItem(sessionKey);
  } catch {}
})();
