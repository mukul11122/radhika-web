(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sessionKey = 'radhika-admin-session';
  const displayStoreCode = (value) =>
    String(value || '')
      .trim()
      .replace(/^(pmbjk|pmjbk|pmbi)/i, '');
  let authEpoch = 0;
  const employeeMode = new URLSearchParams(location.search).get('employee') === '1';
  let employeeSections = [];
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
    overdueOnly = false, pendingOnly = false,
    orderEmployees = [],
    orderEmployeesAvailable = false,
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
    'Under Packing',
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
    if (employeeMode) { sessionStorage.removeItem('radhika-employee-token'); location.href = 'employee.html'; return; }
    try {
      localStorage.removeItem(sessionKey);
    } catch {}
    alertSettings = null; purchaseSelection.clear(); reportSeq++; $('dispatch-results').replaceChildren(); $('dispatch-summary').replaceChildren(); $('workload-results').replaceChildren(); featureSeq++; $('admin-notifications').hidden = true; $('notification-message').textContent = ''; reorderRows = []; customerRows = []; $('reorder-results').replaceChildren(); $('customer-history-results').replaceChildren();
    selectedOrders.clear();
    adminProfiles.clear();
    $('admin-profile-dialog').close();
    $('admin-profile-edit').reset();
    $('profile-editor-message').textContent = '';
    $('admin-profile-message').textContent = '';
    visibleOrders.clear();
    $('docket-record-rows').replaceChildren();
    $('employee-accounts').replaceChildren();
    $('employee-admin-reports').replaceChildren();
    priorityData = null; prioritySeq++; $('priority-results').replaceChildren(); $('priority-chart').replaceChildren(); $('priority-message').textContent = '';
    docketPriorityData = null; docketPrioritySeq++; $('docket-priority-results').replaceChildren(); $('docket-priority-chart').replaceChildren(); $('docket-priority-message').textContent = '';
    EmployeeProgress.clear();
    $('employee-create').reset();
    $('docket-record-message').textContent = '';
    $('docket-record-date').innerHTML = '<option value="">All dates</option>';
    dashboardData = null;
    $('dashboard-excel').disabled = true;
    $('bulk-results').hidden = true;
    syncSelection();
    selectAdminView('dashboard');
    $('login-card').hidden = false;
    $('login-form').elements.password.type = 'password';
    $('login-password-toggle').textContent = 'Show';
    $('login-password-toggle').setAttribute('aria-label', 'Show password');
    $('login-password-toggle').setAttribute('aria-pressed', 'false');
    $('login-error').hidden = true;
    $('login-error').textContent = '';
    $('panel').hidden = true;
    $('logout').hidden = true;
    page = 1; overdueOnly = false; pendingOnly = false; orderEmployees = []; $('dashboard-overdue').hidden = true;
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
    if (token && !employeeMode && !validSession(token)) lock();
  });
  window.addEventListener('storage', (event) => {
    if (!employeeMode && event.key === sessionKey && !event.newValue) lock();
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
    $('login-error').hidden = true;
    $('login-error').textContent = '';
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
      await Promise.all([load(), loadInsights(), refreshNotifications()]);
    } catch (e) {
      $('login-error').textContent = e.message;
      $('login-error').hidden = false;
    } finally {
      $('login-button').disabled = false;
    }
  };
  $('login-password-toggle').onclick = () => {
    const input = $('login-form').elements.password;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    $('login-password-toggle').textContent = visible ? 'Hide' : 'Show';
    $('login-password-toggle').setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    $('login-password-toggle').setAttribute('aria-pressed', String(visible));
  };
  function workflowControls(o) {
    if (employeeMode) return '<div class="workflow-summary"><span>' + esc(o.priority || 'Normal') + ' priority</span><span>Assigned: ' + esc(o.employee_name || '') + '</span>' + (Number(o.overdue) === 1 ? '<span class="workflow-overdue">Overdue · 24+ hours</span>' : '') + '</div>';
    const current = String(o.employee_id || ''), employees = orderEmployees.filter(e => e.active);
    const options = employees.map(e => '<option value="' + esc(e.id) + '"' + (String(e.id) === current ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('');
    const former = current && !employees.some(e => String(e.id) === current) ? '<option value="' + esc(current) + '" selected disabled>' + esc(o.employee_name || 'Employee') + ' (inactive)</option>' : '';
    const priority = ['High', 'Normal', 'Low'].includes(o.priority) ? o.priority : 'Normal';
    const overdue = Number(o.overdue) === 1;
    const employeeDisabled = orderEmployeesAvailable ? '' : ' disabled';
    return '<div class="workflow-summary"><span class="workflow-priority priority-' + priority.toLowerCase() + '">' + priority + ' priority</span><span>Assigned: ' + esc(o.employee_name || 'Unassigned') + '</span>' + (overdue ? '<span class="workflow-overdue">Overdue · 24+ hours in ' + esc(o.status) + '</span>' : '') + '</div><div class="workflow-fields"><label>Assign employee<select data-workflow-employee' + employeeDisabled + '><option value="">Unassigned</option>' + former + options + '</select></label><label>Priority<select data-workflow-priority>' + ['High','Normal','Low'].map(p => '<option' + (p === priority ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label><button type="button" data-workflow-save' + employeeDisabled + '>Save</button></div>' + (orderEmployeesAvailable ? '' : '<small class="workflow-warning">Employee list unavailable. Refresh orders to retry.</small>');
  }
  function card(o) {
    const transitions = {
      New: 'Accepted',
      Accepted: 'Challan Ready',
      'Challan Ready': 'Under Packing',
      'Under Packing': 'Packed',
      Packed: 'Dispatched',
      Dispatched: 'Delivered',
    };
    const next = transitions[o.status];
    const cancellation = ['New', 'Accepted', 'Challan Ready', 'Under Packing', 'Packed'].includes(o.status);
    return `<article class="order-card" data-id="${esc(o.id)}"><label class="bulk-order-select"><input type="checkbox" data-select-order="${esc(o.id)}" aria-label="Select order ${esc(o.id)}"> Select order</label><header><div><h2>Sr. No. ${esc(o.serialNumber ?? "—")} · Store <button type="button" class="store-history-link" data-store-history="${esc(displayStoreCode(o.storeCode))}">${esc(displayStoreCode(o.storeCode))}</button></h2><small>${esc(new Date(o.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}</small></div><span class="order-badge">${esc(o.status)}</span></header><p>Mobile: ${esc(o.mobile)}</p><p class="order-ref">Reference: ${esc(o.id)}</p><small>Email delivery: ${o.sent.length}/3 recipients</small>${workflowControls(o)}<div class="order-download"><button type="button" class="order-track-link" data-order-track="${esc(o.id)}">Track Docket</button><button type="button" data-order-excel="${esc(o.id)}">↓ Download Excel</button>${o.unavailableItems?.length ? `<button type="button" data-order-unavailable="${esc(o.id)}">↓ Download Not Available (${o.unavailableItems.length})</button>` : ''}</div><div class="order-tracking-result" role="status" aria-live="polite" hidden></div><div class="order-items"><table><thead><tr><th>DC</th><th>Order quantity</th></tr></thead><tbody>${o.items.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.quantity)}</td></tr>`).join('')}</tbody></table></div><details class="order-history"><summary data-order-history="${esc(o.id)}">View order history</summary><div data-order-history-content="${esc(o.id)}"></div></details>${o.contactProfile ? `<p class="order-delivery">Delivery: ${esc([o.contactProfile.contactName, o.contactProfile.address, o.contactProfile.city, o.contactProfile.state, o.contactProfile.pincode, o.contactProfile.dlForm20 ? 'DL Form 20: ' + o.contactProfile.dlForm20 : '', o.contactProfile.dlForm21 ? 'DL Form 21: ' + o.contactProfile.dlForm21 : '', o.contactProfile.gst ? 'GSTIN: ' + o.contactProfile.gst : ''].filter(Boolean).join(' · '))}</p>` : ''}${o.docket || o.courier ? `<p>Dispatch: ${esc([o.courier, o.docket].filter(Boolean).join(' · '))}</p>` : ''}${o.note ? `<p class="order-note">${esc(o.note)}</p>` : ''}${next || cancellation ? `<div class="order-action-fields">${o.status === 'Packed' ? '<label>Courier (optional)<input data-courier maxlength="100"></label><label>Docket number (optional)<input data-docket maxlength="100"></label>' : ''}<label>Note / cancellation reason<textarea data-note rows="2" maxlength="1000" placeholder="Required when cancelling"></textarea></label></div><div class="order-actions">${next ? `<button class="orders-primary" data-status="${next}">Mark ${next}</button>` : ''}${cancellation ? '<button class="cancel-order" data-status="Cancelled">Cancel & return stock</button>' : ''}</div>` : ''}</article>`;
    return `<article class="order-card" data-id="${esc(o.id)}"><label class="bulk-order-select"><input type="checkbox" data-select-order="${esc(o.id)}" aria-label="Select order ${esc(o.id)}"> Select order</label><header><div><h2>Store ${esc(displayStoreCode(o.storeCode))}</h2><small>${esc(new Date(o.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}</small></div><span class="order-badge">${esc(o.status)}</span></header><p>Mobile: ${esc(o.mobile)}</p><p class="order-ref">Reference: ${esc(o.id)}</p><small>Email delivery: ${o.sent.length}/3 recipients</small>${workflowControls(o)}<div class="order-download"><button type="button" class="order-track-link" data-order-track="${esc(o.id)}">Track Docket</button><button type="button" data-order-excel="${esc(o.id)}">↓ Download Excel</button>${o.unavailableItems?.length ? `<button type="button" data-order-unavailable="${esc(o.id)}">↓ Download Not Available (${o.unavailableItems.length})</button>` : ''}</div><div class="order-tracking-result" role="status" aria-live="polite" hidden></div><div class="order-items"><table><thead><tr><th>DC</th><th>Order quantity</th></tr></thead><tbody>${o.items.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.quantity)}</td></tr>`).join('')}</tbody></table></div><details class="order-history"><summary data-order-history="${esc(o.id)}">View order history</summary><div data-order-history-content="${esc(o.id)}"></div></details>${o.contactProfile ? `<p class="order-delivery">Delivery: ${esc([o.contactProfile.contactName, o.contactProfile.address, o.contactProfile.city, o.contactProfile.state, o.contactProfile.pincode, o.contactProfile.dlForm20 ? 'DL Form 20: ' + o.contactProfile.dlForm20 : '', o.contactProfile.dlForm21 ? 'DL Form 21: ' + o.contactProfile.dlForm21 : '', o.contactProfile.gst ? 'GSTIN: ' + o.contactProfile.gst : ''].filter(Boolean).join(' · '))}</p>` : ''}${o.docket ? `<p>Dispatch: ${esc(o.courier)} · ${esc(o.docket)}</p>` : ''}${o.note ? `<p class="order-note">${esc(o.note)}</p>` : ''}${next || cancellation ? `<div class="order-action-fields">${o.status === 'Packed' ? '<label>Courier (optional)<input data-courier maxlength="100"></label><label>Docket number (optional)<input data-docket maxlength="100"></label>' : ''}<label>Note / cancellation reason<textarea data-note rows="2" maxlength="1000" placeholder="Required when cancelling"></textarea></label></div><div class="order-actions">${next ? `<button class="orders-primary" data-status="${next}">Mark ${next}</button>` : ''}${cancellation ? '<button class="cancel-order" data-status="Cancelled">Cancel & return stock</button>' : ''}</div>` : ''}</article>`;
  }
  async function load() {
    if (!token || busy) return;
    busy = true;
    $('refresh').disabled = true;
    $('dashboard-overdue').disabled = true;
    $('orders-page-size').disabled = true;
    message('Loading orders…');
    try {
      const out = await request(
        '/api/admin/orders?page=' +
          page +
          '&limit=' + $('orders-page-size').value +
          '&overdue=' + (overdueOnly ? '1' : '0') +
          '&pending=' + (pendingOnly ? '1' : '0') +
          '&status=' +
          encodeURIComponent($('status-filter').value) +
          '&q=' +
          encodeURIComponent($('search').value.trim())
      );
      const employeeData = employeeMode ? null : await request('/api/admin/employees').catch(() => null);
      orderEmployeesAvailable = Array.isArray(employeeData?.employees);
      orderEmployees = orderEmployeesAvailable ? employeeData.employees : [];
      if (!token) return;
      const overdueButton = $('dashboard-overdue');
      overdueButton.hidden = false; overdueButton.textContent = 'Overdue orders (24+ hours): ' + (Number(out.overdueTotal) || 0) + ' · View orders →';
      $('orders-active-filter').hidden = !pendingOnly && !overdueOnly;
      $('orders-active-filter').textContent = overdueOnly ? 'Showing overdue orders. Select the overdue tile again to clear.' : pendingOnly ? 'Showing orders pending dispatch. Select a status or refresh the page to clear.' : '';
      $('stats').innerHTML = states
        .map(
          (status) =>
            `<button type="button" class="orders-stat" data-order-filter="${status}" aria-pressed="${$('status-filter').value === status}"><span>${status}</span><strong>${out.stats.find((r) => r.status === status)?.count || 0}</strong></button>`
        )
        .join('') + '<button type="button" class="orders-stat overdue-stat" data-overdue-filter aria-pressed="' + overdueOnly + '"><span>Overdue · 24+ hours</span><strong>' + (Number(out.overdueTotal) || 0) + '</strong></button>';
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
      const pages = Math.max(1, Math.ceil(out.total / Number($('orders-page-size').value)));
      $('page-status').textContent = `Page ${page} of ${pages} · ${out.total} orders`;
      $('previous').disabled = page <= 1;
      $('next').disabled = page >= pages;
      message('');
    } catch (e) {
      message(e.message, true);
    } finally {
      busy = false;
      $('refresh').disabled = false;
      $('dashboard-overdue').disabled = false;
      $('orders-page-size').disabled = false;
    }
  }
  $('orders-page-size').onchange = () => { page = 1; selectedOrders.clear(); syncSelection(); load(); };
  $('refresh').onclick = async () => {
    await Promise.all([load(), (!employeeMode || employeeSections.includes('dashboard')) ? loadInsights() : Promise.resolve()]);
  };
  $('dashboard-overdue').onclick = () => { pendingOnly = false; overdueOnly = true; page = 1; $('search').value = ''; $('status-filter').value = ''; selectedOrders.clear(); syncSelection(); selectAdminView('orders'); load(); };
  $('stats').addEventListener('click', (event) => {
    const overdue = event.target.closest('[data-overdue-filter]');
    if (overdue && !busy && !bulkUpdating) { overdueOnly = !overdueOnly; pendingOnly = false; $('status-filter').value = ''; page = 1; selectedOrders.clear(); syncSelection(); load(); return; }
    const button = event.target.closest('[data-order-filter]');
    if (!button || busy || bulkUpdating) return;
    overdueOnly = false; pendingOnly = false;
    const status = button.dataset.orderFilter;
    $('status-filter').value = $('status-filter').value === status ? '' : status;
    page = 1;
    selectedOrders.clear();
    syncSelection();
    load();
  });
  $('status-filter').onchange = () => {
    pendingOnly = false; overdueOnly = false;
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
  $('orders').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-workflow-save]');
    if (!button || busy || bulkUpdating) return;
    const box = button.closest('[data-id]'); button.disabled = true; button.textContent = 'Saving…';
    try {
      const result = await request('/api/admin/orders/' + encodeURIComponent(box.dataset.id) + '/workflow', {method:'POST', body:JSON.stringify({employeeId:box.querySelector('[data-workflow-employee]').value, priority:box.querySelector('[data-workflow-priority]').value})});
      await load(); message(result.message);
    } catch(error) { message(error.message, true); }
    finally { button.disabled = false; button.textContent = 'Save'; }
  });
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
      await Promise.all([load(), (!employeeMode || employeeSections.includes('dashboard')) ? loadInsights() : Promise.resolve()]);
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
    if (input.checked && selectedOrders.size >= 30) {
      input.checked = false;
      message('Select up to 30 orders for one bulk update.', true);
      return;
    }
    input.checked
      ? selectedOrders.add(input.dataset.selectOrder)
      : selectedOrders.delete(input.dataset.selectOrder);
    syncSelection();
  });
  $('bulk-select-all').onchange = () => {
    if (busy) return;
    const selecting = $('bulk-select-all').checked;
    selectedOrders.clear();
    document.querySelectorAll('[data-select-order]').forEach((input) => {
      input.checked = selecting && selectedOrders.size < 30;
      if (input.checked) selectedOrders.add(input.dataset.selectOrder);
    });
    if (selecting && visibleOrders.size > 30) message('Selected the first 30 orders. Bulk updates are limited to 30 orders.', false);
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
      await Promise.all([load(), (!employeeMode || employeeSections.includes('dashboard')) ? loadInsights() : Promise.resolve()]);
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
    alertSizes = { lowStock: 10, expiring: 10, expired: 10 },
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
    $('medicine-size').disabled = medicineLoading || !!medicineError || !dashboardData;
    if (medicineLoading || medicineError || !dashboardData) {
      $('medicine-previous').disabled = true;
      $('medicine-next').disabled = true;
      $('medicine-jump-input').disabled = true;
      $('medicine-jump').querySelector('button').disabled = true;
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
    const size = Number($('medicine-size').value);
    const pages = Math.max(1, Math.ceil(rows.length / size));
    medicinePage = Math.max(1, Math.min(medicinePage, pages));
    $('top-medicines').innerHTML =
      (rows.length
        ? simpleTable(
            ['DC', 'Medicine', 'Ordered QTY', 'Orders'],
            rows
              .slice((medicinePage - 1) * size, medicinePage * size)
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
    $('medicine-jump-input').value = medicinePage;
    $('medicine-jump-input').max = pages;
    $('medicine-jump-input').disabled = !rows.length;
    $('medicine-jump').querySelector('button').disabled = !rows.length;
  }
  $('medicine-size').onchange = () => {
    medicinePage = 1;
    renderMedicines();
  };
  $('medicine-jump').onsubmit = (event) => {
    event.preventDefault();
    const input = $('medicine-jump-input'), target = Number(input.value);
    if (medicineLoading || !dashboardData || !Number.isInteger(target) || target < 1 || target > Number(input.max)) return;
    medicinePage = target;
    renderMedicines();
  };
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
    alertSettings = null;
    if (!$('admin-view-alerts').hidden) loadAlerts();
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
            ...Object.entries(alertSizes).map(([key, value]) => [key + 'Size', value]),
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
            '<label class="alert-page-size">Rows per page<select data-alert-size="' + key + '" aria-label="Rows per page for ' + title + '">' + [10,20,30,50,100,200].map(size => '<option value="' + size + '"' + (alertSizes[key] === size ? ' selected' : '') + '>' + size + '</option>').join('') + '</select></label>' +
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
            Math.max(1, Math.ceil(data.counts[key] / alertSizes[key])) +
            ' · ' +
            data.counts[key] +
            ' records</span>' +
            '<button type="button" data-alert-key="' +
            key +
            '" data-alert-page="' +
            (alertPages[key] + 1) +
            '" ' +
            (alertPages[key] >= Math.max(1, Math.ceil(data.counts[key] / alertSizes[key])) ? 'disabled' : '') +
            '>Next →</button><form class="alert-page-jump" data-alert-jump="' +
            key +
            '"><label>Go to page<input name="page" type="number" min="1" max="' +
            Math.max(1, Math.ceil(data.counts[key] / alertSizes[key])) +
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
  $('stock-alerts').addEventListener('change', (event) => {
    const select = event.target.closest('[data-alert-size]');
    if (!select || alertsBusy) return;
    alertSizes[select.dataset.alertSize] = Number(select.value);
    alertPages[select.dataset.alertSize] = 1;
    loadAlerts();
  });
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
      const data = await request('/api/admin/dockets?' + new URLSearchParams({q: $('docket-record-search').elements.q.value.trim(), date, page: docketPage, limit: $('docket-record-limit').value, sort: docketSort, direction: docketDirection}));
      if (seq !== docketSequence || epoch !== authEpoch) return;
      docketPage = data.page;
      $('docket-record-date').innerHTML = '<option value="">All dates</option>' + data.dates.map(d => '<option value="' + esc(d.date || 'unknown') + '">' + esc(d.date || 'Date unavailable') + ' (' + d.count + ')</option>').join('');
      $('docket-record-date').value = date;
      $('docket-record-rows').innerHTML = data.items.map(r => '<tr>' + [r.dispatch_date, displayStoreCode(r.organization), r.store_owner, r.mobile, r.docket_no, r.courier, r.tracking, r.status, r.boxes, r.items].map((v, index) => '<td>' + (index === 5 && /^https:\/\//.test(r.courierUrl || '') ? '<a class="docket-courier-link" href="' + esc(r.courierUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(v || 'Courier') + ' ↗</a>' : esc(v || '—')) + '</td>').join('') + '</tr>').join('');
      $('docket-record-message').textContent = data.total + ' docket records' + (data.total ? '' : ' found.');
      $('docket-record-page').textContent = 'Page ' + data.page + ' of ' + data.pages;
      $('docket-record-prev').disabled = data.page <= 1;
      $('docket-record-next').disabled = data.page >= data.pages;
      const jump = $('docket-record-jump');
      jump.elements.page.value = data.page;
      jump.elements.page.max = data.pages;
      jump.elements.page.disabled = !data.total;
      jump.querySelector('button').disabled = !data.total;
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
  $('docket-record-limit').onchange = () => { docketPage = 1; loadDocketRecords(); };
  $('docket-record-jump').onsubmit = e => {
    e.preventDefault();
    const input = e.currentTarget.elements.page;
    if (!input.reportValidity()) return;
    docketPage = Number(input.value);
    loadDocketRecords();
  };
  $('docket-record-prev').onclick = () => { if (docketPage > 1) { docketPage--; loadDocketRecords(); } };
  $('docket-record-next').onclick = () => { docketPage++; loadDocketRecords(); };
  function renderPriorityChart(id, rows, field, unit) {
    const target = $(id);
    if (!rows.length) { target.replaceChildren(); return; }
    const top = rows.slice(0, 10), max = Math.max(...top.map(row => Number(row[field]) || 0), 1);
    target.innerHTML = '<section class="priority-chart" aria-label="Top stores by ' + unit + '"><div class="priority-chart-heading"><h3>Top 10 stores</h3><span>' + unit + ' · selected period</span></div><div class="priority-chart-bars">' + top.map((row, index) => { const value = Math.max(0, Number(row[field]) || 0); return '<div class="priority-chart-row"><span class="priority-chart-label" title="' + esc(row.storeCode) + '">' + (index + 1) + '. ' + esc(row.storeCode) + '</span><div class="priority-chart-track" aria-hidden="true"><span style="width:' + (value / max * 100) + '%"></span></div><strong>' + value + '</strong></div>'; }).join('') + '</div></section>';
  }
  let priorityData = null, priorityPeriod = 'weekly', priorityPage = 1, prioritySeq = 0, prioritySort = 'rank', priorityDirection = 'asc';
  function renderPriority() {
    if (!priorityData) return;
    const rows = priorityData.rankings[priorityPeriod], size = Number($('priority-size').value);
    renderPriorityChart('priority-chart', rows, 'orders', 'Online orders');
    const sortedRows = rows.map((row, index) => ({...row, rank:index + 1})).sort((a,b) => {
      const value = prioritySort === 'storeCode' ? String(a.storeCode).localeCompare(String(b.storeCode), 'en', {numeric:true, sensitivity:'base'}) : prioritySort === 'orders' ? Number(a.orders) - Number(b.orders) : a.rank - b.rank;
      return (priorityDirection === 'asc' ? value : -value) || a.rank - b.rank;
    });
    const pages = Math.max(1, Math.ceil(rows.length / size));
    priorityPage = Math.min(Math.max(1, priorityPage), pages);
    $('priority-message').textContent = 'From ' + priorityData.starts[priorityPeriod] + ' to ' + priorityData.today + ' · ' + rows.length + ' stores';
    $('priority-results').innerHTML = rows.length ? '<div class="priority-table"><table><thead><tr>' + [['rank','Rank'],['storeCode','Store code'],['orders','Orders']].map(([key,label]) => '<th scope="col" aria-sort="' + (prioritySort === key ? (priorityDirection === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-priority-sort="' + key + '">' + label + ' <span aria-hidden="true">' + (prioritySort === key ? (priorityDirection === 'asc' ? '↑' : '↓') : '↕') + '</span></button></th>').join('') + '</tr></thead><tbody>' + sortedRows.slice((priorityPage - 1) * size, priorityPage * size).map(row => '<tr><td>' + row.rank + '</td><td><strong>' + esc(row.storeCode) + '</strong></td><td>' + row.orders + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="medicine-state" role="status"><strong>No orders in this period</strong><p>Store rankings will appear when orders are placed.</p></div>';
    $('priority-page').textContent = 'Page ' + priorityPage + ' of ' + pages + ' · ' + rows.length + ' stores';
    $('priority-prev').disabled = priorityPage <= 1; $('priority-next').disabled = priorityPage >= pages;
    const jump = $('priority-jump'); jump.elements.page.value = priorityPage; jump.elements.page.max = pages; jump.elements.page.disabled = !rows.length; jump.querySelector('button').disabled = !rows.length;
  }
  async function loadPriority() {
    const seq = ++prioritySeq, epoch = authEpoch; $('priority-message').textContent = 'Loading rankings…';
    try { const data = await request('/api/admin/order-priority'); if (seq !== prioritySeq || epoch !== authEpoch) return; priorityData = data; renderPriority(); }
    catch (error) { if (seq === prioritySeq && epoch === authEpoch) { priorityData = null; $('priority-results').replaceChildren(); $('priority-chart').replaceChildren(); $('priority-message').textContent = error.message; } }
  }
  document.querySelectorAll('[data-priority-period]').forEach(button => button.onclick = () => { priorityPeriod = button.dataset.priorityPeriod; priorityPage = 1; document.querySelectorAll('[data-priority-period]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderPriority(); });
  $('priority-results').addEventListener('click', event => {
    const button = event.target.closest('[data-priority-sort]'); if (!button) return;
    const key = button.dataset.prioritySort;
    priorityDirection = prioritySort === key ? (priorityDirection === 'asc' ? 'desc' : 'asc') : (key === 'orders' ? 'desc' : 'asc');
    prioritySort = key; priorityPage = 1; renderPriority();
    $('priority-results').querySelector('[data-priority-sort="' + key + '"]').focus();
  });
  $('priority-refresh').onclick = loadPriority;
  $('priority-size').onchange = () => { priorityPage = 1; renderPriority(); };
  $('priority-prev').onclick = () => { if (priorityPage > 1) { priorityPage--; renderPriority(); } };
  $('priority-next').onclick = () => { priorityPage++; renderPriority(); };
  $('priority-jump').onsubmit = event => { event.preventDefault(); if (!event.currentTarget.elements.page.reportValidity()) return; priorityPage = Number(event.currentTarget.elements.page.value); renderPriority(); };
  let docketPriorityData = null, docketPriorityPeriod = 'weekly', docketPriorityPage = 1, docketPrioritySeq = 0, docketPrioritySort = 'rank', docketPriorityDirection = 'asc';
  function renderDocketPriority() {
    if (!docketPriorityData) return;
    const rows = docketPriorityData.rankings[docketPriorityPeriod], size = Number($('docket-priority-size').value);
    renderPriorityChart('docket-priority-chart', rows, 'count', 'Docket records');
    const sortedRows = rows.map((row, index) => ({...row, rank:index + 1})).sort((a,b) => {
      const value = docketPrioritySort === 'storeCode' ? String(a.storeCode).localeCompare(String(b.storeCode), 'en', {numeric:true, sensitivity:'base'}) : docketPrioritySort === 'count' ? Number(a.count) - Number(b.count) : a.rank - b.rank;
      return (docketPriorityDirection === 'asc' ? value : -value) || a.rank - b.rank;
    });
    const pages = Math.max(1, Math.ceil(rows.length / size));
    docketPriorityPage = Math.min(Math.max(1, docketPriorityPage), pages);
    $('docket-priority-message').textContent = 'From ' + docketPriorityData.starts[docketPriorityPeriod] + ' to ' + docketPriorityData.today + ' · ' + rows.length + ' stores';
    $('docket-priority-results').innerHTML = rows.length ? '<div class="priority-table"><table><thead><tr>' + [['rank','Rank'],['storeCode','Store code'],['count','Docket records']].map(([key,label]) => '<th scope="col" aria-sort="' + (docketPrioritySort === key ? (docketPriorityDirection === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-priority-sort="' + key + '">' + label + ' <span aria-hidden="true">' + (docketPrioritySort === key ? (docketPriorityDirection === 'asc' ? '↑' : '↓') : '↕') + '</span></button></th>').join('') + '</tr></thead><tbody>' + sortedRows.slice((docketPriorityPage - 1) * size, docketPriorityPage * size).map(row => '<tr><td>' + row.rank + '</td><td><strong>' + esc(row.storeCode) + '</strong></td><td>' + row.count + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="medicine-state" role="status"><strong>No docket records in this period</strong><p>Store rankings will appear when docket records are available.</p></div>';
    $('docket-priority-page').textContent = 'Page ' + docketPriorityPage + ' of ' + pages + ' · ' + rows.length + ' stores';
    $('docket-priority-prev').disabled = docketPriorityPage <= 1; $('docket-priority-next').disabled = docketPriorityPage >= pages;
    const jump = $('docket-priority-jump'); jump.elements.page.value = docketPriorityPage; jump.elements.page.max = pages; jump.elements.page.disabled = !rows.length; jump.querySelector('button').disabled = !rows.length;
  }
  async function loadDocketPriority() {
    const seq = ++docketPrioritySeq, epoch = authEpoch; $('docket-priority-message').textContent = 'Loading rankings…';
    try { const data = await request('/api/admin/docket-priority'); if (seq !== docketPrioritySeq || epoch !== authEpoch) return; docketPriorityData = data; renderDocketPriority(); }
    catch (error) { if (seq === docketPrioritySeq && epoch === authEpoch) { docketPriorityData = null; $('docket-priority-results').replaceChildren(); $('docket-priority-chart').replaceChildren(); $('docket-priority-message').textContent = error.message; } }
  }
  document.querySelectorAll('[data-docket-priority-period]').forEach(button => button.onclick = () => { docketPriorityPeriod = button.dataset.docketPriorityPeriod; docketPriorityPage = 1; document.querySelectorAll('[data-docket-priority-period]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderDocketPriority(); });
  $('docket-priority-results').addEventListener('click', event => {
    const button = event.target.closest('[data-priority-sort]'); if (!button) return;
    const key = button.dataset.prioritySort;
    docketPriorityDirection = docketPrioritySort === key ? (docketPriorityDirection === 'asc' ? 'desc' : 'asc') : (key === 'count' ? 'desc' : 'asc');
    docketPrioritySort = key; docketPriorityPage = 1; renderDocketPriority();
    $('docket-priority-results').querySelector('[data-priority-sort="' + key + '"]').focus();
  });
  $('docket-priority-refresh').onclick = loadDocketPriority;
  $('docket-priority-size').onchange = () => { docketPriorityPage = 1; renderDocketPriority(); };
  $('docket-priority-prev').onclick = () => { if (docketPriorityPage > 1) { docketPriorityPage--; renderDocketPriority(); } };
  $('docket-priority-next').onclick = () => { docketPriorityPage++; renderDocketPriority(); };
  $('docket-priority-jump').onsubmit = event => { event.preventDefault(); if (!event.currentTarget.elements.page.reportValidity()) return; docketPriorityPage = Number(event.currentTarget.elements.page.value); renderDocketPriority(); };
  let reorderRows = [], reorderPage = 1, customerRows = [], customerPage = 1, featureSeq = 0, notificationBusy = false;
  const purchaseSelection = new Map();
  let reorderSort = 'recentDemand', reorderDirection = 'desc';
  function featureTable(headers, rows) { return '<div class="priority-table"><table><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(value => '<td>' + esc(value ?? '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'; }
  function renderFeaturePage(kind) {
    const isReorder = kind === 'reorder', rows = isReorder ? reorderRows : customerRows, size = Number($(kind + '-size').value), pages = Math.max(1, Math.ceil(rows.length / size));
    let page = isReorder ? reorderPage : customerPage; page = Math.min(Math.max(1, page), pages); if (isReorder) reorderPage = page; else customerPage = page;
    const sorted = isReorder ? rows.map((row,index) => ({row,index})).sort((a,b) => {
      const valueOf = row => reorderSort === 'selected' ? Number(purchaseSelection.has(String(row.code))) : reorderSort === 'purchase' ? Number(purchaseSelection.get(String(row.code)) || 0) : row[reorderSort];
      const left = valueOf(a.row), right = valueOf(b.row);
      const value = ['quantity','recentDemand','selected','purchase'].includes(reorderSort) ? Number(left || 0) - Number(right || 0) : String(left ?? '').localeCompare(String(right ?? ''), 'en', {numeric:true,sensitivity:'base'});
      return (reorderDirection === 'asc' ? value : -value) || a.index - b.index;
    }).map(item => item.row) : rows;
    const part = sorted.slice((page - 1) * size, page * size);
    $(kind + '-results').innerHTML = !rows.length ? '<div class="medicine-state" role="status">No matching records found.</div>' : isReorder ? '<div class="priority-table"><table><thead><tr>' + [['selected','Select'],['code','DC'],['name','Medicine'],['quantity','Available'],['recentDemand','Ordered · 30 days'],['purchase','Purchase quantity']].map(([key,label]) => '<th scope="col" aria-sort="' + (reorderSort === key ? (reorderDirection === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-priority-sort="' + key + '">' + label + ' <span aria-hidden="true">' + (reorderSort === key ? (reorderDirection === 'asc' ? '↑' : '↓') : '↕') + '</span></button></th>').join('') + '</tr></thead><tbody>' + part.map(r => '<tr><td><input type="checkbox" data-purchase-select="' + esc(r.code) + '" aria-label="Select ' + esc(r.name) + '"' + (purchaseSelection.has(String(r.code)) ? ' checked' : '') + '></td><td>' + esc(r.code) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.quantity) + '</td><td>' + esc(r.recentDemand) + '</td><td><input class="purchase-quantity" type="number" min="1" step="1" inputmode="numeric" data-purchase-quantity="' + esc(r.code) + '" aria-label="Purchase quantity for ' + esc(r.name) + '" value="' + esc(purchaseSelection.get(String(r.code)) || '') + '"' + (purchaseSelection.has(String(r.code)) ? '' : ' disabled') + '></td></tr>').join('') + '</tbody></table></div>' : featureTable(['Order date · IST','Order reference','Current status','Items'],part.map(r => [new Date(r.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),r.id,r.status,r.items]));
    $(kind + '-page').textContent = 'Page ' + page + ' of ' + pages + ' · ' + rows.length + ' records'; $(kind + '-prev').disabled = page <= 1; $(kind + '-next').disabled = page >= pages;
  }
  async function loadReorder() { const seq = ++featureSeq, epoch = authEpoch; $('reorder-results').replaceChildren(); $('reorder-message').textContent = 'Loading suggestions…'; try { const d = await request('/api/admin/reorder-suggestions'); if (seq !== featureSeq || epoch !== authEpoch) return; reorderRows = d.items; const validCodes = new Set(reorderRows.map(row => String(row.code))); for(const code of purchaseSelection.keys()) if(!validCodes.has(code)) purchaseSelection.delete(code); reorderPage = 1; renderFeaturePage('reorder'); updatePurchaseControls(); $('reorder-message').textContent = reorderRows.length + ' low-stock medicines'; } catch(e) { if(epoch === authEpoch) $('reorder-message').textContent = e.message; } }
  async function loadCustomer(store) { const seq = ++featureSeq, epoch = authEpoch; $('customer-history-results').replaceChildren(); $('customer-history-message').textContent = 'Loading history…'; try { const d = await request('/api/admin/customer-orders?' + new URLSearchParams({store})); if(seq !== featureSeq || epoch !== authEpoch) return; customerRows = d.items; customerPage = 1; renderFeaturePage('customer-history'); $('customer-history-message').textContent = 'Store ' + d.store + ' · ' + customerRows.length + ' orders'; } catch(e) { if(epoch === authEpoch) $('customer-history-message').textContent = e.message; } }
  function updatePurchaseControls() { $('purchase-download').disabled = !purchaseSelection.size; $('purchase-clear').disabled = !purchaseSelection.size; $('purchase-message').textContent = purchaseSelection.size + ' selected · Enter a purchase quantity for each medicine.'; }
  $('reorder-results').addEventListener('click', event => {
    const button = event.target.closest('[data-priority-sort]'); if (!button) return;
    const key = button.dataset.prioritySort;
    reorderDirection = reorderSort === key ? (reorderDirection === 'asc' ? 'desc' : 'asc') : (['selected','purchase','recentDemand'].includes(key) ? 'desc' : 'asc');
    reorderSort = key; reorderPage = 1; renderFeaturePage('reorder');
    $('reorder-results').querySelector('[data-priority-sort="' + key + '"]').focus();
  });
  $('reorder-results').addEventListener('change', e => { const box = e.target.closest('[data-purchase-select]'); if(!box)return; const code = box.dataset.purchaseSelect; if(box.checked) purchaseSelection.set(code, ''); else purchaseSelection.delete(code); const quantity = box.closest('tr').querySelector('[data-purchase-quantity]'); quantity.disabled = !box.checked; if(!box.checked) quantity.value=''; updatePurchaseControls(); });
  $('reorder-results').addEventListener('input', e => { const input=e.target.closest('[data-purchase-quantity]'); if(input && purchaseSelection.has(input.dataset.purchaseQuantity)) purchaseSelection.set(input.dataset.purchaseQuantity,input.value); });
  $('purchase-clear').onclick = () => { purchaseSelection.clear(); renderFeaturePage('reorder'); updatePurchaseControls(); };
  $('purchase-download').onclick = async () => { const chosen = reorderRows.filter(row => purchaseSelection.has(String(row.code))); if(chosen.length !== purchaseSelection.size || chosen.some(row => !/^[1-9]\d*$/.test(purchaseSelection.get(String(row.code)) || '') || !Number.isSafeInteger(Number(purchaseSelection.get(String(row.code)))))) { $('purchase-message').textContent = 'Enter a whole-number purchase quantity greater than zero for every selected medicine.'; return; } const button=$('purchase-download');button.disabled=true;try { await loadOrderExcel(); const book=new ExcelJS.Workbook(), sheet=book.addWorksheet('Purchase list'); sheet.columns=[{header:'DC',key:'code',width:18},{header:'Medicine',key:'name',width:58},{header:'Available quantity',key:'quantity',width:22},{header:'Ordered last 30 days',key:'recentDemand',width:24},{header:'Purchase quantity',key:'purchase',width:22}];chosen.forEach(row=>sheet.addRow({...row,purchase:Number(purchaseSelection.get(String(row.code)))}));sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];const bytes=await book.xlsx.writeBuffer(),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download='Purchase-List-'+new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date())+'.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);$('purchase-message').textContent=chosen.length+' medicines exported.';} catch(error){$('purchase-message').textContent=error.message||'Purchase list could not be downloaded.'}finally{button.disabled=!purchaseSelection.size;} };
  $('reorder-refresh').onclick = loadReorder;
  $('customer-history-form').onsubmit = e => { e.preventDefault(); loadCustomer(e.currentTarget.elements.store.value.trim()); };
  for (const kind of ['reorder','customer-history']) { $(kind + '-size').onchange = () => { if(kind === 'reorder') reorderPage = 1; else customerPage = 1; renderFeaturePage(kind); }; $(kind + '-prev').onclick = () => { if(kind === 'reorder') reorderPage--; else customerPage--; renderFeaturePage(kind); }; $(kind + '-next').onclick = () => { if(kind === 'reorder') reorderPage++; else customerPage++; renderFeaturePage(kind); }; }
  document.addEventListener('click', e => { const button = e.target.closest('[data-store-history]'); if(!button || !token) return; const store = button.dataset.storeHistory; $('customer-history-form').elements.store.value = store; selectAdminView('customer-history'); loadCustomer(store); });
  $('records-export-form').onsubmit = async e => { e.preventDefault(); const form=e.currentTarget, button=form.querySelector('button'), q=new URLSearchParams(new FormData(form)), status=$('records-export-message'); if(q.get('from') && q.get('to') && q.get('from') > q.get('to')) { status.textContent='From date must be before or equal to To date.'; return; } button.disabled=true; status.textContent='Preparing export…'; try { const d=await request('/api/admin/export-records?'+q); await loadOrderExcel(); const book=new ExcelJS.Workbook(), sheet=book.addWorksheet(q.get('type') === 'orders' ? 'Orders' : 'Dockets'); const columns=q.get('type')==='orders' ? [['date','Order date'],['store','Store code'],['mobile','Mobile'],['reference','Order reference'],['status','Status'],['courier','Courier'],['docket','Docket'],['itemCount','Item count']] : [['date','Dispatch date'],['store','Store code'],['owner','Owner'],['mobile','Mobile'],['docket','Docket'],['courier','Courier'],['tracking','Tracking'],['status','Status'],['boxes','Boxes'],['items','Items']]; sheet.columns=columns.map(([key,header])=>({key,header,width:22})); d.items.forEach(row=>sheet.addRow(row)); sheet.getRow(1).font={bold:true}; sheet.views=[{state:'frozen',ySplit:1}]; sheet.autoFilter={from:'A1',to:{row:1,column:columns.length}}; const bytes=await book.xlsx.writeBuffer(), url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})), link=document.createElement('a'); link.href=url;link.download='Radhika-'+q.get('type')+'-'+new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date())+'.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent=d.items.length+' records exported.'; } catch(error) { status.textContent=error.message; } finally {button.disabled=false;} };
  async function refreshNotifications() { if (employeeMode || !token || notificationBusy || document.hidden) return; notificationBusy = true; const epoch=authEpoch; try { const d=await request('/api/admin/notification-summary'); if(epoch!==authEpoch)return; $('admin-notifications').hidden=false; for(const [key,value] of [['new',d.newOrders],['low',d.lowStock],['pending',d.pendingDispatch]]) document.querySelector('[data-notification="'+key+'"] span').textContent=Number(value)||0; $('notification-message').textContent=''; } catch(e) { if(epoch===authEpoch && token) { $('admin-notifications').hidden=false; document.querySelectorAll('#admin-notifications button span').forEach(span => span.textContent='—'); $('notification-message').textContent='Alerts unavailable. Refresh to retry.'; } } finally {notificationBusy=false;} }
  $('admin-notifications').onclick = e => { const button=e.target.closest('[data-notification]'); if(!button)return; const kind=button.dataset.notification; if(kind==='low'){ selectAdminView('alerts'); if(!alertSettings)loadAlerts(); } else { overdueOnly=false;pendingOnly=kind==='pending';page=1;$('search').value='';$('status-filter').value=kind==='new'?'New':'';selectAdminView('orders');load(); } };
  setInterval(refreshNotifications,60000);
  let reportSeq=0, dispatchData=null, dispatchPeriod='weekly', dispatchPage=1, dispatchSort='dispatched_at', dispatchDirection='desc';
  function renderDispatch() {
    if (!dispatchData) return;
    const part = dispatchData.periods[dispatchPeriod], size = Number($('dispatch-size').value);
    const pages = Math.max(1, Math.ceil(part.items.length / size));
    dispatchPage = Math.min(Math.max(1, dispatchPage), pages);
    $('dispatch-message').textContent = 'From ' + dispatchData.starts[dispatchPeriod] + ' to ' + dispatchData.today + ' · ' + dispatchData.unknown + ' dispatched/delivered orders have no valid dispatch timestamp (all time) and are excluded.';
    $('dispatch-summary').innerHTML = [['Dispatched',part.onTime+part.delayed],['On time',part.onTime],['Delayed',part.delayed]].map(([label,value]) => '<div class="orders-stat"><span>' + label + '</span><strong>' + value + '</strong></div>').join('');
    const sorted = part.items.map((row,index) => ({row,index})).sort((a,b) => {
      const left = a.row[dispatchSort], right = b.row[dispatchSort];
      const value = ['created_at','dispatched_at'].includes(dispatchSort) ? new Date(left).getTime() - new Date(right).getTime() : dispatchSort === 'hours' ? Number(left) - Number(right) : String(left ?? '').localeCompare(String(right ?? ''), 'en', {numeric:true,sensitivity:'base'});
      return (dispatchDirection === 'asc' ? value : -value) || a.index - b.index;
    });
    const rows = sorted.slice((dispatchPage-1)*size,dispatchPage*size).map(item => item.row);
    const headers = [['store','Store'],['id','Order reference'],['created_at','Ordered · IST'],['dispatched_at','Dispatched · IST'],['hours','Time (hours)'],['result','Result']];
    $('dispatch-results').innerHTML = rows.length ? '<div class="priority-table"><table><thead><tr>' + headers.map(([key,label]) => '<th scope="col" aria-sort="' + (dispatchSort === key ? (dispatchDirection === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-priority-sort="' + key + '">' + label + ' <span aria-hidden="true">' + (dispatchSort === key ? (dispatchDirection === 'asc' ? '↑' : '↓') : '↕') + '</span></button></th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + [r.store,r.id,new Date(r.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),new Date(r.dispatched_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),r.hours,r.result==='onTime'?'On time':'Delayed'].map(value => '<td>' + esc(value ?? '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<div class="medicine-state" role="status">No dispatched orders in this period.</div>';
    $('dispatch-page').textContent = 'Page ' + dispatchPage + ' of ' + pages + ' · ' + part.items.length + ' orders';
    $('dispatch-prev').disabled = dispatchPage <= 1; $('dispatch-next').disabled = dispatchPage >= pages;
  }
  $('dispatch-results').addEventListener('click', event => {
    const button = event.target.closest('[data-priority-sort]'); if (!button) return;
    const key = button.dataset.prioritySort;
    dispatchDirection = dispatchSort === key ? (dispatchDirection === 'asc' ? 'desc' : 'asc') : (['created_at','dispatched_at','hours'].includes(key) ? 'desc' : 'asc');
    dispatchSort = key; dispatchPage = 1; renderDispatch();
    $('dispatch-results').querySelector('[data-priority-sort="' + key + '"]').focus();
  });
  async function loadDispatch() {const seq=++reportSeq,epoch=authEpoch;$('dispatch-message').textContent='Loading dispatch report…';$('dispatch-results').replaceChildren();$('dispatch-summary').replaceChildren();try{const d=await request('/api/admin/dispatch-performance');if(seq!==reportSeq||epoch!==authEpoch)return;dispatchData=d;dispatchPage=1;renderDispatch()}catch(e){if(seq===reportSeq&&epoch===authEpoch)$('dispatch-message').textContent=e.message}}
  let workloadRows = [], workloadSort = 'name', workloadDirection = 'asc';
  function renderWorkload() {
    const headers = [['name','Employee'],['assigned','Assigned'],['pending','Pending'],['complete','Complete'],['cancelled','Cancelled'],['other','Other']];
    const sorted = workloadRows.map((row,index) => ({row,index})).sort((a,b) => {
      const value = workloadSort === 'name' ? String(a.row.name || '').localeCompare(String(b.row.name || ''), 'en', {numeric:true,sensitivity:'base'}) : Number(a.row[workloadSort] || 0) - Number(b.row[workloadSort] || 0);
      return (workloadDirection === 'asc' ? value : -value) || a.index - b.index;
    });
    $('workload-results').innerHTML = sorted.length ? '<div class="priority-table"><table><thead><tr>' + headers.map(([key,label]) => '<th scope="col" aria-sort="' + (workloadSort === key ? (workloadDirection === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-priority-sort="' + key + '">' + label + ' <span aria-hidden="true">' + (workloadSort === key ? (workloadDirection === 'asc' ? '↑' : '↓') : '↕') + '</span></button></th>').join('') + '</tr></thead><tbody>' + sorted.map(({row:r}) => '<tr>' + [r.name+(r.active?'':' (inactive)'),r.assigned,r.pending,r.complete,r.cancelled,r.other].map(value => '<td>' + esc(value ?? '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<div class="medicine-state">No employee assignments yet.</div>';
  }
  $('workload-results').addEventListener('click', event => {
    const button = event.target.closest('[data-priority-sort]'); if (!button) return;
    const key = button.dataset.prioritySort;
    workloadDirection = workloadSort === key ? (workloadDirection === 'asc' ? 'desc' : 'asc') : (key === 'name' ? 'asc' : 'desc');
    workloadSort = key; renderWorkload();
    $('workload-results').querySelector('[data-priority-sort="' + key + '"]').focus();
  });
  async function loadWorkload() {const seq=++reportSeq,epoch=authEpoch;$('workload-message').textContent='Loading workload…';$('workload-results').replaceChildren();try{const d=await request('/api/admin/employee-workload');if(seq!==reportSeq||epoch!==authEpoch)return;workloadRows=d.items;$('workload-message').textContent=d.items.length+' employees / groups';renderWorkload()}catch(e){if(seq===reportSeq&&epoch===authEpoch)$('workload-message').textContent=e.message}}
  document.querySelectorAll('[data-dispatch-period]').forEach(button=>button.onclick=()=>{dispatchPeriod=button.dataset.dispatchPeriod;dispatchPage=1;document.querySelectorAll('[data-dispatch-period]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderDispatch()});
  $('dispatch-refresh').onclick=loadDispatch;$('workload-refresh').onclick=loadWorkload;$('dispatch-size').onchange=()=>{dispatchPage=1;renderDispatch()};$('dispatch-prev').onclick=()=>{dispatchPage--;renderDispatch()};$('dispatch-next').onclick=()=>{dispatchPage++;renderDispatch()};
  function selectAdminView(view) {
    if (employeeMode && !employeeSections.includes(view)) return;
    if (employeeMode && view === 'orders' && token) load();
    if (employeeMode && view === 'dashboard' && token) loadInsights();
    if (view === 'dispatch-report' && token) loadDispatch();
    if (view === 'employee-workload' && token) loadWorkload();
    if (view === 'reorder' && token) loadReorder();
    if (view === 'priority' && token) loadPriority();
    if (view === 'docket-priority' && token) loadDocketPriority();
    if (view === 'kendras' && token) loadAdminProfiles();
    if (view === 'demands' && token) loadAdminDemands();
    if (view === 'operations' && token) loadOperations();
    if (view === 'dockets' && token) loadDocketRecords();
    if ((view === 'employees' || view === 'employee-accounts') && token) EmployeeAdmin.load(request, view);
    if (view === 'stock' && token) loadManagedStock();
    if (view === 'alerts' && token && !alertSettings) loadAlerts();
    for (const name of ['dashboard', 'orders', 'priority', 'docket-priority', 'dispatch-report', 'employee-workload', 'reorder', 'customer-history', 'exports', 'alerts', 'operations', 'kendras', 'demands', 'stock', 'dockets', 'employees', 'employee-accounts'])
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
    adminDemandPages = 1,
    adminProfilePage = 1,
    adminProfilePages = 1,
    adminProfileSort = '',
    adminProfileDirection = 'asc',
    demandsBusy = false,
    profilesBusy = false;
  async function loadAdminDemands() {
    if (!token || demandsBusy) return;
    demandsBusy = true;
    $('admin-demand-size').disabled = true;
    $('admin-demand-search').querySelector('button').disabled = true;
    $('admin-demand-previous').disabled = true;
    $('admin-demand-next').disabled = true;
    $('admin-demand-jump').querySelector('button').disabled = true;
    $('admin-demand-message').textContent = 'Loading demand requests…';
    try {
      const form = $('admin-demand-search'),
        data = await request(
          '/api/admin/demands?' +
            new URLSearchParams({
              q: form.elements.q.value,
              status: form.elements.status.value,
              page: adminDemandPage,
              size: $('admin-demand-size').value,
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
      adminDemandPage = Number(data.page) || adminDemandPage;
      adminDemandPages = Number(data.pages) || Math.max(1, Math.ceil(data.total / Number($('admin-demand-size').value)));
      $('admin-demand-page').textContent =
        'Page ' +
        adminDemandPage +
        ' of ' +
        adminDemandPages +
        ' · ' +
        data.total +
        ' requests';
      $('admin-demand-previous').disabled = adminDemandPage <= 1;
      $('admin-demand-next').disabled = adminDemandPage >= adminDemandPages;
      $('admin-demand-jump-input').value = adminDemandPage;
      $('admin-demand-jump-input').max = adminDemandPages;
      $('admin-demand-message').textContent = '';
    } catch (error) {
      $('admin-demand-message').textContent = error.message;
    } finally {
      demandsBusy = false;
      $('admin-demand-size').disabled = false;
      $('admin-demand-search').querySelector('button').disabled = false;
      $('admin-demand-previous').disabled = adminDemandPage <= 1;
      $('admin-demand-next').disabled = adminDemandPage >= adminDemandPages;
      $('admin-demand-jump').querySelector('button').disabled = false;
    }
  }
  async function loadAdminProfiles() {
    if (!token || profilesBusy) return;
    profilesBusy = true;
    $('admin-profile-size').disabled = true;
    $('admin-profile-search').querySelector('button').disabled = true;
    $('admin-profile-previous').disabled = true;
    $('admin-profile-next').disabled = true;
    $('admin-profile-jump').querySelector('button').disabled = true;
    $('admin-profiles').textContent = 'Loading profiles…';
    try {
      const data = await request(
        '/api/admin/kendras?' +
          new URLSearchParams({
            q: $('admin-profile-search').elements.q.value,
            page: adminProfilePage,
            size: $('admin-profile-size').value,
            sort: adminProfileSort,
            direction: adminProfileDirection,
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
        const keys = ['store','contact','mobile','address','gst','dl20','dl21'];
        profileTable.querySelectorAll('thead th').forEach((th, index) => {
          const key = keys[index], label = th.textContent, active = key === adminProfileSort;
          th.setAttribute('scope', 'col');
          th.setAttribute('aria-sort', active ? (adminProfileDirection === 'asc' ? 'ascending' : 'descending') : 'none');
          th.innerHTML = '<button type="button" class="medicine-sort" data-profile-sort="' + key + '">' + esc(label) + '<span aria-hidden="true">' + (active ? (adminProfileDirection === 'asc' ? '↑' : '↓') : '↕') + '</span></button>';
        });
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
      adminProfilePage = Number(data.page) || adminProfilePage;
      adminProfilePages = Number(data.pages) || Math.max(1, Math.ceil(data.total / Number($('admin-profile-size').value)));
      $('admin-profile-page').textContent =
        'Page ' +
        adminProfilePage +
        ' of ' +
        adminProfilePages +
        ' · ' +
        data.total +
        ' profiles';
      $('admin-profile-previous').disabled = adminProfilePage <= 1;
      $('admin-profile-next').disabled = adminProfilePage >= adminProfilePages;
      $('admin-profile-jump-input').value = adminProfilePage;
      $('admin-profile-jump-input').max = adminProfilePages;
    } catch (error) {
      $('admin-profiles').textContent = error.message;
    } finally {
      profilesBusy = false;
      $('admin-profile-size').disabled = false;
      $('admin-profile-search').querySelector('button').disabled = false;
      $('admin-profile-previous').disabled = adminProfilePage <= 1;
      $('admin-profile-next').disabled = adminProfilePage >= adminProfilePages;
      $('admin-profile-jump').querySelector('button').disabled = false;
    }
  }
  $('admin-profiles').addEventListener('click', (event) => {
    const sortButton = event.target.closest('[data-profile-sort]');
    if (sortButton && token) {
      const key = sortButton.dataset.profileSort;
      adminProfileDirection = adminProfileSort === key && adminProfileDirection === 'asc' ? 'desc' : 'asc';
      adminProfileSort = key;
      adminProfilePage = 1;
      loadAdminProfiles().then(() => $('admin-profiles').querySelector('[data-profile-sort="' + key + '"]')?.focus());
      return;
    }
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
  $('admin-demand-size').onchange = () => {
    if (demandsBusy) return;
    adminDemandPage = 1;
    loadAdminDemands();
  };
  $('admin-demand-jump').onsubmit = (e) => {
    e.preventDefault();
    if (demandsBusy) return;
    const target = Number($('admin-demand-jump-input').value);
    if (!Number.isInteger(target) || target < 1 || target > adminDemandPages) return;
    adminDemandPage = target;
    loadAdminDemands();
  };
  $('admin-profile-search').onsubmit = (e) => {
    e.preventDefault();
    adminProfilePage = 1;
    loadAdminProfiles();
  };
  $('admin-profile-size').onchange = () => {
    if (profilesBusy) return;
    adminProfilePage = 1;
    loadAdminProfiles();
  };
  $('admin-profile-jump').onsubmit = (e) => {
    e.preventDefault();
    if (profilesBusy) return;
    const target = Number($('admin-profile-jump-input').value);
    if (!Number.isInteger(target) || target < 1 || target > adminProfilePages) return;
    adminProfilePage = target;
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
      $('operations-content').innerHTML = employeeMode ? '<p>Assigned orders only. Backups and access management are available to administrators.</p><h3>Pending email delivery</h3>' + (data.emailPending.length ? '<ul>' + data.emailPending.map(row => '<li>Store ' + esc(row.storeCode || '—') + ' · ' + esc(row.id) + ' · ' + esc(row.delivered || 0) + '/3 recipients</li>').join('') + '</ul>' : '<p>No pending deliveries.</p>') + '<h3>Possible duplicates</h3>' + (data.duplicates.length ? '<ul>' + data.duplicates.map(group => '<li>' + group.map(row => esc(row.id)).join(' · ') + '</li>').join('') + '</ul>' : '<p>No possible duplicates in your assigned orders.</p>') : OperationsView.render(data);
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
  $('operations-content').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-clear-failures]');
    if (!button || button.disabled || !token || operationsBusy) return;
    if (!confirm('Clear this list and older recorded failures? Newer failures will still appear. Previous records remain stored.')) return;
    button.disabled = true;
    try {
      const result = await request('/api/admin/operations/clear-failures', {
        method: 'POST',
        body: JSON.stringify({ throughId: Number(button.dataset.clearFailures) }),
      });
      await loadOperations();
      $('operations-message').textContent = result.message;
    } catch (error) {
      $('operations-message').textContent = error.message;
      button.disabled = false;
    }
  });
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
      else {
        const courier = String(latest.courier || '').replace(/&#(?:x20|32);/gi, ' ').trim();
        let url = '';
        try {
          const parsed = new URL(latest.trackUrl);
          if (parsed.protocol === 'https:' && ['www.delhivery.com', 'www.olslogistics.in', 'www.bluedart.com', 'www.dtdc.com', 'www.indiapost.gov.in', 'www.ekartlogistics.in', 'www.xpressbees.com', 'www.trackontrack.com', 'www.safexpress.com', 'www.gati.com', 'www.shadowfax.in', 'trk.ecount.in', 'tracking.xpindia.in'].includes(parsed.hostname)) url = parsed.href;
        } catch {}
        const name = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(courier) + ' ↗</a>' : esc(courier);
        const details = [latest.tracking || latest.docketNo, latest.dispatchDate ? 'Dispatched: ' + latest.dispatchDate : ''].filter(Boolean).map(esc).join(' · ');
        result.innerHTML = '<strong>' + esc(latest.status || 'Status') + '</strong><small>' + esc(order.docket ? 'Order docket' : 'Latest store docket') + '</small><span>' + [name, details].filter(Boolean).join(' · ') + '</span><small>Latest saved tracking status</small>';
      }
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
      if (missing) {
        link.download = 'Not-Available-' + String(order.storeCode || 'Unknown').replace(/[^a-zA-Z0-9-]/g, '') + '-' + id + '.xlsx';
      } else {
        const store = displayStoreCode(order.storeCode).replace(/[^a-zA-Z0-9-]/g, '') || 'Unknown';
        const created = new Date(order.created_at);
        const date = Number.isNaN(created.getTime()) ? 'Unknown-Date' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).format(created).replace(/\//g, '-');
        link.download = 'PMBJK_' + store + '_' + date + '.xlsx';
      }
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
    const saved = employeeMode ? sessionStorage.getItem('radhika-employee-token') : localStorage.getItem(sessionKey);
    if (employeeMode) {
      if (!saved) { location.href = 'employee.html'; return; }
      token = saved;
      document.body.dataset.role = 'employee';
      request('/api/employee/access').then(data => {
        employeeSections = data.sections;
        const notice = document.createElement('p'); notice.className = 'employee-scope-notice'; notice.textContent = 'Employee access · Order figures and history include only your assigned orders.'; $('panel').prepend(notice);
        document.querySelectorAll('[data-admin-view]').forEach(button => { button.hidden = !employeeSections.includes(button.dataset.adminView); });
        const upload = document.querySelector('a[href="stock-upload.html"]'); if (upload) upload.hidden = true;
        $('login-card').hidden = true; $('panel').hidden = false; $('logout').hidden = false;
        if (employeeSections.length) selectAdminView(employeeSections[0]);
        else { document.querySelectorAll('[id^="admin-view-"]').forEach(section => section.hidden = true); message('No sections assigned. Please contact your admin.'); }
      }).catch(error => { message(error.message, true); });
    } else if (saved && validSession(saved)) {
      token = saved;
      $('login-card').hidden = true;
      $('panel').hidden = false;
      $('logout').hidden = false;
      Promise.all([load(), loadInsights(), refreshNotifications()]).catch((error) => message(error.message, true));
    } else if (saved) localStorage.removeItem(sessionKey);
  } catch {}
})();
