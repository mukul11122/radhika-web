function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function statusClass(status) {
  var s = String(status || '').toLowerCase();
  if (s.indexOf('deliver') >= 0) return 'ok';
  if (s.indexOf('transit') >= 0 || s.indexOf('dispatch') >= 0 || s.indexOf('ship') >= 0) return 'warn';
  if (s.indexOf('cancel') >= 0 || s.indexOf('return') >= 0) return 'err';
  return '';
}

function docketCard(d) {
  var rows = '';
  function add(label, val) {
    if (val) rows += '<div class="drow"><span class="dlabel">' + esc(label) + '</span><span class="dval">' + esc(val) + '</span></div>';
  }
  add('Docket / Invoice No.', d.docketNo);
  add('Courier', d.courier);
  add('Tracking / AWB No.', d.tracking);
  add('Status', d.status);
  add('Dispatch Date', d.dispatchDate);
  add('Organization / Kendra', d.organization);
  add('Store Owner', d.storeOwner);
  add('No. of Boxes', d.boxes);
  add('Items', d.items);
  return '<div class="docket-card ' + statusClass(d.status) + '">' + rows + '</div>';
}

document.addEventListener("DOMContentLoaded", function () {
  var form = document.getElementById("trackForm");
  if (!form) return;
  var msg = form.querySelector(".msg");
  var results = document.getElementById("results");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var phone = document.getElementById("phone").value.trim();
    var store = document.getElementById("store").value.trim();
    if (!phone && !store) {
      msg.className = "msg err"; msg.style.display = "block";
      msg.textContent = "Please enter a mobile number or store code.";
      return;
    }
    msg.style.display = "none";
    results.innerHTML = '<p class="note">Looking up your dockets…</p>';
    var btn = form.querySelector("button[type=submit]");
    var label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Tracking…"; }

    var url = phone
      ? "/api/docket?phone=" + encodeURIComponent(phone)
      : "/api/docket?store=" + encodeURIComponent(store);

    fetch(url)
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.ok) {
          msg.className = "msg err"; msg.style.display = "block";
          msg.textContent = (res.j && res.j.message) || "Lookup failed. Please try again.";
          results.innerHTML = "";
          return;
        }
        if (!res.j.found) {
          results.innerHTML = '<div class="msg err" style="display:block;max-width:640px;margin:0 auto">No docket found for this number yet. If your order was dispatched recently, please allow some time or contact us.</div>';
          return;
        }
        results.innerHTML = '<h3 style="text-align:center;margin-bottom:18px">Found ' + res.j.dockets.length + ' docket(s)</h3>' +
          res.j.dockets.map(docketCard).join('');
      })
      .catch(function () {
        msg.className = "msg err"; msg.style.display = "block";
        msg.textContent = "Network error. Is the server running?";
        results.innerHTML = "";
      })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = label; }
      });
  });
});
