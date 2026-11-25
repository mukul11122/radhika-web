(() => {
  'use strict';
  let records = [];
  let stockVersion = null;
  let unavailableItems = [];
  let loading = true;
  const $ = (id) => document.getElementById(id),
    money = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  let favourites = new Set(),
    quantities = {},
    savedMedicines = {},
    page = 1,
    favouritesOnly = false,
    sortKey = 'code',
    direction = 1;
  try {
    favourites = new Set(JSON.parse(localStorage.getItem('radhika-stock-favourites') || '[]'));
    quantities = JSON.parse(localStorage.getItem('radhika-stock-list') || '{}');
    savedMedicines = JSON.parse(localStorage.getItem('radhika-stock-list-details') || '{}') || {};
    unavailableItems = JSON.parse(localStorage.getItem('radhika-stock-unavailable') || '[]');
    if (!Array.isArray(unavailableItems)) unavailableItems = [];
    if (!quantities || Array.isArray(quantities) || typeof quantities !== 'object') {
      quantities = {};
      unavailableItems = [];
    }
  } catch {
    quantities = {};
    unavailableItems = [];
  }
  records.forEach((r) => {
    quantities[r.id] = Math.min(
      r.available,
      Math.max(0, Math.floor(Number(quantities[r.id]) || 0))
    );
  });
  function save() {
    try {
      for (const r of records)
        if (quantities[r.id] > 0) savedMedicines[r.id] = { code: r.code, name: r.name, uom: r.uom };
      for (const id of Object.keys(savedMedicines)) if (!quantities[id]) delete savedMedicines[id];
      localStorage.setItem('radhika-stock-favourites', JSON.stringify([...favourites]));
      localStorage.setItem('radhika-stock-list', JSON.stringify(quantities));
      localStorage.setItem('radhika-stock-list-details', JSON.stringify(savedMedicines));
      localStorage.setItem('radhika-stock-unavailable', JSON.stringify(unavailableItems));
    } catch {}
  }
  function filtered() {
    const q = $('stock-search').value.trim().toLowerCase(),
      group = $('stock-group').value;
    return records
      .filter(
        (r) =>
          (!group || r.group === group) &&
          (!favouritesOnly || favourites.has(r.id)) &&
          (!q ||
            [r.code, r.name, r.strength, r.batch, r.group, r.category]
              .join(' ')
              .toLowerCase()
              .includes(q))
      )
      .sort(
        (a, b) =>
          StockGrouping.searchRank(a, q) - StockGrouping.searchRank(b, q) ||
          StockGrouping.compare(a, b, sortKey, direction)
      );
  }
  function emptyStockMessage() {
    let title = records.length
        ? 'No medicines match these filters.'
        : 'No stock list uploaded yet.',
      detail = records.length
        ? 'Try another search or reset your filters.'
        : 'Uploaded stock will appear here.',
      action =
        '<a href="kendra.html?medicine=' +
        encodeURIComponent($('stock-search').value.trim()) +
        '#demand">Register medicine demand</a>';
    if (favouritesOnly) {
      if (!favourites.size) {
        title = 'No favourite medicines yet.';
        detail =
          'Click the ♡ beside a medicine to save it. Your saved favourites will appear here.';
        action = '<button type="button" data-show-all-stock>Browse all medicines</button>';
      } else if (!records.some((row) => favourites.has(row.id))) {
        title = 'Your favourite medicines are currently unavailable.';
        detail = 'None of your saved favourites are available in the current stock list.';
        action += ' <button type="button" data-show-all-stock>View all medicines</button>';
      } else {
        title = 'No favourites match your search.';
        detail = 'Clear the search or group filter to see your saved favourite medicines.';
        action =
          '<button type="button" data-clear-favourite-search>Clear search filters</button> <button type="button" data-show-all-stock>View all medicines</button>';
      }
    }
    return (
      '<tr><td colspan="10" class="stock-empty-cell"><div class="stock-empty"><strong>' +
      title +
      '</strong><p>' +
      detail +
      '</p><div>' +
      action +
      '</div></div></td></tr>'
    );
  }
  let exporting = false;
  function render() {
    $('stock-excel').disabled = loading || exporting || !records.length;
    $('order-import').disabled = loading || exporting || submitting || !records.length;
    document.querySelector('.stock-table-wrap').setAttribute('aria-busy', String(loading));
    if (loading) {
      $('record-count').textContent = '…';
      $('result-summary').textContent = '';
      $('stock-updated').textContent = 'Loading…';
      $('stock-rows').innerHTML =
        '<tr><td colspan="10"><div class="stock-loading" role="status" aria-label="Loading stock"><span class="stock-spinner" aria-hidden="true"></span><span class="stock-loading-message">Data is Loading, Please Wait</span></div></td></tr>';
      $('previous').disabled = true;
      $('next').disabled = true;
      $('page-number').disabled = true;
      $('page-jump').querySelector('button').disabled = true;
      return;
    }
    const rows = filtered(),
      size = Number($('page-size').value),
      pages = Math.max(1, Math.ceil(rows.length / size));
    page = Math.min(page, pages);
    const start = (page - 1) * size;
    $('record-count').textContent = records.length;
    $('result-summary').textContent = rows.length
      ? `Showing ${start + 1}–${Math.min(start + size, rows.length)} of ${rows.length} stock records`
      : records.length
        ? favouritesOnly
          ? favourites.size
            ? 'No favourite medicines to show'
            : 'No favourites saved yet'
          : 'No matching records'
        : 'No stock uploaded yet';
    $('stock-rows').innerHTML =
      rows
        .slice(start, start + size)
        .map(
          (r) =>
            `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.uom)}</td><td><div class="qty-control"><button type="button" data-qty-step="-1" aria-label="Decrease quantity for ${esc(r.name)}">−</button><input type="number" min="0" max="${r.available}" step="1" data-qty="${r.id}" value="${quantities[r.id] || ''}" placeholder="0" aria-label="Quantity for ${esc(r.name)}"><button type="button" data-qty-step="1" aria-label="Increase quantity for ${esc(r.name)}">+</button></div><small class="row-estimate" data-row-estimate="${r.id}" aria-live="polite">${quantities[r.id] ? (StockGrouping.total(r, quantities[r.id]) == null ? 'Confirm price' : 'Est. ' + money(StockGrouping.total(r, quantities[r.id]))) : ''}</small></td><td><button class="heart ${favourites.has(r.id) ? 'saved' : ''}" data-fav="${r.id}" aria-label="Favourite ${esc(r.name)}" aria-pressed="${favourites.has(r.id)}">${favourites.has(r.id) ? '♥' : '♡'}</button></td><td>${esc(r.batch)}</td><td>${esc(r.expiry)}</td><td><span class="quantity-pill">${r.available.toLocaleString('en-IN')}</span></td><td>${r.salesRateValues.map((v) => (v == null ? '—' : money(v))).join(' / ')}</td><td>${r.mrpValues.map((v) => (v == null ? '—' : money(v))).join(' / ')}</td></tr>`
        )
        .join('') || emptyStockMessage();
    const labels = [
      'DC',
      'Drug Name',
      'UOM',
      'Order QTY',
      'Fav',
      'Batch No',
      'Exp Date',
      'QTY',
      'Sales Rate',
      'MRP',
    ];
    document.querySelectorAll('#stock-rows tr').forEach((row) => {
      if (row.children.length === labels.length)
        Array.from(row.children).forEach((cell, i) => cell.setAttribute('data-label', labels[i]));
    });
    $('page-status').textContent = `Page ${page} of ${pages}`;
    $('previous').disabled = page === 1;
    $('next').disabled = page === pages;
    $('page-number').max = pages;
    $('page-number').value = page;
    $('page-number').disabled = !rows.length;
    $('page-jump').querySelector('button').disabled = !rows.length;
    $('fav-count').textContent = favourites.size;
    $('favourites').setAttribute('aria-pressed', String(favouritesOnly));
    document
      .querySelectorAll('[data-sort]')
      .forEach((b) =>
        b
          .closest('th')
          .setAttribute(
            'aria-sort',
            b.dataset.sort === sortKey ? (direction === 1 ? 'ascending' : 'descending') : 'none'
          )
      );
    renderCart();
  }
  function selected() {
    const byId = new Map(records.map((r) => [r.id, r]));
    return Object.keys(quantities)
      .filter((id) => quantities[id] > 0)
      .map((id) => {
        if (byId.has(id)) return byId.get(id);
        let code = id;
        try {
          code = JSON.parse(decodeURIComponent(id.replace(/^merged-/, '')))[0];
        } catch {}
        return {
          id,
          code,
          name: savedMedicines[id]?.name || 'Medicine ' + code,
          uom: savedMedicines[id]?.uom || '',
          available: 0,
          lots: [],
          salesRateValues: [],
          missing: true,
        };
      });
  }
  function syncProfileSummary() {
    const saved = window.KendraProfile?.forOrder(
      $('order-store').value.trim(),
      $('order-mobile').value.trim()
    );
    const box = $('order-profile-summary');
    box.textContent = saved
      ? 'Saved delivery: ' +
        [
          saved.profile.contactName,
          saved.profile.address,
          saved.profile.city,
          saved.profile.state,
          saved.profile.pincode,
          saved.profile.dlForm20 ? 'DL Form 20: ' + saved.profile.dlForm20 : '',
          saved.profile.dlForm21 ? 'DL Form 21: ' + saved.profile.dlForm21 : '',
          saved.profile.gst ? 'GSTIN: ' + saved.profile.gst : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : 'No saved delivery profile applied. You can save a Kendra profile to fill these details automatically.';
  }
  for (const id of ['order-store', 'order-mobile'])
    $(id).addEventListener('input', syncProfileSummary);
  window.KendraProfile?.refresh()
    .then((profile) => {
      if (profile) {
        if (!$('order-store').value) $('order-store').value = profile.storeCode;
        if (!$('order-mobile').value) $('order-mobile').value = profile.mobile;
      }
      syncProfileSummary();
    })
    .catch(() => syncProfileSummary());
  function renderCart() {
    document.querySelectorAll('[data-row-estimate]').forEach((box) => {
      const row = records.find((r) => r.id === box.dataset.rowEstimate),
        qty = quantities[box.dataset.rowEstimate] || 0;
      const total = row && qty ? StockGrouping.total(row, qty) : null;
      box.textContent = qty ? (total == null ? 'Confirm price' : 'Est. ' + money(total)) : '';
    });
    syncProfileSummary();
    const list = selected();
    $('cart-count').textContent = list.length;
    $('cart-items').innerHTML =
      list
        .map(
          (r) =>
            `<div class="cart-item"><div><strong>${esc(r.name)}</strong><small>${esc(r.code)} · ${quantities[r.id]} ${esc(r.uom)}${r.missing ? ' · No longer available in this batch/expiry' : quantities[r.id] > r.available ? ' · Only ' + r.available + ' available; reduce quantity' : ' × ' + r.salesRateValues.map((v) => (v == null ? '—' : money(v))).join(' / ')}</small></div><strong>${r.missing || quantities[r.id] > r.available || StockGrouping.total(r, quantities[r.id]) == null ? 'Check stock' : money(StockGrouping.total(r, quantities[r.id]))}</strong><button data-remove="${r.id}" aria-label="Remove ${esc(r.name)}">×</button></div>`
        )
        .join('') ||
      '<p class="cart-note">Your list is empty. Enter a quantity beside a medicine to add it.</p>';
    $('cart-total').textContent = list.some(
      (r) =>
        r.missing ||
        quantities[r.id] > r.available ||
        StockGrouping.total(r, quantities[r.id]) == null
    )
      ? 'Confirm price'
      : money(list.reduce((s, r) => s + StockGrouping.total(r, quantities[r.id]), 0));
    $('stock-selection-total').textContent = $('cart-total').textContent;
    syncSubmitState();
  }
  $('stock-search').addEventListener('input', () => {
    page = 1;
    render();
  });
  $('stock-group').addEventListener('change', () => {
    page = 1;
    render();
  });
  $('page-size').addEventListener('change', () => {
    page = 1;
    render();
  });
  $('clear-search').onclick = () => {
    $('stock-search').value = '';
    $('stock-group').value = '';
    favouritesOnly = false;
    page = 1;
    render();
  };
  $('favourites').onclick = () => {
    favouritesOnly = !favouritesOnly;
    page = 1;
    render();
  };
  $('previous').onclick = () => {
    page--;
    render();
  };
  $('next').onclick = () => {
    page++;
    render();
  };
  $('page-number').addEventListener('input', () => {
    const input = $('page-number'),
      target = Number(input.value),
      max = Math.max(1, Math.ceil(filtered().length / Number($('page-size').value)));
    if (!input.value || !Number.isInteger(target) || target < 1 || target > max || target === page)
      return;
    const cursor = input.value;
    page = target;
    render();
    input.value = cursor;
  });
  $('page-jump').addEventListener('submit', (e) => {
    e.preventDefault();
    const target = Number($('page-number').value),
      max = Math.max(1, Math.ceil(filtered().length / Number($('page-size').value)));
    if (!Number.isInteger(target) || target < 1 || target > max) return;
    page = target;
    render();
    document
      .querySelector('.stock-table-wrap')
      .scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelectorAll('[data-sort]').forEach(
    (b) =>
      (b.onclick = () => {
        direction = sortKey === b.dataset.sort ? -direction : 1;
        sortKey = b.dataset.sort;
        page = 1;
        render();
      })
  );
  $('stock-rows').addEventListener('click', (e) => {
    const step = e.target.closest('[data-qty-step]');
    if (step) {
      const input = step.closest('.qty-control').querySelector('[data-qty]');
      const id = input.dataset.qty;
      quantities[id] = Math.max(
        0,
        Math.min(
          Math.floor(Number(input.max)),
          (quantities[id] || 0) + Number(step.dataset.qtyStep)
        )
      );
      input.value = quantities[id] || '';
      save();
      renderCart();
      return;
    }
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    const id = b.dataset.fav;
    favourites.has(id) ? favourites.delete(id) : favourites.add(id);
    save();
    render();
  });
  $('stock-rows').addEventListener('click', (event) => {
    if (event.target.closest('[data-show-all-stock]')) $('clear-search').click();
    if (event.target.closest('[data-clear-favourite-search]')) {
      $('stock-search').value = '';
      $('stock-group').value = '';
      page = 1;
      render();
    }
  });
  $('stock-rows').addEventListener('input', (e) => {
    const input = e.target.closest('[data-qty]');
    if (!input) return;
    quantities[input.dataset.qty] = Math.max(
      0,
      Math.min(Number(input.max), Math.floor(Number(input.value) || 0))
    );
    save();
    renderCart();
  });
  $('stock-rows').addEventListener('change', (e) => {
    const input = e.target.closest('[data-qty]');
    if (input) input.value = quantities[input.dataset.qty] || '';
  });
  function orderStatus(state, title, detail = '') {
    const box = $('cart-message');
    box.replaceChildren();
    box.hidden = !state;
    box.dataset.state = state;
    box.setAttribute('role', state === 'error' ? 'alert' : 'status');
    if (!state) return;
    const heading = document.createElement('strong');
    heading.textContent = (state === 'success' ? '✓ ' : state === 'error' ? '! ' : '') + title;
    box.append(heading);
    if (detail) {
      const body = document.createElement('span');
      body.textContent = detail;
      box.append(body);
    }
    if (state !== 'pending') {
      box.focus({ preventScroll: true });
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  $('cart-open').onclick = () => {
    orderStatus('', '');
    syncProfileSummary();
    $('stock-cart').showModal();
  };
  $('cart-view').onclick = () => {
    $('stock-cart').classList.add('cart-expanded');
    $('cart-view').hidden = true;
    $('stock-cart').scrollTop = 0;
  };
  $('stock-cart').addEventListener('close', () => {
    $('stock-cart').classList.remove('cart-expanded');
    $('cart-view').hidden = false;
  });
  $('cart-close').onclick = () => $('stock-cart').close();
  $('cart-items').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (b) {
      delete quantities[b.dataset.remove];
      save();
      render();
    }
  });
  $('cart-clear').onclick = () => {
    quantities = {};
    unavailableItems = [];
    save();
    render();
  };
  let submitting = false,
    pendingSignature = '',
    pendingRequestId = '';
  function syncSubmitState() {
    const button = $('cart-download'),
      empty = !selected().length;
    button.disabled = submitting || empty;
    button.setAttribute('aria-busy', String(submitting));
    button.innerHTML = submitting
      ? '<span class="submit-spinner" aria-hidden="true"></span><span>Submitting…</span>'
      : 'Submit';
    $('cart-clear').disabled = submitting || empty;
    $('order-store').disabled = submitting;
    $('order-mobile').disabled = submitting;
    $('cart-items')
      .querySelectorAll('[data-remove]')
      .forEach((b) => (b.disabled = submitting));
  }
  try {
    const pending = JSON.parse(localStorage.getItem('radhika-pending-order') || 'null');
    if (pending) {
      pendingSignature = pending.signature;
      pendingRequestId = pending.requestId;
    }
  } catch {}
  $('cart-download').onclick = async () => {
    if (submitting || !selected().length) return;
    const storeField = $('order-store'),
      mobileField = $('order-mobile');
    storeField.value = storeField.value.trim();
    mobileField.value = mobileField.value.trim();
    if (!storeField.reportValidity() || !mobileField.reportValidity()) return;
    const storeCode = storeField.value,
      mobile = mobileField.value;
    submitting = true;
    syncSubmitState();
    orderStatus('pending', 'Checking current stock…');
    const previousVersion = stockVersion;
    if (!(await loadStock())) {
      submitting = false;
      syncSubmitState();
      orderStatus('error', 'Stock could not be checked', 'Your list is saved. Please try again.');
      return;
    }
    const issues = selected().filter((r) => r.missing || quantities[r.id] > r.available);
    if (issues.length || previousVersion !== stockVersion) {
      submitting = false;
      syncSubmitState();
      orderStatus(
        'error',
        'Please review your list',
        issues.length
          ? 'Stock has changed. Remove unavailable items or reduce quantities marked in your list, then submit again.'
          : 'The stock file has changed. Your list is saved; please review current prices and submit again.'
      );
      return;
    }
    const items = selected().map((r) => ({
      code: r.code,
      quantity: quantities[r.id],
      stockIds: r.lots.map((lot) => String(lot.id)),
    }));
    const savedProfile = window.KendraProfile?.forOrder(storeCode, mobile);
    const signature = JSON.stringify({
      items,
      unavailableItems,
      storeCode,
      mobile,
      stockVersion,
    });
    if (signature !== pendingSignature) {
      pendingRequestId = crypto.randomUUID();
      pendingSignature = signature;
      try {
        localStorage.setItem(
          'radhika-pending-order',
          JSON.stringify({ signature, requestId: pendingRequestId })
        );
      } catch {}
    }
    orderStatus('pending', 'Submitting your order…', 'Please wait while we send your list.');
    try {
      const response = await fetch('/api/stock/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: pendingRequestId,
          items,
          unavailableItems,
          storeCode,
          mobile,
          stockVersion,
          ...(savedProfile ? { profileToken: savedProfile.token } : {}),
        }),
      });
      const out = await response.json();
      if (
        out.orderReceived === true &&
        out.emailPending === true &&
        out.requestId === pendingRequestId
      ) {
        orderStatus(
          'success',
          'Order received — email pending',
          'Your order has been received and stock reserved. Please do not place this order again. Email delivery is pending. Reference: ' +
            out.requestId
        );
        return;
      }
      if (!response.ok || !out.ok)
        throw new Error(out.message || 'Submission failed. Please try again.');
      quantities = {};
      unavailableItems = [];
      save();
      await loadStock();
      orderStatus(
        'success',
        'Submitted Successfully',
        'Your order list has been emailed to Radhika Agencies. Reference: ' + out.requestId
      );
      pendingSignature = '';
      pendingRequestId = '';
      try {
        localStorage.removeItem('radhika-pending-order');
      } catch {}
    } catch (e) {
      orderStatus(
        'error',
        'Submission Failed',
        e.message || 'Please try again. Your selected medicines are still in the list.'
      );
    } finally {
      submitting = false;
      syncSubmitState();
    }
  };
  async function loadStock() {
    loading = true;
    render();
    try {
      const response = await fetch('/api/stock', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Stock could not be loaded.');
      const allItems = Array.isArray(data.items) ? data.items : [];
      let nextOffset = data.nextOffset;
      while (nextOffset != null) {
        const partResponse = await fetch(
          '/api/stock?offset=' + nextOffset + '&snapshot=' + encodeURIComponent(data.snapshotToken),
          { cache: 'no-store' }
        );
        const part = await partResponse.json();
        if (!partResponse.ok || !part.ok)
          throw new Error(part.message || 'Stock could not be loaded.');
        allItems.push(...part.items);
        nextOffset = part.nextOffset;
      }
      data.items = allItems;
      stockVersion = data.version;
      records = StockGrouping.merge(allItems).filter((r) => r.available > 0);
      save();
      localStorage.setItem('radhika-stock-version', String(data.version) + '-merged-v1');
      $('stock-group').innerHTML = '<option value="">All drug groups</option>';
      [...new Set(records.map((r) => r.group).filter(Boolean))].sort().forEach((g) => {
        const o = document.createElement('option');
        o.value = g;
        o.textContent = g;
        $('stock-group').append(o);
      });
      $('stock-updated').textContent = data.updatedAt
        ? 'Updated ' + new Date(data.updatedAt).toLocaleString('en-IN')
        : 'Waiting for stock upload';
      $('medicine-total').textContent = new Set(records.map((r) => r.code)).size.toLocaleString(
        'en-IN'
      );
      $('batch-total').textContent = (
        Array.isArray(data.items) ? data.items.length : 0
      ).toLocaleString('en-IN');
      loading = false;
      page = 1;
      render();
      return true;
    } catch (e) {
      loading = false;
      render();
      $('result-summary').textContent = e.message;
      $('stock-updated').textContent = 'Stock temporarily unavailable';
      $('stock-rows').innerHTML =
        '<tr><td colspan="10" style="text-align:center;padding:48px">Stock could not be loaded. Please refresh to try again.</td></tr>';
      return false;
    }
  }
  let excelLibrary;
  function loadExcel() {
    if (window.ExcelJS) return Promise.resolve();
    if (!excelLibrary)
      excelLibrary = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'js/vendor/exceljs.min.js';
        script.onload = resolve;
        script.onerror = () => {
          excelLibrary = null;
          script.remove();
          reject(new Error('Excel download could not start. Please try again.'));
        };
        document.head.append(script);
      });
    return excelLibrary;
  }
  $('stock-excel').onclick = async () => {
    if (loading || exporting || !records.length) return;
    exporting = true;
    const button = $('stock-excel');
    button.disabled = true;
    button.textContent = 'Preparing Excel…';
    button.setAttribute('aria-busy', 'true');
    try {
      await loadExcel();
      const rows = [...records].sort((a, b) => StockGrouping.compare(a, b));
      const book = StockExport.workbook(window.ExcelJS, rows, quantities);
      const buffer = await book.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download =
        'Radhika-Stock-' +
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()) +
        '.xlsx';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      alert(e.message || 'Excel download failed. Please try again.');
    } finally {
      exporting = false;
      button.textContent = '↓ Download Excel';
      button.setAttribute('aria-busy', 'false');
      button.disabled = loading || !records.length;
    }
  };
  $('order-import').onclick = () => {
    if (!loading && !submitting) $('order-import-file').click();
  };
  $('order-import-file').onchange = async () => {
    if (submitting || loading) return;
    const file = $('order-import-file').files[0];
    if (!file) return;
    const button = $('order-import');
    button.disabled = true;
    button.textContent = 'Reading order file…';
    try {
      if (file.size > 20 * 1024 * 1024 || !/\.(xlsx|csv)$/i.test(file.name))
        throw Error('Choose an .xlsx or CSV order file up to 20 MB.');
      let rows;
      const fileBuffer = await file.arrayBuffer();
      const signature = new Uint8Array(fileBuffer, 0, Math.min(4, fileBuffer.byteLength));
      const isWorkbook = signature[0] === 0x50 && signature[1] === 0x4b;
      if (!isWorkbook && /\.csv$/i.test(file.name)) rows = StockOrderImport.csv(await file.text());
      else {
        await loadExcel();
        const book = new window.ExcelJS.Workbook();
        await book.xlsx.load(fileBuffer);
        const sheet = book.getWorksheet('Stock') || book.worksheets[0];
        if (!sheet) throw Error('The Excel file has no worksheet.');
        rows = [];
        sheet.eachRow({ includeEmpty: true }, (row) => {
          rows.push(
            row.values
              .slice(1)
              .map((v) =>
                v && typeof v === 'object'
                  ? 'formula' in v || 'sharedFormula' in v
                    ? 'INVALID FORMULA'
                    : (v.text ?? v.result ?? '')
                  : v
              )
          );
        });
      }
      const items = StockOrderImport.parse(rows);
      const imported = StockOrderImport.repeat(items, records, StockGrouping.compare);
      if (!Object.keys(imported.quantities).length)
        throw Error(
          'None of the medicines in this Excel are currently available. Your existing order list was kept.'
        );
      if (
        selected().length &&
        !confirm('Replace your current order list with the quantities from this order file?')
      )
        return;
      quantities = imported.quantities;
      unavailableItems = imported.unavailableItems;
      save();
      render();
      $('stock-cart').showModal();
      orderStatus(
        'success',
        'Order file ready to review',
        items.filter((item) =>
          records.some((row) => String(row.code) === item.code && row.available > 0)
        ).length +
          ' medicines added. Unavailable medicines and short quantities will be saved with this order for admin download; quantities above available stock were reduced. ' +
          (imported.warnings.length ? imported.warnings.join('; ') + '. ' : '') +
          'Check the list, enter Store Code and Mobile No., then Submit. No order has been sent yet.'
      );
    } catch (e) {
      alert(e.message || 'Order file could not be read. Your existing order list was kept.');
    } finally {
      button.textContent = '↑ Upload Order Excel / CSV';
      button.disabled = loading || submitting || !records.length;
      $('order-import-file').value = '';
    }
  };
  async function startStock() {
    await loadStock();
    if (!new URLSearchParams(location.search).has('repeat')) return;
    try {
      const raw = sessionStorage.getItem('radhika-repeat-order');
      sessionStorage.removeItem('radhika-repeat-order');
      if (!raw) return;
      const previous = JSON.parse(raw);
      if (Date.now() - previous.created > 30 * 60 * 1000)
        throw Error('Repeat order expired. Open My Orders and try again.');
      if (selected().length && !confirm('Replace your current list with this repeat order?'))
        return;
      const prepared = StockOrderImport.repeat(previous.items, records, StockGrouping.compare);
      quantities = prepared.quantities;
      unavailableItems = prepared.unavailableItems;
      save();
      render();
      $('order-store').value = previous.storeCode;
      $('order-mobile').value = previous.mobile;
      syncProfileSummary();
      $('stock-cart').showModal();
      orderStatus(
        prepared.warnings.length ? 'error' : 'success',
        'Repeat order ready to review',
        prepared.warnings.length
          ? prepared.warnings.join('; ') +
              '. Latest stock and Sales Rates apply. Review before Submit.'
          : 'Latest stock and Sales Rates applied. Review your list and Submit to place the order.'
      );
    } catch (e) {
      alert(e.message || 'Repeat order could not be prepared.');
    }
  }
  render();
  startStock();
})();
