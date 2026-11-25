(() => {
  const $ = (id) => document.getElementById(id),
    today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  let token = sessionStorage.getItem('radhika-employee-token') || '',
    busy = false,
    loadedDate = '',
    summaryCategory = '';
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  function msg(text, success = false) {
    $('message').textContent = text;
    $('message').dataset.success = String(success);
    $('login-message').textContent = text;
    $('login-message').dataset.success = String(success);
    $('login-message').hidden = !text;
  }
  async function request(url, options = {}) {
    const r = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    });
    const out = await r.json();
    if (!r.ok || !out.ok) throw Error(out.message || 'Please try again.');
    return out;
  }
  function row(r = {}) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML =
      '<label>Store Code<input name="storeCode" inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20" required value="' +
      esc(r.storeCode || '') +
      '"></label>' +
      [
        ['challan', 'Challans made', 'Enter challan count'],
        ['packing', 'Sent for packing', 'Enter packing count'],
        ['invoice', 'Final invoices', 'Enter invoice count'],
      ]
        .map(
          ([k, label, placeholder]) =>
            '<label>' +
            label +
            '<input name="' +
            k +
            '" type="number" inputmode="numeric" min="0" max="10000" step="1" placeholder="' +
            esc(placeholder) + '" value="' +
            esc(Number(r[k]) > 0 ? r[k] : '') +
            '"></label>'
        )
        .join('') +
      '<button type="button" class="remove" aria-label="Remove store row">Remove</button>';
    return div;
  }
  function totals() {
    for (const k of ['challan', 'packing', 'invoice'])
      $('total-' + k).textContent = [...$('entries').querySelectorAll('[name="' + k + '"]')].reduce(
        (n, e) => n + (Number(e.value) || 0),
        0
      );
    renderSummary();
  }
  function renderSummary() {
    const details = $('summary-details');
    document.querySelectorAll('[data-summary]').forEach((button) =>
      button.setAttribute('aria-expanded', String(button.dataset.summary === summaryCategory))
    );
    details.hidden = !summaryCategory;
    if (!summaryCategory) return;
    const names = { challan: 'Challans made', packing: 'Sent for packing', invoice: 'Final invoices' };
    $('summary-details-title').textContent = names[summaryCategory] + ' · ' + $('report-date').value;
    const rows = [...$('entries').querySelectorAll('.entry')].map((entry) => ({
      store: entry.querySelector('[name="storeCode"]').value.trim(),
      count: Number(entry.querySelector('[name="' + summaryCategory + '"]').value) || 0,
    })).filter((entry) => entry.count > 0);
    const list = $('summary-details-list');
    list.replaceChildren();
    if (!rows.length) {
      list.textContent = 'No entries for this category on the selected date.';
      return;
    }
    for (const item of rows) {
      const line = document.createElement('div');
      line.className = 'summary-detail-row';
      const label = document.createElement('span');
      label.textContent = item.store ? 'Store ' + item.store : 'Store Code not entered';
      const count = document.createElement('strong');
      count.textContent = String(item.count);
      line.append(label, count);
      list.append(line);
    }
  }
  document.querySelectorAll('[data-summary]').forEach((button) => {
    button.addEventListener('click', () => {
      summaryCategory = summaryCategory === button.dataset.summary ? '' : button.dataset.summary;
      renderSummary();
    });
  });
  $('summary-close').onclick = () => { summaryCategory = ''; renderSummary(); };
  function show(logged) {
    $('login-section').hidden = logged;
    $('report-section').hidden = !logged;
  }
  async function load() {
    if (!token) return;
    msg('Loading report…');
    try {
      const d = await request(
        '/api/employee/report?date=' + encodeURIComponent($('report-date').value)
      );
      $('employee-name').textContent = d.name;
      $('entries').replaceChildren(...(d.entries.length ? d.entries : [{}]).map(row));
      loadedDate = $('report-date').value;
      show(true);
      totals();
      msg('');
    } catch (e) {
      msg(e.message);
      if (/sign in|session/i.test(e.message)) {
        token = '';
        sessionStorage.removeItem('radhika-employee-token');
        show(false);
      }
    }
  }
  $('report-date').max = today();
  $('report-date').value = today();
  $('login-form').onsubmit = async (e) => {
    e.preventDefault();
    msg('');
    if (busy) return;
    busy = true;
    const b = e.submitter;
    b.disabled = true;
    try {
      const f = new FormData(e.target),
        d = await request('/api/employee/login', {
          method: 'POST',
          body: JSON.stringify({ username: f.get('username'), password: f.get('password') }),
        });
      token = d.token;
      sessionStorage.setItem('radhika-employee-token', token);
      e.target.reset();
      await load();
    } catch (err) {
      msg(err.message);
    } finally {
      busy = false;
      b.disabled = false;
    }
  };
  $('logout').onclick = () => {
    token = '';
    sessionStorage.removeItem('radhika-employee-token');
    $('entries').replaceChildren();
    summaryCategory = '';
    renderSummary();
    $('login-form').elements.password.type = 'password';
    $('password-toggle').textContent = 'Show';
    $('password-toggle').setAttribute('aria-label', 'Show password');
    $('password-toggle').setAttribute('aria-pressed', 'false');
    show(false);
    msg('Logged out.', true);
  };
  $('password-toggle').onclick = () => {
    const input = $('login-form').elements.password;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    $('password-toggle').textContent = visible ? 'Hide' : 'Show';
    $('password-toggle').setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    $('password-toggle').setAttribute('aria-pressed', String(visible));
  };
  $('add-row').onclick = () => {
    $('entries').append(row());
    totals();
  };
  $('entries').addEventListener('input', totals);
  $('entries').addEventListener('keydown', (event) => {
    if (event.target.matches('input[type="number"]') && ['ArrowUp', 'ArrowDown'].includes(event.key))
      event.preventDefault();
  });
  $('entries').addEventListener('click', (e) => {
    const b = e.target.closest('.remove');
    if (b) {
      b.closest('.entry').remove();
      if (!$('entries').children.length) $('entries').append(row());
      totals();
    }
  });
  $('report-date').onchange = () => {
    if (loadedDate && !confirm('Change date? Unsaved changes on this report will be lost.')) {
      $('report-date').value = loadedDate;
      return;
    }
    summaryCategory = '';
    renderSummary();
    load();
  };
  $('report-form').onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if ($('report-date').value !== loadedDate) {
      msg('Please load the selected date before saving.');
      return;
    }
    const entries = [...$('entries').children].map((el) =>
      Object.fromEntries(
        [...el.querySelectorAll('input')].map((input) => [input.name, input.value])
      )
    );
    busy = true;
    $('save-report').disabled = true;
    try {
      const d = await request('/api/employee/report', {
        method: 'POST',
        body: JSON.stringify({ date: $('report-date').value, entries }),
      });
      msg(d.message, true);
    } catch (err) {
      msg(err.message);
    } finally {
      busy = false;
      $('save-report').disabled = false;
    }
  };
  if (token) load();
  else show(false);
})();
