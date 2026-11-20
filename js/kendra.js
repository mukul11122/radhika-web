(() => {
  const $ = (id) => document.getElementById(id),
    client = window.KendraProfile;
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  let page = 1,
    busy = false,
    demandId = crypto.randomUUID(),
    demandSignature = '';
  function demandView() {
    return (
      location.hash === '#demand' || new URLSearchParams(location.search).get('view') === 'demand'
    );
  }
  function show(profile) {
    setEditing(false);
    const demand = demandView();
    $('profile-details').hidden = demand;
    $('demand').hidden = !demand;
    $('kendra-view-title').textContent = demand ? 'Unavailable medicine demand' : 'Kendra profile';
    $('kendra-view-description').textContent = demand
      ? 'Register demand for unavailable medicines and track your requests.'
      : 'Save your delivery address, contact and GST details for future orders.';
    document.title = (demand ? 'Medicine Demand' : 'Kendra Profile') + ' — Radhika Agencies';
    $('profile-auth').hidden = !!profile;
    $('profile-private').hidden = !profile;
    $('profile-signout').hidden = !profile;
    if (profile) {
      for (const input of $('profile-edit').elements)
        if (input.name in profile) input.value = profile[input.name] || '';
      $('profile-edit').elements.storeCode.value = String(profile.storeCode || '').replace(
        /^pmbjk/i,
        ''
      );
      $('profile-edit').elements.storeCode.readOnly = true;
      if (demand) {
        loadDemands();
        loadUnavailable();
      }
    }
  }
  function setEditing(editing) {
    for (const input of $('profile-edit').querySelectorAll('input')) {
      input.readOnly = !editing || input.name === 'storeCode';
      input.disabled = !editing;
    }
    $('profile-edit-actions').hidden = !editing;
    $('profile-start-edit').hidden = editing;
  }
  $('profile-start-edit').onclick = () => {
    setEditing(true);
    $('profile-edit').elements.mobile.focus();
  };
  $('profile-cancel-edit').onclick = () => show(client.get());
  show(null);
  window.addEventListener('hashchange', () => show(client.get()));
  const requestedMedicine = new URLSearchParams(location.search).get('medicine');
  if (requestedMedicine) $('demand-form').elements.medicine.value = requestedMedicine.slice(0, 500);
  $('show-login').onclick = () => {
    $('pin-recovery').hidden = true;
    $('profile-login').hidden = false;
    $('profile-register').hidden = true;
  };
  $('show-register').onclick = () => {
    $('pin-recovery').hidden = true;
    $('profile-login').hidden = true;
    $('profile-register').hidden = false;
  };
  $('show-pin-recovery').onclick = () => {
    $('profile-login').hidden = true;
    $('profile-register').hidden = true;
    $('pin-recovery').hidden = false;
  };
  $('recovery-send').onclick = async () => {
    const button = $('recovery-send'),
      code = $('pin-recovery').elements.storeCode.value.trim();
    if (!code) {
      $('recovery-message').textContent = 'Enter your Store Code.';
      return;
    }
    button.disabled = true;
    try {
      const data = await client.request('/api/kendra/forgot-pin', {
        method: 'POST',
        body: JSON.stringify({ storeCode: code }),
      });
      $('recovery-message').textContent = data.message;
    } catch (e) {
      $('recovery-message').textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
  $('pin-recovery').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target,
      data = formData(form),
      button = form.querySelector('[type=submit]');
    if (data.pin !== data.confirmPin) {
      $('recovery-message').textContent = 'Profile PINs do not match.';
      return;
    }
    if (button.disabled) return;
    button.disabled = true;
    try {
      const out = await client.request('/api/kendra/reset-pin', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      client.clear();
      form.reset();
      $('show-login').click();
      $('profile-message').textContent = out.message;
    } catch (e) {
      $('recovery-message').textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
  function formData(form) {
    return Object.fromEntries(new FormData(form));
  }
  document.querySelectorAll('input[name="storeCode"]').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9]/g, '');
    });
  });
  const registerCode = $('profile-register').elements.storeCode;
  const codeMessage = document.createElement('small');
  codeMessage.id = 'register-code-message';
  codeMessage.setAttribute('aria-live', 'polite');
  registerCode.setAttribute('aria-describedby', codeMessage.id);
  registerCode.after(codeMessage);
  let codeCheck = 0;
  registerCode.addEventListener('input', () => {
    codeCheck++;
    registerCode.setCustomValidity('');
    codeMessage.textContent = '';
  });
  registerCode.addEventListener('blur', async () => {
    const code = registerCode.value.trim(),
      check = ++codeCheck;
    if (!code || !registerCode.checkValidity()) return;
    codeMessage.textContent = 'Checking Store Code…';
    try {
      const result = await client.request(
        '/api/kendra/store-code-check?storeCode=' + encodeURIComponent(code)
      );
      if (check !== codeCheck) return;
      const message = result.available
        ? 'Store Code is available.'
        : 'A profile already exists for this Store Code. Please sign in.';
      codeMessage.textContent = message;
      codeMessage.style.color = result.available ? '#167047' : '#b42318';
      registerCode.setCustomValidity(result.available ? '' : message);
    } catch (error) {
      if (check === codeCheck)
        codeMessage.textContent = 'Unable to check now. Store Code will be checked when you save.';
    }
  });
  for (const [id, url] of [
    ['profile-login', '/api/kendra/login'],
    ['profile-register', '/api/kendra/register'],
    ['profile-edit', '/api/kendra/profile'],
  ]) {
    $(id).onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const form = event.target,
        data = formData(form),
        button = form.querySelector('[type=submit]');
      if (id === 'profile-login' && !data.storeCode.trim() && !data.mobile.trim()) {
        $('profile-message').textContent = 'Enter either Store Code or mobile number.';
        return;
      }
      if (id === 'profile-register' && data.pin !== data.confirmPin) {
        $('profile-message').textContent = 'Profile PINs do not match.';
        return;
      }
      busy = true;
      button.disabled = true;
      $('profile-message').textContent = 'Saving profile…';
      try {
        const result = await client.request(url, {
          method: id === 'profile-edit' ? 'PUT' : 'POST',
          body: JSON.stringify(data),
        });
        if (result.token) client.save(result.token, !!data.remember);
        await client.refresh();
        show(client.get());
        $('profile-message').textContent =
          id === 'profile-edit'
            ? 'Profile updated. New orders will use these details.'
            : demandView()
              ? 'Signed in. Register your medicine demand below.'
              : 'Profile ready. Your details will fill automatically on the Stock Directory.';
        form.querySelectorAll('[type=password]').forEach((input) => (input.value = ''));
      } catch (error) {
        $('profile-message').textContent = error.message;
      } finally {
        busy = false;
        button.disabled = false;
      }
    };
  }
  $('profile-signout').onclick = () => {
    client.clear();
    $('profile-login').reset();
    $('profile-edit').reset();
    $('my-demands').replaceChildren();
    $('profile-message').textContent = 'Signed out.';
    show(null);
  };
  async function loadUnavailable() {
    $('unavailable-results').textContent = 'Loading unavailable medicines…';
    try {
      const data = await client.request(
        '/api/stock/unavailable?q=' + encodeURIComponent($('unavailable-search').elements.q.value)
      );
      $('unavailable-results').innerHTML = data.medicines.length
        ? data.medicines
            .map((row) =>
              row.quantity > 0
                ? '<a class="unavailable-choice" href="stock.html">' +
                  esc(row.code) +
                  ' · ' +
                  esc(row.name) +
                  ' — Available in stock · Open Stock Directory</a>'
                : '<button type="button" class="unavailable-choice" data-code="' +
                  esc(row.code) +
                  '" data-name="' +
                  esc(row.name) +
                  '">' +
                  esc(row.code) +
                  ' · ' +
                  esc(row.name) +
                  '</button>'
            )
            .join('')
        : '<p>No matching medicine in the product catalogue. You can enter an unlisted medicine below.</p>';
    } catch (error) {
      $('unavailable-results').textContent = error.message;
    }
  }
  $('unavailable-search').onsubmit = (event) => {
    event.preventDefault();
    loadUnavailable();
  };
  $('unavailable-results').onclick = (event) => {
    const button = event.target.closest('[data-code]');
    if (!button) return;
    $('demand-form').elements.code.value = button.dataset.code;
    $('demand-form').elements.medicine.value = button.dataset.name;
    $('demand-form').elements.quantity.focus();
  };
  $('demand-form').onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = event.target,
      data = formData(form),
      signature = JSON.stringify(data);
    if (signature !== demandSignature) {
      demandId = crypto.randomUUID();
      demandSignature = signature;
    }
    const button = form.querySelector('[type=submit]');
    busy = true;
    button.disabled = true;
    $('demand-message').textContent = 'Registering demand…';
    try {
      const result = await client.request('/api/kendra/demands', {
        method: 'POST',
        body: JSON.stringify({ ...data, requestId: demandId }),
      });
      $('demand-message').textContent = result.message;
      form.reset();
      demandSignature = '';
      page = 1;
      await loadDemands();
    } catch (error) {
      $('demand-message').textContent = error.message;
    } finally {
      busy = false;
      button.disabled = false;
    }
  };
  async function loadDemands() {
    $('my-demands').textContent = 'Loading your requests…';
    try {
      const data = await client.request('/api/kendra/demands?page=' + page);
      $('my-demands').innerHTML = data.demands.length
        ? '<div class="insight-table"><table><thead><tr><th>Medicine</th><th>Quantity</th><th>Status</th><th>Admin note</th></tr></thead><tbody>' +
          data.demands
            .map(
              (row) =>
                '<tr><td>' +
                esc(row.code ? row.code + ' · ' : '') +
                esc(row.medicine) +
                '</td><td>' +
                row.quantity +
                '</td><td>' +
                esc(row.status) +
                '</td><td>' +
                esc(row.admin_note || '—') +
                '</td></tr>'
            )
            .join('') +
          '</tbody></table></div>'
        : '<p>No demand requests yet.</p>';
      $('demand-page').textContent =
        'Page ' +
        page +
        ' of ' +
        Math.max(1, Math.ceil(data.total / 20)) +
        ' · ' +
        data.total +
        ' requests';
      $('demand-previous').disabled = page <= 1;
      $('demand-next').disabled = page >= Math.ceil(data.total / 20);
    } catch (error) {
      $('my-demands').textContent = error.message;
    }
  }
  $('demand-previous').onclick = () => {
    page--;
    loadDemands();
  };
  $('demand-next').onclick = () => {
    page++;
    loadDemands();
  };
  client
    .refresh()
    .then(show)
    .catch((error) => {
      $('profile-message').textContent = error.message;
      show(null);
    });
})();
