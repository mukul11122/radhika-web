window.EmployeeAdmin = (() => {
  const $ = (id) => document.getElementById(id);
  let call,
    initialized = false,
    reportsSequence = 0,
    accountRows = [], accountPage = 1, accountSequence = 0,
    reportRows = [], reportPage = 1;
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const today = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  function message(s) {
    $('employee-admin-message').textContent = s;
  }
  async function accounts() {
    try {
      const seq = ++accountSequence;
      const d = await call('/api/admin/employees');
      if (seq !== accountSequence) return;
      accountRows = d.employees;
      renderAccounts();
    } catch (e) {
      message(e.message);
    }
  }
  function renderAccounts() {
    const limit = Number($('employee-account-limit').value);
    const pages = Math.max(1, Math.ceil(accountRows.length / limit));
    accountPage = Math.min(Math.max(1, accountPage), pages);
    const jump = $('employee-account-jump');
    $('employee-account-page').textContent = 'Page ' + accountPage + ' of ' + pages + ' · ' + accountRows.length + ' employees';
    $('employee-account-prev').disabled = accountPage <= 1;
    $('employee-account-next').disabled = accountPage >= pages;
    jump.elements.page.value = accountPage;
    jump.elements.page.max = pages;
    jump.elements.page.disabled = !accountRows.length;
    jump.querySelector('button').disabled = !accountRows.length;
    $('employee-accounts').innerHTML = accountRows.length
        ? accountRows.slice((accountPage - 1) * limit, accountPage * limit)
            .map(
              (e) =>
                '<div class="employee-account" data-employee="' + esc(e.id) + '">' +
                '<div class="employee-person"><span class="employee-avatar" aria-hidden="true">' + esc(String(e.name || '?').trim().charAt(0).toUpperCase()) + '</span><div><strong>' + esc(e.name) + '</strong><small>@' + esc(e.username) + '</small></div><span class="employee-status ' + (e.active ? 'is-active' : 'is-inactive') + '">' + (e.active ? 'Active' : 'Inactive') + '</span></div>' +
                '<div class="employee-actions"><button type="button" data-access>Manage sections</button><button class="employee-access-toggle" type="button" data-toggle="' + (e.active ? '0' : '1') + '">' + (e.active ? 'Deactivate' : 'Reactivate') + '</button><div class="employee-password-reset"><input type="password" data-password minlength="8" maxlength="128" autocomplete="new-password" placeholder="New password" aria-label="New password for ' + esc(e.name) + '"><button type="button" data-reset>Reset password</button></div></div></div>'
            )
            .join('')
        : '<div class="employee-empty">No employee accounts yet. Add a team member above to get started.</div>';
  }
  async function reports() {
    const box = $('employee-admin-reports'),
      date = $('employee-report-filter').elements.date.value,
      seq = ++reportsSequence;
    EmployeeProgress.load(call, date);
    box.textContent = 'Loading reports…';
    try {
      const d = await call('/api/admin/employee-reports?date=' + encodeURIComponent(date));
      if (seq !== reportsSequence) return;
      reportRows = d.reports;
      renderReports();
    } catch (e) {
      if (seq === reportsSequence) box.textContent = e.message;
    }
  }
  function renderReports() {
    const box = $('employee-admin-reports');
    const limit = Number($('employee-report-limit').value);
    const pages = Math.max(1, Math.ceil(reportRows.length / limit));
    reportPage = Math.min(Math.max(1, reportPage), pages);
    const jump = $('employee-report-jump');
    $('employee-report-page').textContent = 'Page ' + reportPage + ' of ' + pages + ' · ' + reportRows.length + ' reports';
    $('employee-report-prev').disabled = reportPage <= 1;
    $('employee-report-next').disabled = reportPage >= pages;
    jump.elements.page.value = reportPage;
    jump.elements.page.max = pages;
    jump.elements.page.disabled = !reportRows.length;
    jump.querySelector('button').disabled = !reportRows.length;
    box.innerHTML = reportRows.length
        ? reportRows.slice((reportPage - 1) * limit, reportPage * limit)
            .map(
              (r) =>
                '<div class="employee-report"><h3>' +
                esc(r.name) +
                ' <small>(' +
                esc(r.username) +
                ')</small></h3><p class="employee-table-hint">Swipe to see all columns →</p><div class="employee-table"><table><thead><tr><th>Store Code</th><th>Challans</th><th>Sent for packing</th><th>Final invoices</th></tr></thead><tbody>' +
                r.entries
                  .map(
                    (x) =>
                      '<tr><td>' +
                      esc(x.storeCode) +
                      '</td><td>' +
                      esc(x.challan) +
                      '</td><td>' +
                      esc(x.packing) +
                      '</td><td>' +
                      esc(x.invoice) +
                      '</td></tr>'
                  )
                  .join('') +
                '</tbody><tfoot><tr><th>Total</th>' +
                ['challan', 'packing', 'invoice']
                  .map(
                    (k) => '<th>' + r.entries.reduce((s, x) => s + Number(x[k] || 0), 0) + '</th>'
                  )
                  .join('') +
                '</tr></tfoot></table></div></div>'
            )
            .join('')
        : '<div class="employee-empty employee-reports-empty"><span aria-hidden="true">▤</span><div><strong>No reports for this date</strong><p>Submitted employee reports will appear here.</p></div></div>';
  }
  function init() {
    if (initialized) return;
    initialized = true;
    $('employee-report-filter').elements.date.value = today();
    $('employee-report-filter').elements.date.max = today();
    $('employee-report-filter').onsubmit = (e) => {
      e.preventDefault();
      reportPage = 1;
      reports();
    };
    $('employee-create').onsubmit = async (e) => {
      e.preventDefault();
      const button = e.submitter;
      button.disabled = true;
      try {
        const f = new FormData(e.target);
        const d = await call('/api/admin/employees', {
          method: 'POST',
          body: JSON.stringify({ name: f.get('employeeName'), username: f.get('employeeUsername'), password: f.get('employeePassword') }),
        });
        e.target.reset();
        message(d.message);
        await accounts();
      } catch (err) {
        message(err.message);
      } finally {
        button.disabled = false;
      }
    };
    $('employee-report-limit').onchange = () => { reportPage = 1; renderReports(); };
    $('employee-report-prev').onclick = () => { if (reportPage > 1) { reportPage--; renderReports(); } };
    $('employee-report-next').onclick = () => { reportPage++; renderReports(); };
    $('employee-report-jump').onsubmit = (e) => {
      e.preventDefault();
      if (!e.currentTarget.elements.page.reportValidity()) return;
      reportPage = Number(e.currentTarget.elements.page.value);
      renderReports();
    };
    $('employee-account-limit').onchange = () => { accountPage = 1; renderAccounts(); };
    $('employee-account-prev').onclick = () => { if (accountPage > 1) { accountPage--; renderAccounts(); } };
    $('employee-account-next').onclick = () => { accountPage++; renderAccounts(); };
    $('employee-account-jump').onsubmit = (e) => {
      e.preventDefault();
      if (!e.currentTarget.elements.page.reportValidity()) return;
      accountPage = Number(e.currentTarget.elements.page.value);
      renderAccounts();
    };
    $('employee-accounts').onclick = async (e) => {
      const button = e.target.closest('button'),
        box = e.target.closest('[data-employee]');
      if (!button || !box) return;
      if (button.hasAttribute('data-access')) {
        button.disabled = true;
        try {
          const d = await call('/api/admin/employees/' + encodeURIComponent(box.dataset.employee) + '/access');
          const area = box.querySelector('[data-access-editor]') || document.createElement('div');
          const names = {dashboard:'Dashboard',orders:'Orders (assigned only)',priority:'Order Priority Online','docket-priority':'Order Priority By Docket','dispatch-report':'Dispatch Performance','employee-workload':'Employee Workload',reorder:'Reorder Suggestions','customer-history':'Customer History',exports:'Exports',alerts:'Stock Alerts',operations:'Operations (no backups)',kendras:'Kendra Profiles',demands:'Medicine Demand',stock:'Manage Stock',dockets:'Docket Records','employee-accounts':'Employee Accounts',employees:'Employee Reports'};
          area.dataset.accessEditor = ''; area.className = 'employee-permission-editor';
          area.innerHTML = '<div class="permission-heading"><div><span class="permission-eyebrow">ACCESS SETTINGS</span><h3>Choose allowed sections</h3><p>Select the areas this employee can open in the admin panel.</p></div><span class="permission-count" data-permission-count></span></div><div class="permission-notice"><span aria-hidden="true">✓</span><p>Orders are limited to this employee’s assignments. Backups and employee access stay with the admin.</p></div><div class="employee-permission-grid">' + d.available.map(section => '<label class="permission-option"><input type="checkbox" data-section="' + esc(section) + '"' + (d.sections.includes(section) ? ' checked' : '') + '><span class="permission-option-name">' + esc(names[section] || section) + '</span></label>').join('') + '</div><div class="permission-footer"><span>Changes apply when you save.</span><div><button type="button" data-cancel-access>Cancel</button><button type="button" data-save-access>Save access</button></div></div>';
          const updateCount = () => { area.querySelector('[data-permission-count]').textContent = area.querySelectorAll('[data-section]:checked').length + ' / ' + d.available.length + ' selected'; };
          area.addEventListener('change', updateCount); updateCount();
          box.append(area);
        } catch(error) { message(error.message); } finally { button.disabled = false; }
        return;
      }
      if (button.hasAttribute('data-cancel-access')) { box.querySelector('[data-access-editor]').remove(); return; }
      if (button.hasAttribute('data-save-access')) {
        button.disabled = true;
        try { const sections = [...box.querySelectorAll('[data-section]:checked')].map(input => input.dataset.section); const result = await call('/api/admin/employees/' + encodeURIComponent(box.dataset.employee) + '/access', {method:'PUT',body:JSON.stringify({sections})}); message(result.message); box.querySelector('[data-access-editor]').remove(); }
        catch(error) { message(error.message); } finally { button.disabled = false; }
        return;
      }
      const payload = {};
      if (button.hasAttribute('data-toggle')) payload.active = button.dataset.toggle === '1';
      else if (button.hasAttribute('data-reset')) {
        payload.password = box.querySelector('[data-password]').value;
        if (payload.password.length < 8) {
          message('Enter a new password with at least 8 characters.');
          return;
        }
      } else return;
      button.disabled = true;
      try {
        const d = await call('/api/admin/employees/' + encodeURIComponent(box.dataset.employee), {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        message(d.message);
        await accounts();
      } catch (err) {
        message(err.message);
      } finally {
        button.disabled = false;
      }
    };
  }
  return {
    load(request, view) {
      call = request;
      init();
      if (view === 'employee-accounts') accounts();
      if (view === 'employees') reports();
    },
  };
})();
